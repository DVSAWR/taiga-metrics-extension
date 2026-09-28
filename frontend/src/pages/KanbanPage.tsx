import { useEffect, useState, type ReactNode } from "react";

import {
  fetchFlow,
  type Swimlanes,
  type ColumnTime,
  type FlowResponse,
  type ItemType,
  type ProjectSummary,
} from "../api";
import { formatDuration } from "../charts/format";
import { StatTile } from "../charts/StatTile";
import { CardTitle } from "../components/CardTitle";
import { FilterButton, FilterPanel } from "../components/FilterPanel";
import { PeopleRefs, PersonRef } from "../components/PersonLink";
import { StuckBadge } from "../components/StayBadge";
import { TextLink } from "../components/TextLink";
import { SprintSelect } from "../components/SprintSelect";
import { StatusName } from "../components/StatusName";
import { SwimlaneSelect, UNCLASSIFIED, useSwimlanes } from "../components/SwimlaneSelect";
import { useFilterSelection, useFiltersOpen, usePeriod } from "../filterState";
import { formatNumber, ITEM_TYPE_FILTERS } from "../format";
import { MODULE_INFO, MODULE_OF_TYPE, TYPE_LABELS } from "../modules";
import { columnPath, KANBAN_MODULES, Link, modulePath, MODULES, navigate } from "../router";
import { Empty, MetricCard, StatusMoves } from "./FlowMetrics";
import { NotFoundPage } from "./HomePage";

export function projectTypes(project: ProjectSummary | undefined): ItemType[] {
  const available = new Set(
    MODULES.filter((module) => project?.modules.includes(module)).map(
      (module) => MODULE_INFO[module].type,
    ),
  );
  return ITEM_TYPE_FILTERS.flatMap((option) =>
    option.value && available.has(option.value) ? [option.value] : [],
  );
}

function useColumnFlow(slug: string, itemType: ItemType | null, column: number | null = null) {
  const [selection, setSelection] = useFilterSelection(slug);
  const [period, setPeriod] = usePeriod(slug);
  const [filtersOpen, setFiltersOpen] = useFiltersOpen();
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const swimlanes = useSwimlanes(
    slug,
    itemType && KANBAN_MODULES.includes(MODULE_OF_TYPE[itemType]) ? itemType : null,
  );

  useEffect(() => {
    if (!itemType) {
      return;
    }
    let cancelled = false;
    fetchFlow(slug, itemType, selection, period, column)
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
  }, [slug, itemType, selection, period, column]);

  const toolbar = (extra?: ReactNode) => (
    <div className="toolbar">
      <FilterButton
        open={filtersOpen}
        selection={selection}
        period={period}
        onToggle={() => setFiltersOpen(!filtersOpen)}
      />
      <SprintSelect slug={slug} period={period} onChange={setPeriod} />
      <SwimlaneSelect swimlanes={swimlanes} selection={selection} onChange={setSelection} />
      {extra}
    </div>
  );

  const withFilters = (children: ReactNode) => (
    <div className="with-filters">
      {filtersOpen && itemType && (
        <FilterPanel
          slug={slug}
          itemType={itemType}
          selection={selection}
          onChange={setSelection}
          period={period}
          onPeriodChange={setPeriod}
        />
      )}
      <div className={`filtered-content${flow === null && !error ? " loading" : ""}`}>
        {error && <div className="banner banner-fail">{error}</div>}
        {children}
      </div>
    </div>
  );

  return { flow, toolbar, withFilters };
}

function ColumnHeading({ column }: { column: ColumnTime }) {
  return (
    <span className="column-name">
      <span className="column-color" style={{ background: column.color || "#a9aabc" }} />
      {column.name}
    </span>
  );
}

function Lane({
  slug,
  itemType,
  column,
}: {
  slug: string;
  itemType: ItemType;
  column: ColumnTime;
}) {
  return (
    <Link
      to={columnPath(slug, itemType, column.status_id)}
      target="_blank"
      rel="noreferrer"
      className="kanban-lane"
      style={{ borderTopColor: column.color || "#a9aabc" }}
      title={`${column.name}: cards in it now and how long they stay`}
    >
      <span className="kanban-lane-title">{column.name}</span>
      <span className="kanban-lane-badges">
        {column.type && <span className="badge badge-muted">{column.type}</span>}
        {column.is_deleted && <span className="badge badge-accent">Removed</span>}
      </span>
      <span className="kanban-lane-now">{formatNumber(column.in_column_now)}</span>
      <span className="kanban-lane-caption">in it now</span>
      <dl className="kanban-lane-stats">
        <div>
          <dt>Median</dt>
          <dd>{formatDuration(column.p50)}</dd>
        </div>
        <div>
          <dt>85% within</dt>
          <dd>{formatDuration(column.p85)}</dd>
        </div>
        <div>
          <dt>Passed</dt>
          <dd>{formatNumber(column.cards)}</dd>
        </div>
      </dl>
    </Link>
  );
}

function SwimlaneBoard({
  slug,
  itemType,
  report,
  swimlanes,
}: {
  slug: string;
  itemType: ItemType;
  report: FlowResponse["report"];
  swimlanes: Swimlanes;
}) {
  const now = report.column_cards.filter((card) => card.now);
  const laneOf = (itemId: number) => swimlanes.cards[String(itemId)] ?? null;
  const rows: { id: number | null; name: string; wip: Record<string, number> }[] = [
    ...(now.some((card) => laneOf(card.item_id) === null)
      ? [{ id: null, name: UNCLASSIFIED, wip: {} }]
      : []),
    ...swimlanes.lanes.map((lane) => ({ id: lane.id, name: lane.name, wip: lane.wip })),
  ];
  return (
    <MetricCard
      title="Swimlanes"
      subtitle="Cards in each status of each swimlane right now, with the swimlane's work in progress limit from Taiga where one is set"
    >
      <div className="matrix-scroll">
        <table className="table swimlane-board">
          <thead>
            <tr>
              <th>Swimlane</th>
              {report.columns.map((column) => (
                <th key={column.status_id} className="num">
                  <StatusName
                    slug={slug}
                    itemType={itemType}
                    id={column.is_deleted ? null : column.status_id}
                    name={column.name}
                    color={column.color}
                  />
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cards = now.filter((card) => laneOf(card.item_id) === row.id);
              return (
                <tr key={String(row.id)}>
                  <th scope="row">{row.name}</th>
                  {report.columns.map((column) => {
                    const count = cards.filter(
                      (card) => card.status_id === column.status_id,
                    ).length;
                    const limit = row.wip[String(column.status_id)];
                    const over = limit !== undefined && count > limit;
                    return (
                      <td
                        key={column.status_id}
                        className={`num${over ? " over-limit" : ""}`}
                        title={
                          limit === undefined
                            ? undefined
                            : `Limit ${limit}${over ? `: ${count - limit} over` : ""}`
                        }
                      >
                        {count > 0 ? formatNumber(count) : <span className="matrix-empty">·</span>}
                        {limit !== undefined && <span className="wip-limit"> / {limit}</span>}
                      </td>
                    );
                  })}
                  <td className="num">{formatNumber(cards.length)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </MetricCard>
  );
}

export function KanbanBoard({
  slug,
  itemType,
  report,
  swimlanes = null,
}: {
  slug: string;
  itemType: ItemType;
  report: FlowResponse["report"];
  swimlanes?: Swimlanes | null;
}) {
  if (report.columns.length === 0) {
    return <Empty>This card type has no statuses.</Empty>;
  }
  return (
    <div className="flow-metrics">
      <div className="kanban-board">
        {report.columns.map((column) => (
          <Lane key={column.status_id} slug={slug} itemType={itemType} column={column} />
        ))}
      </div>
      {swimlanes && swimlanes.lanes.length > 0 && (
        <SwimlaneBoard slug={slug} itemType={itemType} report={report} swimlanes={swimlanes} />
      )}
    </div>
  );
}

export function KanbanPage({
  slug,
  projects,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const target = project?.has_kanban
    ? KANBAN_MODULES.find((module) => project.modules.includes(module))
    : undefined;
  useEffect(() => {
    if (target) {
      navigate(modulePath(slug, target, "kanban"), true);
    }
  }, [slug, target]);
  if (projects && !target) {
    return <NotFoundPage />;
  }
  return null;
}

export function ColumnPage({
  slug,
  itemType,
  statusId,
  projects,
  taigaUrl,
}: {
  slug: string;
  itemType: ItemType;
  statusId: number;
  projects: ProjectSummary[] | null;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const { flow, toolbar, withFilters } = useColumnFlow(slug, itemType, statusId);

  if (projects && !project) {
    return <NotFoundPage />;
  }

  const report = flow?.report;
  const column = report?.columns.find((candidate) => candidate.status_id === statusId);

  return (
    <>
      <div className="breadcrumb">
        <TextLink to={modulePath(slug, MODULE_OF_TYPE[itemType])}>
          {TYPE_LABELS[itemType]}
        </TextLink>
      </div>
      <h1 className="column-title">
        {column ? <ColumnHeading column={column} /> : "Status"}
        {column?.type && <span className="badge badge-muted">{column.type}</span>}
        {column?.is_deleted && <span className="badge badge-accent">Removed</span>}
      </h1>
      {toolbar()}
      {withFilters(
        flow &&
          report &&
          (!column ? (
            <Empty>This status is not in the report.</Empty>
          ) : (
            <div className="flow-metrics">
              <div className="stat-row">
                <StatTile
                  label="In it now"
                  value={formatNumber(column.in_column_now)}
                  detail={`of ${formatNumber(report.cards)} cards`}
                />
                <StatTile
                  label="Time per card, median"
                  value={formatDuration(column.p50)}
                  detail="all visits of a card added up"
                />
                <StatTile
                  label="85% within"
                  value={formatDuration(column.p85)}
                  detail={`95% within ${formatDuration(column.p95)}`}
                />
                <StatTile
                  label="Cards passed"
                  value={formatNumber(column.cards)}
                  detail="left the status in the period"
                />
              </div>

              <MetricCard
                title="Cards in the status now"
                subtitle={
                  <>
                    How long each card has been here. <StuckBadge level="yellow" /> means longer
                    than 85% of past stays, <StuckBadge level="red" /> longer than 95%.
                  </>
                }
              >
                {report.current.length === 0 ? (
                  <Empty>No card is in this status now.</Empty>
                ) : (
                  <table className="table stuck-table">
                    <colgroup>
                      <col />
                      <col className="col-people" />
                      <col className="col-people" />
                      <col className="col-time" />
                      <col className="col-time" />
                      <col className="col-level" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Card</th>
                        <th>Assigned</th>
                        <th>Created by</th>
                        <th className="num">In status</th>
                        <th className="num" title="Time since the last move or assignee change">
                          No activity
                        </th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {report.current.map((card) => (
                        <tr key={card.item_id}>
                          <td className="truncate" title={card.subject}>
                            <CardTitle
                              slug={slug}
                              itemType={itemType}
                              itemId={card.item_id}
                              cardRef={card.ref}
                              subject={card.subject}
                              isDeleted={false}
                              taigaUrl={taigaUrl}
                            />
                          </td>
                          <td className="truncate">
                            <PeopleRefs
                              directory={flow}
                              ids={card.assignees}
                              nobody="Unassigned"
                            />
                          </td>
                          <td className="truncate">
                            <PersonRef directory={flow} id={card.created_by} nobody="Unknown" />
                          </td>
                          <td className="num">{formatDuration(card.days_in_column)}</td>
                          <td className="num">{formatDuration(card.days_idle)}</td>
                          <td className="nowrap">
                            <StuckBadge level={card.level} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </MetricCard>

              <StatusMoves
                flow={flow}
                slug={slug}
                itemType={itemType}
                taigaUrl={taigaUrl}
                column={statusId}
              />
            </div>
          )),
      )}
    </>
  );
}
