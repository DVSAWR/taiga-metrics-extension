import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

import type { ItemType, Module } from "./api";
import { MODULE_INFO, MODULE_OF_TYPE } from "./modules";

const NAVIGATION_EVENT = "taiga-metrics:navigate";

export function navigate(to: string, replace = false): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  if (to !== window.location.pathname) {
    if (replace) {
      window.history.replaceState(null, "", to);
    } else {
      window.history.pushState(null, "", to);
    }
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
  }
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATION_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATION_EVENT, update);
    };
  }, []);
  return path;
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
}

export function openInNewTab(to: string): void {
  window.open(to, "_blank", "noopener");
}

export function Link({ to, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      rest.target === "_blank" ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handleClick} {...rest} />;
}

export type Route =
  | { page: "home" }
  | { page: "project"; slug: string }
  | { page: "module"; slug: string; module: Module; tab: FlowTab }
  | { page: "card"; slug: string; module: Module; itemId: number }
  | { page: "kanban"; slug: string; itemType: ItemType | null }
  | { page: "scrum"; slug: string; itemType: ItemType | null }
  | { page: "column"; slug: string; itemType: ItemType; statusId: number }
  | { page: "team"; slug: string }
  | { page: "search"; slug: string }
  | { page: "project-settings"; slug: string; tab: ProjectSettingsTab }
  | { page: "not-found" };

export type ProjectSection = "kanban" | "scrum" | "team" | "search" | "settings";
export type ProjectSettingsTab = "access" | "general" | "calendar" | "status" | "sync";
export type FlowTab = "overview" | "moves" | "history" | "kanban";

const FLOW_TABS: FlowTab[] = ["overview", "moves", "history", "kanban"];
export const MODULES: Module[] = ["epics", "userstories", "tasks", "issues"];
export const KANBAN_MODULES: Module[] = ["userstories", "tasks"];
const ITEM_TYPES: ItemType[] = ["epic", "userstory", "task", "issue"];

export function kanbanPath(slug: string, itemType: ItemType | null = null): string {
  const base = projectPath(slug, "kanban");
  return itemType ? `${base}/${itemType}` : base;
}

export function scrumPath(slug: string, itemType: ItemType | null = null): string {
  const base = projectPath(slug, "scrum");
  return itemType ? `${base}/${itemType}` : base;
}

export function columnPath(slug: string, itemType: ItemType, statusId: number): string {
  return `${modulePath(slug, MODULE_OF_TYPE[itemType])}/status/${statusId}`;
}

export function cardPath(slug: string, module: Module, itemId: number): string {
  return `${projectPath(slug)}/${module}/card/${itemId}`;
}

export function modulePath(slug: string, module: Module, tab: FlowTab = "overview"): string {
  const base = `${projectPath(slug)}/${module}`;
  return tab === "overview" ? base : `${base}/${tab}`;
}

export function projectSettingsPath(slug: string, tab: ProjectSettingsTab): string {
  const base = projectPath(slug, "settings");
  return tab === "access" ? base : `${base}/${tab}`;
}

export function projectPath(slug: string, section?: ProjectSection): string {
  const base = `/projects/${encodeURIComponent(slug)}`;
  return section ? `${base}/${section}` : base;
}

export function routeSlug(route: Route): string | null {
  return route.page === "project" ||
    route.page === "module" ||
    route.page === "card" ||
    route.page === "kanban" ||
    route.page === "scrum" ||
    route.page === "column" ||
    route.page === "team" ||
    route.page === "search" ||
    route.page === "project-settings"
    ? route.slug
    : null;
}

export function matchRoute(path: string): Route {
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (trimmed === "/") {
    return { page: "home" };
  }
  const parts = /^\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/(\d+))?$/.exec(trimmed);
  if (parts?.[1]) {
    const slug = decodeURIComponent(parts[1]);
    const [section, sub, id] = [parts[2], parts[3], parts[4]];
    if (section === "scrum") {
      const itemType = sub ? ITEM_TYPES.find((candidate) => candidate === sub) : null;
      return itemType === undefined || id
        ? { page: "not-found" }
        : { page: "scrum", slug, itemType };
    }
    if (section === "kanban") {
      const itemType = sub ? ITEM_TYPES.find((candidate) => candidate === sub) : null;
      if (itemType === undefined) {
        return { page: "not-found" };
      }
      if (id) {
        return itemType
          ? { page: "column", slug, itemType, statusId: Number(id) }
          : { page: "not-found" };
      }
      return { page: "kanban", slug, itemType };
    }
    if (id) {
      const module = MODULES.find((candidate) => candidate === section);
      if (module && sub === "status") {
        return { page: "column", slug, itemType: MODULE_INFO[module].type, statusId: Number(id) };
      }
      return module && sub === "card"
        ? { page: "card", slug, module, itemId: Number(id) }
        : { page: "not-found" };
    }
    if (!section) {
      return { page: "project", slug };
    }
    if ((section === "team" || section === "search") && !sub) {
      return { page: section, slug };
    }
    if (section === "settings") {
      if (!sub) {
        return { page: "project-settings", slug, tab: "access" };
      }
      if (sub === "general" || sub === "calendar" || sub === "status" || sub === "sync") {
        return { page: "project-settings", slug, tab: sub };
      }
      if (sub === "columns") {
        return { page: "project-settings", slug, tab: "general" };
      }
      return { page: "not-found" };
    }
    const module = MODULES.find((candidate) => candidate === section);
    const tab = sub ? FLOW_TABS.find((candidate) => candidate === sub) : "overview";
    if (module && tab && (tab !== "kanban" || KANBAN_MODULES.includes(module))) {
      return { page: "module", slug, module, tab };
    }
  }
  return { page: "not-found" };
}
