import type { ProjectSummary } from "../api";
import { FilterPanel } from "../components/FilterPanel";
import { useFilterSelection, useItemType, usePeriod } from "../filterState";
import { NotFoundPage } from "./HomePage";
import { projectTypes } from "./KanbanPage";
import { PeriodSection } from "./PeriodSection";

export function TrendsPage({
  slug,
  projects,
  taigaUrl,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const types = projectTypes(project);
  const [itemType, setItemType] = useItemType(slug, types);
  const [selection, setSelection] = useFilterSelection(slug);
  const [period] = usePeriod(slug);
  if (projects && !project) {
    return <NotFoundPage />;
  }
  return (
    <>
      <h1>Trends</h1>
      <p className="page-lead muted">
        Period by period over the project's whole history: how the numbers change from one sprint
        or reporting period to the next. The filters narrow the cards; the dates of the other pages
        do not apply here.
      </p>
      <div className="with-filters">
        <FilterPanel
          slug={slug}
          itemType={itemType}
          selection={selection}
          onChange={setSelection}
          typeChoice={{ types, value: itemType, onChange: setItemType }}
        />
        <div className="filtered-content">
          {project && (
            <div className="flow-metrics">
              <PeriodSection
                slug={slug}
                project={project}
                selection={selection}
                itemType={itemType}
                period={{ from: null, to: null, days: period.days }}
                taigaUrl={taigaUrl}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
