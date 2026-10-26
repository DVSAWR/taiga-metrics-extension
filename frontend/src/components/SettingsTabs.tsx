import type { ProjectSummary } from "../api";
import { Link, projectSettingsPath, type ProjectSettingsTab } from "../router";

const TABS: { key: ProjectSettingsTab; label: string }[] = [
  { key: "access", label: "Access" },
  { key: "general", label: "General" },
  { key: "status", label: "System status" },
  { key: "sync", label: "Data sync" },
];

export function settingsTabs(
  project: ProjectSummary | null,
): { key: ProjectSettingsTab; label: string; to: string }[] {
  if (!project?.access.can_manage) {
    return [];
  }
  return TABS.map((tab) => ({ ...tab, to: projectSettingsPath(project.slug, tab.key) }));
}

export function SettingsTabs({
  active,
  project,
}: {
  active: ProjectSettingsTab;
  project: ProjectSummary | null;
}) {
  return (
    <>
      <h1>Settings</h1>
      <nav className="tabs" aria-label="Settings">
        {settingsTabs(project).map((tab) => (
          <Link key={tab.key} to={tab.to} className={`tab${tab.key === active ? " active" : ""}`}>
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
