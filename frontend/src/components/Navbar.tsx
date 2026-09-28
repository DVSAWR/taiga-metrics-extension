import { useRef, useState, type CSSProperties } from "react";

import type { Me, ProjectSummary } from "../api";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "../icons";
import { UserPhoto } from "./UserPhoto";
import { ProjectLogo } from "../projectLogo";
import { projectHome } from "../projectAccess";
import { Link, routeSlug, usePath, type Route } from "../router";

export const INDEPENDENT_NOTE =
  "Taiga Metrics is an independent open-source project, not affiliated with or endorsed by Taiga or Kaleidos Inc.";

export interface HelpLinks {
  community: string;
  repository: string;
}

interface NavbarProps {
  route: Route;
  projects: ProjectSummary[] | null;
  projectsError: string | null;
  currentSlug: string | null;
  me: Me;
  onLogout: () => void;
  helpLinks: HelpLinks | null;
}

function ProjectsDropdown({ route, projects, projectsError, currentSlug }: NavbarProps) {
  const path = usePath();
  const active = route.page === "home" || routeSlug(route) !== null;
  return (
    <div className={`dropdown-project-list topnav-dropdown-wrapper${active ? " active" : ""}`}>
      <Link to="/" className="dropdown-project-list-projects" title="Projects">
        <Icon name="folder" className="icon-folder" />
        <span>Projects</span>
      </Link>
      <div className="navbar-dropdown">
        {projectsError && <p className="dropdown-message error">{projectsError}</p>}
        {projects && projects.length === 0 && (
          <p className="dropdown-message">No projects are shared with you yet.</p>
        )}
        {projects && projects.length > 0 && (
          <ul className="dropdown-project-list-ul">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to={projectHome(project)}
                  className={`dropdown-project-list-link${
                    project.slug === currentSlug ? " active" : ""
                  }${project.is_blocked ? " blocked-project" : ""}`}
                >
                  <ProjectLogo key={path} size={24} slug={project.slug} />
                  <span>{project.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link to="/" className="see-more-projects-btn">
          View all projects
        </Link>
      </div>
    </div>
  );
}

function UserDropdown({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const name = me.full_name.trim() || me.username;
  const path = usePath();
  return (
    <div className="dropdown-user topnav-dropdown-wrapper">
      <div className="dropdown-user-navbar">
        <span className="user-avatar" title={name}>
          <span className="avatar-circle">
            <UserPhoto key={path} userId={me.id} />
          </span>
        </span>
        <button type="button" className="chevron" aria-label="Account menu">
          <Icon name="chevronDown" />
        </button>
      </div>
      <div className="navbar-dropdown navbar-dropdown-user">
        <div className="dropdown-user-profile">
          <span className="avatar-circle avatar-large">
            <UserPhoto key={path} userId={me.id} />
          </span>
          <div className="dropdown-user-data">
            <span className="full-name">{name}</span>
            <span className="email">{me.email || `@${me.username}`}</span>
          </div>
        </div>
        <ul>
          <li className="user-profile-option-last">
            <button type="button" className="dropdown-action" onClick={onLogout}>
              Logout
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

const HELP_MENU_WIDTH = 260;
const SCREEN_MARGIN = 16;

function HelpDropdown({ links }: { links: HelpLinks }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const place = () => {
    const left = wrapper.current?.getBoundingClientRect().left ?? 0;
    setShift(
      Math.max(0, left + HELP_MENU_WIDTH + SCREEN_MARGIN - document.documentElement.clientWidth),
    );
  };
  return (
    <div
      ref={wrapper}
      className="topnav-dropdown-wrapper nav-bar-support"
      style={{ "--menu-shift": `${shift}px` } as CSSProperties}
      onMouseEnter={place}
      onFocus={place}
    >
      <a href={links.community} target="_blank" rel="noreferrer" title="Help">
        <Icon name="helpCircle" />
      </a>
      <div className="navbar-dropdown navigation-help">
        <ul>
          <li>
            <a href={links.community} target="_blank" rel="noreferrer" title="Taiga Community">
              <Icon name="resources" />
              <span>Taiga Community</span>
            </a>
          </li>
          <li>
            <a
              href={links.repository}
              target="_blank"
              rel="noreferrer"
              title="Taiga Metrics on GitHub"
            >
              <Icon name="github" />
              <span>Taiga Metrics on GitHub</span>
            </a>
          </li>
        </ul>
        <p className="navigation-help-note">{INDEPENDENT_NOTE}</p>
      </div>
    </div>
  );
}

export function Navbar(props: NavbarProps) {
  return (
    <nav className="navbar">
      <div className="nav-left">
        <Link to="/" className="logo" title="Taiga Metrics">
          <BrandLogo />
        </Link>
        <ProjectsDropdown {...props} />
      </div>
      <div className="nav-right">
        {props.helpLinks && <HelpDropdown links={props.helpLinks} />}
        <span className="nav-bar-notifications" title="Notifications: coming soon">
          <Icon name="bell" />
        </span>
        <UserDropdown me={props.me} onLogout={props.onLogout} />
      </div>
    </nav>
  );
}
