import type { Me, ProjectSummary } from "../api";
import { SidebarPopover } from "./SidebarPopover";

export const INDEPENDENT_NOTE =
  "Taiga Metrics is an independent open-source project, not affiliated with or endorsed by Taiga or Kaleidos Inc.";

export interface HelpLinks {
  community: string;
  repository: string;
}
import { settingsTabs } from "./SettingsTabs";
import { Icon, type IconName } from "../icons";
import { canOpen } from "../projectAccess";
import { cardsPath, Link, peoplePath, personPath, projectPath, type Route } from "../router";

interface SidebarProps {
  route: Route;
  project: ProjectSummary | null;
  collapsed: boolean;
  onToggle: () => void;
  me: Me;
  helpLinks: HelpLinks | null;
  onLogout: () => void;
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

export function Sidebar({
  route,
  project,
  collapsed,
  onToggle,
  me,
  helpLinks,
  onLogout,
}: SidebarProps) {
  const settingsTarget = settingsTabs(project)[0]?.to ?? null;
  return (
    <aside className={`project-navigation${collapsed ? " collapsed" : ""}`}>
      <div className="nav-inner">
        <ul className="main-menu">
          {project && canOpen(project, "overview") && (
            <MenuItem
              to={project ? projectPath(project.slug) : null}
              icon="graph"
              label="Overview"
              active={route.page === "project"}
            />
          )}
          {project && canOpen(project, "directions") && (
            <MenuItem
              to={projectPath(project.slug, "directions")}
              icon="briefcase"
              label="Roles"
              active={route.page === "roles"}
            />
          )}
          {project && canOpen(project, "people") && (
            <MenuItem
              to={peoplePath(project.slug)}
              icon="users"
              label="People"
              active={
                route.page === "people" || (route.page === "person" && route.userId !== null)
              }
            />
          )}
          {project && canOpen(project, "my_page") && (
            <MenuItem
              to={personPath(project.slug)}
              icon="user"
              label="My page"
              active={route.page === "person" && route.userId === null}
            />
          )}
          {project && canOpen(project, "trends") && (
            <MenuItem
              to={project ? projectPath(project.slug, "trends") : null}
              icon="trendingUp"
              label="Trends"
              active={route.page === "trends"}
            />
          )}
          {project && canOpen(project, "activity") && (
            <MenuItem
              to={projectPath(project.slug, "activity")}
              icon="activity"
              label="Activity"
              active={route.page === "activity"}
            />
          )}
          {project && canOpen(project, "cards") && (
            <MenuItem
              to={project ? cardsPath(project.slug) : null}
              icon="search"
              label="Cards"
              active={route.page === "cards" || route.page === "card"}
            />
          )}
        </ul>
        <ul className="main-menu menu-secondary">
          {settingsTarget && (
            <MenuItem
              to={settingsTarget}
              icon="sidebarSettings"
              label="Settings"
              active={route.page === "project-settings"}
            />
          )}
          {helpLinks && (
            <li className="menu-option">
              <SidebarPopover
                label="Help"
                content={
                  <div className="sidebar-popup-links">
                    <a href={helpLinks.community} target="_blank" rel="noreferrer">
                      Taiga Community
                    </a>
                    <a href={helpLinks.repository} target="_blank" rel="noreferrer">
                      Taiga Metrics on GitHub
                    </a>
                    <p className="muted">{INDEPENDENT_NOTE}</p>
                  </div>
                }
              >
                <Icon name="helpCircle" />
                <span className="menu-option-text">Help</span>
              </SidebarPopover>
            </li>
          )}
          <li className="menu-option disabled">
            <span className="menu-option-link" title="Notifications: coming soon">
              <Icon name="bell" />
              <span className="menu-option-text">Notifications</span>
            </span>
          </li>
          <li className="menu-option">
            <SidebarPopover
              label="Account"
              content={
                <div className="sidebar-popup-links">
                  <strong>{me.full_name.trim() || me.username}</strong>
                  <span className="muted">{me.email || `@${me.username}`}</span>
                  <button type="button" onClick={onLogout}>
                    Logout
                  </button>
                </div>
              }
            >
              <Icon name="accountCircle" />
              <span className="menu-option-text">{me.full_name.trim() || me.username}</span>
            </SidebarPopover>
          </li>
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
