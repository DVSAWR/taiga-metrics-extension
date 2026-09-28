import { useEffect, useState } from "react";

import {
  fetchFlow,
  type FlowResponse,
  type ItemType,
  type Module,
  type ProjectSummary,
} from "../api";
import { FilterButton, FilterPanel } from "../components/FilterPanel";
import { TextLink } from "../components/TextLink";
import { SprintSelect } from "../components/SprintSelect";
import { SwimlaneSelect, useSwimlanes } from "../components/SwimlaneSelect";
import { useFilterSelection, useFiltersOpen, usePeriod } from "../filterState";
import { MODULE_INFO, TYPE_LABELS } from "../modules";
import { KANBAN_MODULES, Link, modulePath, projectSettingsPath, type FlowTab } from "../router";
import { KanbanBoard } from "./KanbanPage";
import { MovesTab, OverviewTab } from "./FlowMetrics";
import { HistoryTab } from "./HistoryTab";
import { NotFoundPage } from "./HomePage";

const TABS: { key: FlowTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "moves", label: "Moves" },
  { key: "history", label: "History" },
  { key: "kanban", label: "Kanban" },
];

export function NotConfigured({
  project,
  itemType,
  missing,
}: {
  project: ProjectSummary | undefined;
  itemType: ItemType;
  missing: string[];
}) {
  return (
    <div className="banner banner-fail">
      {TYPE_LABELS[itemType]} of this project have no {missing.join(" and ")} status yet, so lead
      time, cycle time and throughput cannot be measured.{" "}
      {project?.access.can_manage ? (
        <TextLink to={projectSettingsPath(project.slug, "general")}>Set up the statuses</TextLink>
      ) : (
        "Ask the project owner or an admin to set up the statuses."
      )}
    </div>
  );
}

export function ModulePage({
  slug,
  module,
  tab,
  projects,
  taigaUrl,
}: {
  slug: string;
  module: Module;
  tab: FlowTab;
  projects: ProjectSummary[] | null;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const info = MODULE_INFO[module];
  const itemType = info.type;
  const [selection, setSelection] = useFilterSelection(slug);
  const [period, setPeriod] = usePeriod(slug);
  const [filtersOpen, setFiltersOpen] = useFiltersOpen();
  const swimlanes = useSwimlanes(slug, KANBAN_MODULES.includes(module) ? itemType : null);
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsFlow = tab !== "history";

  useEffect(() => {
    if (!needsFlow) {
      return;
    }
    let cancelled = false;
    fetchFlow(slug, itemType, selection, period)
      .then((next) => {
        if (!cancelled) {
          setFlow(next);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType, selection, period, needsFlow]);

  if (
    projects &&
    (!project || !project.modules.includes(module) || (tab === "kanban" && !project.has_kanban))
  ) {
    return <NotFoundPage />;
  }

  const report = flow?.report;
  const tabProps = flow ? { flow, slug, itemType, taigaUrl } : null;

  return (
    <>
      <h1>{info.label}</h1>
      <div className="toolbar">
        <FilterButton
          open={filtersOpen}
          selection={selection}
          period={period}
          onToggle={() => setFiltersOpen(!filtersOpen)}
        />
        <SprintSelect slug={slug} period={period} onChange={setPeriod} />
        <SwimlaneSelect swimlanes={swimlanes} selection={selection} onChange={setSelection} />
      </div>
      <nav className="tabs" aria-label={info.label}>
        {TABS.filter(
          (option) =>
            option.key !== "kanban" ||
            (KANBAN_MODULES.includes(module) && Boolean(project?.has_kanban)),
        ).map((option) => (
          <Link
            key={option.key}
            to={modulePath(slug, module, option.key)}
            className={`tab${option.key === tab ? " active" : ""}`}
          >
            {option.label}
          </Link>
        ))}
      </nav>
      <div className="with-filters">
        {filtersOpen && (
          <FilterPanel
            slug={slug}
            itemType={itemType}
            selection={selection}
            onChange={setSelection}
            period={period}
            onPeriodChange={setPeriod}
          />
        )}
        <div
          className={`filtered-content${needsFlow && flow === null && !error ? " loading" : ""}`}
        >
          {needsFlow && error && <div className="banner banner-fail">{error}</div>}
          {needsFlow && report && !report.configured && (
            <NotConfigured project={project} itemType={itemType} missing={report.missing} />
          )}
          {tab === "overview" && tabProps && <OverviewTab {...tabProps} />}
          {tab === "moves" && tabProps && <MovesTab {...tabProps} />}
          {tab === "kanban" && flow && (
            <KanbanBoard
              slug={slug}
              itemType={itemType}
              report={flow.report}
              swimlanes={swimlanes}
            />
          )}
          {tab === "history" && (
            <HistoryTab
              slug={slug}
              itemType={itemType}
              selection={selection}
              period={period}
              taigaUrl={taigaUrl}
            />
          )}
        </div>
      </div>
    </>
  );
}
