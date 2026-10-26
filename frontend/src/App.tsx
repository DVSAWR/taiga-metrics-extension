import { useCallback, useEffect, useState } from "react";

import {
  fetchConfig,
  fetchMe,
  fetchProjects,
  logout,
  PROJECTS_CHANGED_EVENT,
  UNAUTHORIZED_EVENT,
  type Me,
  type Page as PageKey,
  type ProjectSummary,
} from "./api";
import type { HelpLinks } from "./components/Sidebar";
import { PeopleContext, TaigaUrlContext } from "./components/PersonLink";
import { ProjectsContext } from "./components/ProjectPicker";
import { Sidebar } from "./components/Sidebar";
import { canOpen } from "./projectAccess";
import { ActivityPage } from "./pages/ActivityPage";
import { AnalysisPage } from "./pages/AnalysisPage";
import { TrendsPage } from "./pages/TrendsPage";
import { HistoryPage } from "./pages/CardsPage";
import { HomePage, NotFoundPage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PeoplePage, RolesPage } from "./pages/ListPages";
import { MODULE_INFO, MODULE_OF_TYPE } from "./modules";
import { CardPage } from "./pages/CardPage";
import { ColumnPage } from "./pages/KanbanPage";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage";
import { SearchPage } from "./pages/SearchPage";
import { matchRoute, navigate, projectPath, routeSlug, usePath, type Route } from "./router";
import { readStored, writeStored } from "./storage";

function allowed(project: ProjectSummary, route: Route, viewerId: number): boolean {
  const any = (...pages: PageKey[]) => pages.some((page) => canOpen(project, page));
  switch (route.page) {
    case "project":
      return any("overview");
    case "roles":
      return any("directions");
    case "people":
      return any("people");
    case "person":
      return route.userId === null || route.userId === viewerId
        ? any("my_page", "people")
        : any("people");
    case "trends":
      return any("trends");
    case "activity":
      return any("activity");
    case "cards":
      return any("cards");
    case "card":
      return any("overview", "directions", "people", "my_page", "trends", "activity", "cards");
    case "column":
      return any("overview", "directions", "trends");
    default:
      return true;
  }
}

function LegacySection({ slug, type }: { slug: string; type: string }) {
  useEffect(() => {
    writeStored(`item-type:${slug}`, JSON.stringify(type));
    navigate(`${projectPath(slug)}${window.location.search}`, true);
  }, [slug, type]);
  return null;
}

function Forbidden() {
  return (
    <>
      <h1>Not available</h1>
      <p className="muted">
        This page is not enabled for your role in this project. The project owner or an admin can
        enable it in the project settings.
      </p>
    </>
  );
}

function Page({
  route,
  projects,
  error,
  taigaUrl,
  me,
}: {
  route: Route;
  projects: ProjectSummary[] | null;
  error: string | null;
  taigaUrl: string | null;
  me: Me;
}) {
  const slug = routeSlug(route);
  const project = slug ? projects?.find((candidate) => candidate.slug === slug) : undefined;
  if (projects && slug && !project) {
    return <NotFoundPage />;
  }
  if (project && !allowed(project, route, me.id)) {
    return <Forbidden />;
  }
  switch (route.page) {
    case "home":
      return <HomePage projects={projects} error={error} />;
    case "project":
      return (
        <AnalysisPage
          slug={route.slug}
          subject={{ kind: "project", id: null }}
          projects={projects}
          me={me}
          taigaUrl={taigaUrl}
        />
      );
    case "roles":
      return route.roleId === null ? (
        <RolesPage slug={route.slug} projects={projects} taigaUrl={taigaUrl} />
      ) : (
        <AnalysisPage
          key={route.roleId}
          slug={route.slug}
          subject={{ kind: "role", id: route.roleId }}
          projects={projects}
          me={me}
          taigaUrl={taigaUrl}
        />
      );
    case "people":
      return <PeoplePage slug={route.slug} projects={projects} me={me} />;
    case "person":
      return (
        <AnalysisPage
          key={route.userId ?? "me"}
          slug={route.slug}
          subject={{ kind: "person", id: route.userId }}
          projects={projects}
          me={me}
          taigaUrl={taigaUrl}
        />
      );
    case "trends":
      return <TrendsPage slug={route.slug} projects={projects} taigaUrl={taigaUrl} />;
    case "activity":
      return <ActivityPage slug={route.slug} projects={projects} me={me} taigaUrl={taigaUrl} />;
    case "cards":
      return route.tab === "history" ? (
        <HistoryPage slug={route.slug} projects={projects} taigaUrl={taigaUrl} />
      ) : (
        <SearchPage slug={route.slug} projects={projects} taigaUrl={taigaUrl} />
      );
    case "module":
      return <LegacySection slug={route.slug} type={MODULE_INFO[route.module].type} />;
    case "card":
      return (
        <CardPage
          slug={route.slug}
          module={route.module}
          itemId={route.itemId}
          projects={projects}
          taigaUrl={taigaUrl}
        />
      );
    case "column":
      return (
        <ColumnPage
          key={`${route.slug}:${route.itemType}:${route.statusId}`}
          slug={route.slug}
          itemType={route.itemType}
          statusId={route.statusId}
          projects={projects}
          taigaUrl={taigaUrl}
        />
      );
    case "project-settings":
      return <ProjectSettingsPage slug={route.slug} projects={projects} tab={route.tab} />;
    case "not-found":
      return <NotFoundPage />;
  }
}

const SECTION_TITLES: Partial<Record<Route["page"], string>> = {
  project: "Overview",
  roles: "Roles",
  people: "People",
  person: "Person",
  trends: "Trends",
  activity: "Activity",
  cards: "Cards",
  "project-settings": "Settings",
};

function titleOf(route: Route, projects: ProjectSummary[] | null): string {
  if (route.page === "home") {
    return "Projects";
  }
  if (route.page === "not-found") {
    return "Page not found";
  }
  const name = projects?.find((project) => project.slug === route.slug)?.name ?? route.slug;
  if (route.page === "card" || route.page === "module") {
    return `${MODULE_INFO[route.module].label} - ${name}`;
  }
  if (route.page === "column") {
    return `${MODULE_INFO[MODULE_OF_TYPE[route.itemType]].label} - ${name}`;
  }
  if (route.page === "person" && route.userId === null) {
    return `My page - ${name}`;
  }
  return `${SECTION_TITLES[route.page] ?? "Taiga Metrics"} - ${name}`;
}

const COLLAPSED_KEY = "sidebar-collapsed";
const LAST_PROJECT_KEY = "last-project";

export function App() {
  const route = matchRoute(usePath());
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taigaUrl, setTaigaUrl] = useState<string | null>(null);
  const [helpLinks, setHelpLinks] = useState<HelpLinks | null>(null);

  useEffect(() => {
    fetchConfig()
      .then((config) => {
        setTaigaUrl(config.taiga_url);
        setHelpLinks({ community: config.community_url, repository: config.repository_url });
      })
      .catch(() => setTaigaUrl(null));
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null));
    const signedOut = () => setMe(null);
    window.addEventListener(UNAUTHORIZED_EVENT, signedOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOut);
  }, []);

  useEffect(() => {
    if (!me) {
      setProjects(null);
      return;
    }
    const load = () =>
      fetchProjects()
        .then((next) => {
          setProjects(next);
          setError(null);
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    void load();
    window.addEventListener(PROJECTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, load);
  }, [me]);

  useEffect(() => {
    document.title = me
      ? `${titleOf(route, projects)} - Taiga Metrics`
      : "Sign in - Taiga Metrics";
  }, [route, projects, me]);

  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY) === "true");
  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      writeStored(COLLAPSED_KEY, String(!current));
      return !current;
    });
  }, []);

  const [lastSlug, setLastSlug] = useState(() => readStored(LAST_PROJECT_KEY));
  const activeSlug = routeSlug(route);
  useEffect(() => {
    if (activeSlug && projects?.some((project) => project.slug === activeSlug)) {
      writeStored(LAST_PROJECT_KEY, activeSlug);
      setLastSlug(activeSlug);
    }
  }, [activeSlug, projects]);
  const currentSlug = activeSlug ?? lastSlug;
  const currentProject = projects?.find((project) => project.slug === currentSlug) ?? null;

  const signOut = useCallback(() => {
    void logout().finally(() => {
      setMe(null);
      navigate("/");
    });
  }, []);

  if (me === undefined) {
    return null;
  }
  if (me === null) {
    return <LoginPage taigaUrl={taigaUrl} onSignedIn={setMe} />;
  }

  return (
    <div className="page">
      <div className="layout">
        <Sidebar
          route={route}
          project={currentProject}
          collapsed={collapsed}
          onToggle={toggleSidebar}
          me={me}
          helpLinks={helpLinks}
          onLogout={signOut}
        />
        <main className={`content${route.page === "home" ? " content-centered" : ""}`}>
          <ProjectsContext.Provider value={projects}>
            <TaigaUrlContext.Provider value={taigaUrl}>
              <PeopleContext.Provider
                value={
                  currentProject
                    ? {
                        slug: currentProject.slug,
                        me: me.id,
                        others: canOpen(currentProject, "people"),
                      }
                    : null
                }
              >
                <Page
                  route={route}
                  projects={projects}
                  error={error}
                  taigaUrl={taigaUrl}
                  me={me}
                />
              </PeopleContext.Provider>
            </TaigaUrlContext.Provider>
          </ProjectsContext.Provider>
        </main>
      </div>
    </div>
  );
}
