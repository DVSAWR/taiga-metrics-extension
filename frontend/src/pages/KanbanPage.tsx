import { useEffect, useState, type ReactNode } from "react";

import {
  fetchFlow,
  fetchDirections,
  type ColumnTime,
  type DirectionRef,
  type FlowResponse,
  type ItemType,
  type ProjectSummary,
} from "../api";
import { formatDuration } from "../charts/format";
import { StatTile } from "../charts/StatTile";
import { FilterPanel } from "../components/FilterPanel";
import { PersonRef } from "../components/PersonLink";
import { MetricList } from "../components/MetricList";
import { MetricPopup } from "../components/MetricPopup";
import { StuckList } from "../components/StuckList";
import { TextLink } from "../components/TextLink";
import { SwimlaneSelect, useSwimlanes } from "../components/SwimlaneSelect";
import { useFilterSelection, usePeriod } from "../filterState";
import { formatNumber, ITEM_TYPE_FILTERS } from "../format";
import { MODULE_INFO, MODULE_OF_TYPE, TYPE_LABELS } from "../modules";
import { KANBAN_MODULES, MODULES, projectPath, rolePath } from "../router";
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
    setFlow(null);
    setError(null);
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
      <SwimlaneSelect swimlanes={swimlanes} selection={selection} onChange={setSelection} />
      {extra}
    </div>
  );

  const withFilters = (children: ReactNode) => (
    <div className="with-filters">
      {itemType && (
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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle] ?? null
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function ColumnPeople({
  flow,
  directions,
  statusId,
  slug,
  itemType,
  taigaUrl,
}: {
  flow: FlowResponse;
  directions: DirectionRef[];
  statusId: number;
  slug: string;
  itemType: ItemType;
  taigaUrl: string | null;
}) {
  const roleIds = flow.column_roles[String(statusId)] ?? [];
  const roles = directions.filter((role) => roleIds.includes(role.role_id));
  const members = new Set(roles.flatMap((role) => role.members));
  const cards = flow.report.column_cards.filter((card) => card.status_id === statusId);
  const people = new Set([...members, ...cards.flatMap((card) => card.assignees)]);
  const rows = [...people]
    .map((id) => {
      const own = cards.filter((card) => card.assignees.includes(id));
      const now = own.filter((card) => card.now);
      const passed = own.filter((card) => !card.now);
      const memberRoles = roles.filter((role) => role.members.includes(id));
      return { id, now, passed, member: members.has(id), memberRoles };
    })
    .sort(
      (a, b) =>
        Number(b.member) - Number(a.member) ||
        b.now.length - a.now.length ||
        b.passed.length - a.passed.length ||
        (flow.people[String(a.id)] ?? "").localeCompare(flow.people[String(b.id)] ?? ""),
    );
  const personList = (row: (typeof rows)[number], now: boolean) => (
    <MetricList
      flow={flow}
      slug={slug}
      itemType={itemType}
      taigaUrl={taigaUrl}
      list={{
        title: `${flow.people[String(row.id)] ?? `User ${row.id}`}: ${
          now ? "in status now" : "passed in period"
        }`,
        timeLabel: "In status",
        cards: (now ? row.now : row.passed).map((card) => ({
          item_id: card.item_id,
          ref: card.ref,
          subject: card.subject,
          status_id: card.status_id,
          days: card.days,
          assignees: card.assignees,
          is_deleted: card.is_deleted,
        })),
      }}
    />
  );
  return (
    <MetricCard
      title="By person in this status"
      subtitle="Members of the responsible roles come first. Shared cards count for each assigned person; passed cards use assignees at the last exit in the period."
    >
      {roles.length > 0 && (
        <p className="column-roles">
          Responsible roles:{" "}
          {roles.map((role, index) => (
            <span key={role.role_id}>
              {index > 0 ? ", " : ""}
              <TextLink to={rolePath(slug, role.role_id)}>{role.name}</TextLink>
            </span>
          ))}
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>No assignees in this status or its responsible roles.</Empty>
      ) : (
        <table className="table table-compact breakdown-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th className="num">In it now</th>
              <th className="num">Passed</th>
              <th className="num">Median time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <PersonRef directory={flow} id={row.id} nobody="Unknown" />
                </td>
                <td>
                  {row.member ? (
                    row.memberRoles.map((role, index) => (
                      <span key={role.role_id}>
                        {index > 0 ? ", " : ""}
                        <TextLink to={rolePath(slug, role.role_id)}>{role.name}</TextLink>
                      </span>
                    ))
                  ) : (
                    <span className="muted-inline">Outside responsible roles</span>
                  )}
                </td>
                <td className="num">
                  <MetricPopup
                    label={`Show ${flow.people[String(row.id)] ?? row.id}: in status now`}
                    content={personList(row, true)}
                  >
                    {formatNumber(row.now.length)}
                  </MetricPopup>
                </td>
                <td className="num">
                  <MetricPopup
                    label={`Show ${flow.people[String(row.id)] ?? row.id}: passed in period`}
                    content={personList(row, false)}
                  >
                    {formatNumber(row.passed.length)}
                  </MetricPopup>
                </td>
                <td className="num">
                  {formatDuration(median(row.passed.map((card) => card.days)))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </MetricCard>
  );
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
  const [directions, setDirections] = useState<DirectionRef[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchDirections(slug)
      .then((found) => !cancelled && setDirections(found))
      .catch(() => !cancelled && setDirections([]));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (projects && !project) {
    return <NotFoundPage />;
  }

  const report = flow?.report;
  const column = report?.columns.find((candidate) => candidate.status_id === statusId);

  return (
    <>
      <div className="breadcrumb">
        <TextLink to={projectPath(slug)}>Overview</TextLink> · {TYPE_LABELS[itemType]}
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
                subtitle="Age since creation, total time across all visits to this status, and the current stay. Work cards are overdue when age or total status time exceeds the historical p85; the stronger level exceeds p95."
              >
                {report.current.length === 0 ? (
                  <Empty>No card is in this status now.</Empty>
                ) : (
                  <StuckList
                    slug={slug}
                    itemType={itemType}
                    cards={report.current}
                    columns={report.columns}
                    directory={flow}
                    taigaUrl={taigaUrl}
                    showCreatedBy
                  />
                )}
              </MetricCard>

              <ColumnPeople
                flow={flow}
                directions={directions}
                statusId={statusId}
                slug={slug}
                itemType={itemType}
                taigaUrl={taigaUrl}
              />

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
