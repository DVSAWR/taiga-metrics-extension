import { useEffect, useRef, useState } from "react";

import type { Module, ProjectSummary } from "../api";
import { settingsTabs } from "./SettingsTabs";
import { Icon, type IconName } from "../icons";
import { ProjectLogo } from "../projectLogo";
import { canOpen, projectHome } from "../projectAccess";
import { MODULE_INFO, MODULE_OF_TYPE } from "../modules";
import { readStored, writeStored } from "../storage";
import {
  KANBAN_MODULES,
  Link,
  MODULES,
  modulePath,
  projectPath,
  scrumPath,
  usePath,
  type Route,
} from "../router";

interface SidebarProps {
  route: Route;
  project: ProjectSummary | null;
  collapsed: boolean;
  onToggle: () => void;
}

interface MenuItemProps {
  to: string | null;
  icon: IconName;
  label: string;
  active: boolean;
}

function MenuItem({ to, icon, label, active }: MenuItemProps) {
  const content = (
    <>
      <Icon name={icon} />
      <span className="menu-option-text">{label}</span>
    </>
  );
  return (
    <li className={`menu-option${active ? " active" : ""}${to ? "" : " disabled"}`}>
      {to ? (
        <Link to={to} title={label}>
          {content}
        </Link>
      ) : (
        <span className="menu-option-link" title={`${label}: select a project first`}>
          {content}
        </span>
      )}
      <span className="menu-dialog" role="presentation">
        {label}
      </span>
    </li>
  );
}

const GROUP_OPEN_KEY = "kanban-menu-open";

function moduleActive(route: Route, module: Module): boolean {
  return (
    ((route.page === "module" || route.page === "card") && route.module === module) ||
    (route.page === "column" && MODULE_OF_TYPE[route.itemType] === module)
  );
}

function MenuGroup({
  icon,
  label,
  items,
}: {
  icon: IconName;
  label: string;
  items: { key: string; to: string; label: string; active: boolean }[];
}) {
  const active = items.some((item) => item.active);
  const [open, setOpen] = useState(() => readStored(GROUP_OPEN_KEY) !== "false");
  const toggle = () => {
    setOpen(!open);
    writeStored(GROUP_OPEN_KEY, String(!open));
  };
  return (
    <li className={`menu-option menu-group${active ? " active" : ""}${open ? " open" : ""}`}>
      <button type="button" className="menu-group-button" title={label} onClick={toggle}>
        <Icon name={icon} />
        <span className="menu-option-text">{label}</span>
        <Icon name="chevronDown" className="menu-group-chevron" />
      </button>
      {open && (
        <ul className="child-menu">
          {items.map((item) => (
            <li key={item.key} className={`menu-option${item.active ? " active" : ""}`}>
              <Link to={item.to} title={item.label}>
                <span className="menu-option-text">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="menu-dialog menu-flyout">
        <span className="menu-flyout-title">{label}</span>
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            className={`menu-flyout-link${item.active ? " active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </li>
  );
}

function moduleItem(project: ProjectSummary, route: Route, module: Module) {
  return (
    <MenuItem
      key={module}
      to={modulePath(project.slug, module)}
      icon={MODULE_INFO[module].icon}
      label={MODULE_INFO[module].label}
      active={moduleActive(route, module)}
    />
  );
}

function boardItems(project: ProjectSummary, route: Route) {
  const shown = MODULES.filter((module) => project.modules.includes(module));
  const onBoard = project.has_kanban
    ? shown.filter((module) => KANBAN_MODULES.includes(module))
    : [];
  const loose = shown.filter(
    (module) => KANBAN_MODULES.includes(module) && !onBoard.includes(module),
  );
  return [
    ...shown
      .filter((module) => module === "epics")
      .map((module) => moduleItem(project, route, module)),
    ...(project.has_scrum
      ? [
          <MenuItem
            key="scrum"
            to={scrumPath(project.slug)}
            icon="moduleScrum"
            label="Scrum"
            active={route.page === "scrum"}
          />,
        ]
      : []),
    ...loose.map((module) => moduleItem(project, route, module)),
    ...(onBoard.length > 0
      ? [
          <MenuGroup
            key="kanban"
            icon="moduleKanban"
            label="Kanban"
            items={onBoard.map((module) => ({
              key: module,
              to: modulePath(project.slug, module),
              label: MODULE_INFO[module].label,
              active: moduleActive(route, module),
            }))}
          />,
        ]
      : []),
    ...(shown.includes("issues") ? [moduleItem(project, route, "issues")] : []),
  ];
}

const NAVBAR_HEIGHT = 48;

function useBottomAnchor() {
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const shown = Math.max(0, NAVBAR_HEIGHT - window.scrollY);
      inner.current?.style.setProperty("--navbar-shown", `${shown}px`);
    };
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(place);
      }
    };
    place();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return inner;
}

export function Sidebar({ route, project, collapsed, onToggle }: SidebarProps) {
  const path = usePath();
  const inner = useBottomAnchor();
  const settingsTarget = settingsTabs(project)[0]?.to ?? null;
  return (
    <aside className={`project-navigation${collapsed ? " collapsed" : ""}`}>
      <div className="nav-inner" ref={inner}>
        <h1 className="sidebar-project">
          {project ? (
            <Link to={projectHome(project)} className="project-link" title={project.name}>
              <ProjectLogo key={path} size={24} slug={project.slug} />
              <span className="project-name">{project.name}</span>
              <span className="menu-dialog menu-dialog-header" role="presentation">
                {project.name}
              </span>
            </Link>
          ) : (
            <Link to="/" className="project-link project-link-empty" title="Select a project">
              <ProjectLogo size={24} />
              <span className="project-name">Select a project</span>
              <span className="menu-dialog menu-dialog-header" role="presentation">
                Select a project
              </span>
            </Link>
          )}
        </h1>
        <ul className="main-menu">
          {(!project || canOpen(project, "flow")) && (
            <MenuItem
              to={project ? projectPath(project.slug) : null}
              icon="graph"
              label="Flow metrics"
              active={route.page === "project"}
            />
          )}
          {project && canOpen(project, "flow") && boardItems(project, route)}
        </ul>
        <ul className="main-menu menu-secondary">
          {(!project || canOpen(project, "search")) && (
            <MenuItem
              to={project ? projectPath(project.slug, "search") : null}
              icon="search"
              label="Search"
              active={route.page === "search"}
            />
          )}
          {(!project || canOpen(project, "team")) && (
            <MenuItem
              to={project ? projectPath(project.slug, "team") : null}
              icon="users"
              label="Team"
              active={route.page === "team"}
            />
          )}
          {settingsTarget && (
            <MenuItem
              to={settingsTarget}
              icon="sidebarSettings"
              label="Settings"
              active={route.page === "project-settings"}
            />
          )}
        </ul>
        <button
          type="button"
          className={`collapse${collapsed ? " collapsed" : ""}`}
          onClick={onToggle}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          {!collapsed && <span>collapse menu</span>}
          <Icon name="chevronsLeft" />
        </button>
      </div>
    </aside>
  );
}
