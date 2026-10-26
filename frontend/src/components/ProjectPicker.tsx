import { createContext, useContext } from "react";

import type { ProjectSummary } from "../api";
import { navigate, projectPath } from "../router";
import { Dropdown } from "./Dropdown";

export const ProjectsContext = createContext<ProjectSummary[] | null>(null);

const KEPT_DEPTH: Record<string, number> = { people: 5, cards: 5 };

/** The same section of another project; a subject or a card of this one is left behind. */
export function switchedPath(pathname: string, slug: string): string {
  const parts = pathname.split("/");
  const section = parts[3];
  if (!section) {
    return projectPath(slug);
  }
  const depth = KEPT_DEPTH[section] ?? 4;
  const kept = parts.slice(3, depth);
  if (section === "people" && kept[1] !== "me") {
    kept.splice(1);
  }
  if (section === "cards" && kept[1] !== "history") {
    kept.splice(1);
  }
  return `${projectPath(slug)}/${kept.join("/")}`;
}

export function ProjectPicker({ slug }: { slug: string }) {
  const projects = useContext(ProjectsContext);
  if (!projects || projects.length < 2) {
    return null;
  }
  return (
    <div className="project-picker">
      <Dropdown
        label="Project"
        value={slug}
        options={projects.map((project) => ({ value: project.slug, label: project.name }))}
        onChange={(next) =>
          next !== slug && navigate(switchedPath(window.location.pathname, next))
        }
      />
    </div>
  );
}
