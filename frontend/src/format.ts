import type { ItemType } from "./api";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const numberFormat = new Intl.NumberFormat("en-US");

export function formatDateTime(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : "-";
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatDuration(start: string, end: string | null): string {
  if (!end) {
    return "-";
  }
  const seconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds / 60)} min`;
}

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  userstory: "User story",
  task: "Task",
  issue: "Issue",
  epic: "Epic",
};

export const ITEM_TYPE_FILTERS: { value: ItemType | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "userstory", label: "User stories" },
  { value: "task", label: "Tasks" },
  { value: "issue", label: "Issues" },
  { value: "epic", label: "Epics" },
];
