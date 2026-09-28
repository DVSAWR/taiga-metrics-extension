import { useCallback, useEffect, useState } from "react";

import {
  fetchConfig,
  fetchMe,
  fetchProjects,
  logout,
  UNAUTHORIZED_EVENT,
  type Me,
  type Page as PageKey,
  type ProjectSummary,
} from "./api";
import { Navbar, type HelpLinks } from "./components/Navbar";
import { TaigaUrlContext } from "./components/PersonLink";
import { Sidebar } from "./components/Sidebar";
import { canOpen } from "./projectAccess";
import { HomePage, NotFoundPage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MODULE_INFO, MODULE_OF_TYPE } from "./modules";
import { CardPage } from "./pages/CardPage";
import { ColumnPage, KanbanPage } from "./pages/KanbanPage";
import { ScrumPage } from "./pages/ScrumPage";
import { ModulePage } from "./pages/ModulePage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage";
import { SearchPage } from "./pages/SearchPage";
import { TeamPage } from "./pages/TeamPage";
import { matchRoute, navigate, routeSlug, usePath, type Route } from "./router";
import { readStored, writeStored } from "./storage";

const PAGE_OF_ROUTE: Partial<Record<Route["page"], PageKey>> = {
  project: "flow",
  module: "flow",
  card: "flow",
  kanban: "flow",
  scrum: "flow",
  column: "flow",
  search: "search",
  team: "team",
};

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
  const page = PAGE_OF_ROUTE[route.page];
  if (projects && slug && !project) {
    return <NotFoundPage />;
  }
  if (project && page && !canOpen(project, page)) {
    return <Forbidden />;
  }
  switch (route.page) {
    case "home":
      return <HomePage projects={projects} error={error} />;
    case "project":
      return <ProjectPage slug={route.slug} projects={projects} />;
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
    case "module":
      return (
        <ModulePage
          slug={route.slug}
          module={route.module}
          tab={route.tab}
          projects={projects}
          taigaUrl={taigaUrl}
        />
      );
    case "scrum":
      return (
        <ScrumPage
          slug={route.slug}
          itemType={route.itemType}
          projects={projects}
          taigaUrl={taigaUrl}
        />
      );
    case "kanban":
      return <KanbanPage slug={route.slug} projects={projects} />;
    case "column":
      return (
        <ColumnPage
          slug={route.slug}
          itemType={route.itemType}
          statusId={route.statusId}
          projects={projects}
          taigaUrl={taigaUrl}
        />
      );
    case "team":
      return <TeamPage slug={route.slug} projects={projects} me={me} />;
    case "search":
      return <SearchPage slug={route.slug} projects={projects} taigaUrl={taigaUrl} />;
    case "project-settings":
      return <ProjectSettingsPage slug={route.slug} projects={projects} tab={route.tab} />;
    case "not-found":
      return <NotFoundPage />;
  }
}

const SECTION_TITLES = {
  project: "Flow metrics",
  kanban: "Kanban",
  scrum: "Scrum",
  team: "Team",
  search: "Search",
  "project-settings": "Settings",
} as const;

function titleOf(route: Route, projects: ProjectSummary[] | null): string {
  switch (route.page) {
    case "project":
    case "kanban":
    case "scrum":
    case "team":
    case "search":
    case "project-settings": {
      const name = projects?.find((project) => project.slug === route.slug)?.name ?? route.slug;
      return `${SECTION_TITLES[route.page]} - ${name}`;
    }
    case "card":
    case "module": {
      const name = projects?.find((project) => project.slug === route.slug)?.name ?? route.slug;
      return `${MODULE_INFO[route.module].label} - ${name}`;
    }
    case "column": {
      const name = projects?.find((project) => project.slug === route.slug)?.name ?? route.slug;
      return `${MODULE_INFO[MODULE_OF_TYPE[route.itemType]].label} - ${name}`;
    }
    case "not-found":
      return "Page not found";
    case "home":
      return "Projects";
  }
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
    fetchProjects()
      .then((next) => {
        setProjects(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
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
      <Navbar
        route={route}
        projects={projects}
        projectsError={error}
        currentSlug={currentProject?.slug ?? null}
        me={me}
        onLogout={signOut}
        helpLinks={helpLinks}
      />
      <div className="layout">
        {route.page !== "home" && (
          <Sidebar
            route={route}
            project={currentProject}
            collapsed={collapsed}
            onToggle={toggleSidebar}
          />
        )}
        <main className={`content${route.page === "home" ? " content-centered" : ""}`}>
          <TaigaUrlContext.Provider value={taigaUrl}>
            <Page route={route} projects={projects} error={error} taigaUrl={taigaUrl} me={me} />
          </TaigaUrlContext.Provider>
        </main>
      </div>
    </div>
  );
}
