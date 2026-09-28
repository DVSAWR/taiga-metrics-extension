import type { ProjectSummary } from "../api";
import { ProjectLogo } from "../projectLogo";
import { projectHome } from "../projectAccess";
import { Link } from "../router";

interface HomePageProps {
  projects: ProjectSummary[] | null;
  error: string | null;
}

export function HomePage({ projects, error }: HomePageProps) {
  return (
    <div className="project-list-wrapper">
      <div className="project-list-title">
        <h1>My projects</h1>
      </div>
      <section className="project-list-section">
        <div className="project-list">
          {error && <div className="banner banner-fail">{error}</div>}
          {!projects && !error && <p className="muted">Loading projects...</p>}
          {projects && projects.length === 0 && (
            <p className="muted">
              No projects are shared with you yet. Ask the owner or an admin of a Taiga project to
              enable Taiga Metrics for your role in its settings.
            </p>
          )}
          {projects && projects.length > 0 && (
            <ul>
              {projects.map((project) => (
                <li key={project.id} className="list-itemtype-project">
                  <Link to={projectHome(project)} className="list-itemtype-project-image">
                    <ProjectLogo size={48} slug={project.slug} />
                  </Link>
                  <div className="list-itemtype-project-data">
                    <div className="list-itemtype-data-title">
                      <Link to={projectHome(project)} className="project-title">
                        {project.name}
                      </Link>
                      {project.is_blocked && <span className="blocked-label">Blocked</span>}
                    </div>
                    {project.description && (
                      <div className="project-description">{project.description}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="help-area">
          <p>
            Taiga projects you can open here. Owners decide in each project's settings which roles
            see what.
          </p>
        </aside>
      </section>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <p className="muted">
        <Link to="/">Go to projects</Link>
      </p>
    </>
  );
}
