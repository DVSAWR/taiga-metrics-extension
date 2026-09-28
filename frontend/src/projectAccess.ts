import type { Page, ProjectSummary } from "./api";
import { projectPath } from "./router";

export function canOpen(project: ProjectSummary, page: Page): boolean {
  return project.access.pages.includes(page);
}

export function projectHome(project: ProjectSummary): string {
  if (canOpen(project, "flow")) {
    return projectPath(project.slug);
  }
  if (canOpen(project, "search")) {
    return projectPath(project.slug, "search");
  }
  if (canOpen(project, "team")) {
    return projectPath(project.slug, "team");
  }
  return projectPath(project.slug, "settings");
}
