import { useEffect, useRef, useState } from "react";

import {
  fetchAccessSettings,
  updateRoleAccess,
  type AccessSettings,
  type Page,
  type ProjectSummary,
  type RoleAccess,
  type Scope,
} from "../api";
import { SectionHeader } from "../components/SectionHeader";
import { SettingsTabs } from "../components/SettingsTabs";
import type { ProjectSettingsTab } from "../router";
import { CalendarSection } from "./CalendarSection";
import { ColumnsSection } from "./ColumnsSection";
import { NotFoundPage } from "./HomePage";
import { StatusSection } from "./StatusPage";
import { SyncSection } from "./SyncPage";

export function ProjectSettingsPage({
  slug,
  projects,
  tab,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
  tab: ProjectSettingsTab;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  if (projects && (!project || !project.access.can_manage)) {
    return <NotFoundPage />;
  }
  return (
    <>
      <SettingsTabs active={tab} project={project ?? null} />
      {tab === "access" && <AccessSection slug={slug} projectName={project?.name ?? slug} />}
      {tab === "general" && <ColumnsSection slug={slug} />}
      {tab === "calendar" && <CalendarSection slug={slug} />}
      {tab === "status" && <StatusSection slug={slug} />}
      {tab === "sync" && <SyncSection slug={slug} />}
    </>
  );
}

function AccessSection({ slug, projectName }: { slug: string; projectName: string }) {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    fetchAccessSettings(slug)
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const latest = useRef<Record<number, RoleAccess>>({});
  const queue = useRef<Record<number, Promise<void>>>({});

  useEffect(() => {
    latest.current = Object.fromEntries(
      (settings?.roles ?? []).map((role) => [role.role_id, role]),
    );
  }, [settings]);

  const change = (roleId: number, update: (role: RoleAccess) => RoleAccess) => {
    const current = latest.current[roleId];
    if (!current) {
      return;
    }
    const next = update(current);
    latest.current = { ...latest.current, [roleId]: next };
    setSettings(
      (state) =>
        state && {
          ...state,
          roles: state.roles.map((role) => (role.role_id === roleId ? next : role)),
        },
    );
    const previous = queue.current[roleId] ?? Promise.resolve();
    queue.current[roleId] = previous.then(async () => {
      const wanted = latest.current[roleId] ?? next;
      try {
        await updateRoleAccess(slug, roleId, wanted.pages, wanted.scope);
        setError(null);
      } catch {
        setError(`Could not save the access of ${wanted.name}. Try again.`);
      }
    });
  };

  const togglePage = (role: RoleAccess, page: Page) => {
    change(role.role_id, (current) => ({
      ...current,
      pages: current.pages.includes(page)
        ? current.pages.filter((other) => other !== page)
        : [...current.pages, page],
    }));
  };

  const setScope = (role: RoleAccess, scope: Scope) => {
    change(role.role_id, (current) => ({ ...current, scope }));
  };

  return (
    <>
      <SectionHeader
        title="Access"
        subtitle={`What each role of ${projectName} sees in Taiga Metrics`}
      />
      <div className="banner banner-info">
        Members see only what their role is allowed here, and nothing until you enable it. The
        project owner, project admins and Taiga superusers always see everything and change these
        settings. Roles and members come from Taiga.
      </div>
      {error && <div className="banner banner-fail">{error}</div>}
      {!settings && !error && <p className="muted">Loading...</p>}
      {settings && (
        <section className="card">
          <table className="table access-table">
            <thead>
              <tr>
                <th>Role</th>
                {settings.pages.map((page) => (
                  <th key={page.key} className="center">
                    {page.title}
                  </th>
                ))}
                <th>Cards</th>
              </tr>
            </thead>
            <tbody>
              {settings.roles.map((role) => (
                <tr key={role.role_id}>
                  <td className="role-name">{role.name}</td>
                  {settings.pages.map((page) => (
                    <td key={page.key} className="center">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={role.pages.includes(page.key)}
                        onChange={() => togglePage(role, page.key)}
                        aria-label={`${page.title} for ${role.name}`}
                      />
                    </td>
                  ))}
                  <td>
                    <select
                      className="select"
                      value={role.scope}
                      onChange={(event) => setScope(role, event.target.value as Scope)}
                      aria-label={`Cards visible to ${role.name}`}
                    >
                      <option value="all">All cards</option>
                      <option value="own">Only their own</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="muted section">
        "Only their own" limits Flow metrics and Search to cards the member is currently assigned
        to.
      </p>
    </>
  );
}
