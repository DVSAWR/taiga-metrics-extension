import type { ItemType } from "./api";

const ITEM_PATHS: Record<ItemType, string> = {
  userstory: "us",
  task: "task",
  issue: "issue",
  epic: "epic",
};

export function taigaItemUrl(
  taigaUrl: string,
  projectSlug: string,
  itemType: ItemType,
  ref: number,
): string {
  return `${taigaUrl}/project/${encodeURIComponent(projectSlug)}/${ITEM_PATHS[itemType]}/${ref}`;
}
