import type { ItemType, Page, ProjectSummary } from "./api";
import { cardsPath, personPath, projectPath, rolePath } from "./router";

export function canOpen(project: ProjectSummary, page: Page): boolean {
  return project.access.pages.includes(page);
}

export function canOpenCard(project: ProjectSummary, itemType: ItemType): boolean {
  return Boolean(itemType) && project.access.pages.length > 0;
}

export function projectHome(project: ProjectSummary): string {
  if (canOpen(project, "overview")) {
    return projectPath(project.slug);
  }
  if (canOpen(project, "directions")) {
    return rolePath(project.slug);
  }
  if (canOpen(project, "people")) {
    return projectPath(project.slug, "people");
  }
  if (canOpen(project, "my_page")) {
    return personPath(project.slug);
  }
  if (canOpen(project, "trends")) {
    return projectPath(project.slug, "trends");
  }
  if (canOpen(project, "activity")) {
    return projectPath(project.slug, "activity");
  }
  if (canOpen(project, "cards")) {
    return cardsPath(project.slug);
  }
  return projectPath(project.slug);
}
