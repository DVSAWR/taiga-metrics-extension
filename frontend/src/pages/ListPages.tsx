import { useEffect, useState } from "react";

import {
  fetchAnalysis,
  fetchDirectionSummary,
  fetchDirections,
  fetchFlow,
  fetchPeopleSummary,
  type Analysis,
  type BreakdownRow,
  type DirectionRef,
  type FlowResponse,
  type FilterSelection,
  type ItemType,
  type Me,
  type Period,
  type PersonSummary,
  type ProjectSummary,
} from "../api";
import { rowCards, subjectCards, type CountKind } from "../cardLists";
import { formatDuration } from "../charts/format";
import { Breakdown } from "../components/Breakdown";
import { FilterPanel } from "../components/FilterPanel";
import { MetricList } from "../components/MetricList";
import { MetricPopup } from "../components/MetricPopup";
import { PersonLink } from "../components/PersonLink";
import { TextLink } from "../components/TextLink";
import { rolePath } from "../router";
import { canOpen } from "../projectAccess";
import { useItemType, usePeriod, useFilterSelection } from "../filterState";
import { firstTime, formatNumber } from "../format";
import { Empty, MetricCard } from "./FlowMetrics";
import { NotFoundPage } from "./HomePage";
import { projectTypes } from "./KanbanPage";

type PersonMetricKind = CountKind | "lead_time" | "cycle_time";

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function PersonCount({
  slug,
  person,
  itemType,
  period,
  selection,
  kind,
  value,
}: {
  slug: string;
  person: PersonSummary;
  itemType: ItemType;
  period: Period;
  selection: FilterSelection;
  kind: PersonMetricKind;
  value: number | null;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setAnalysis(null);
    setError(null);
  }, [slug, person.user_id, itemType, period, selection]);
  if (value === null || (value === 0 && kind !== "lead_time" && kind !== "cycle_time"))
    return <>·</>;
  const open = () => {
    if (analysis) return;
    fetchAnalysis(slug, { kind: "person", id: person.user_id }, itemType, selection, period)
      .then((next) => {
        setAnalysis(next);
        setError(null);
      })
      .catch((reason: unknown) => setError(errorText(reason)));
  };
  const list =
    analysis && (kind === "lead_time" || kind === "cycle_time")
      ? {
          title: `${person.name}: ${kind === "lead_time" ? "lead time" : "cycle time"} samples`,
          timeLabel: kind === "lead_time" ? "Lead time" : "Cycle time",
          cards: analysis.flow.report[kind].samples.map((sample) => ({
            item_id: sample.item_id,
            ref: sample.ref,
            subject: sample.subject,
            status_id: null,
            days: sample.days,
            assignees: sample.assignees,
            is_deleted: sample.is_deleted,
          })),
        }
      : analysis
        ? subjectCards(analysis.flow.report, analysis.statuses, kind as CountKind, person.user_id)
        : null;
  return (
    <MetricPopup
      label={`Show ${person.name}: ${kind}`}
      onOpen={open}
      content={
        error ? (
          <p className="banner banner-fail">{error}</p>
        ) : analysis ? (
          <MetricList
            list={list!}
            flow={analysis.flow}
            slug={slug}
            itemType={itemType}
            taigaUrl={null}
          />
        ) : (
          <p className="muted">Loading cards...</p>
        )
      }
    >
      {kind === "lead_time" || kind === "cycle_time" ? formatDuration(value) : formatNumber(value)}
    </MetricPopup>
  );
}

function PeopleTable({
  slug,
  people,
  roles,
  me,
  itemType,
  period,
  selection,
  canOpenRole,
}: {
  slug: string;
  people: PersonSummary[];
  roles: Map<number, string>;
  me: Me;
  itemType: ItemType;
  period: Period;
  selection: FilterSelection;
  canOpenRole: boolean;
}) {
  const rows = [...people].sort(
    (a, b) => Number(b.user_id === me.id) - Number(a.user_id === me.id),
  );
  return (
    <div className="wide-table-scroll">
      <table className="table breakdown-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th className="num">In progress</th>
            <th className="num">Stuck</th>
            <th className="num">Finished</th>
            <th className="num">Lead time</th>
            <th className="num">Cycle time</th>
            <th className="num">First time</th>
            <th className="num">Return events</th>
            <th className="num">Returned cards</th>
            <th
              className="num"
              title="Return events after each card's first return credited to this person in the period"
            >
              Repeat returns
            </th>
            <th
              className="num"
              title="Cards with two or more credited returns / all returned cards for this person in the period"
            >
              Repeat return rate
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => {
            const count = (kind: PersonMetricKind, value: number | null) => (
              <PersonCount
                slug={slug}
                person={person}
                itemType={itemType}
                period={period}
                selection={selection}
                kind={kind}
                value={value}
              />
            );
            return (
              <tr key={person.user_id}>
                <td>
                  <PersonLink name={person.name} id={person.user_id} />
                  {person.user_id === me.id && <span className="badge badge-muted">You</span>}
                </td>
                <td>
                  {person.role_id !== null ? (
                    canOpenRole && roles.has(person.role_id) ? (
                      <TextLink to={rolePath(slug, person.role_id)}>
                        {roles.get(person.role_id)}
                      </TextLink>
                    ) : (
                      <span className="muted-inline">
                        {roles.get(person.role_id) ?? `Role ${person.role_id}`}
                      </span>
                    )
                  ) : (
                    ""
                  )}
                </td>
                <td className="num">{count("in_progress", person.in_progress)}</td>
                <td className={`num${person.stuck ? " over-limit" : ""}`}>
                  {count("stuck", person.stuck)}
                </td>
                <td className="num">{count("finished", person.finished)}</td>
                <td className="num">{count("lead_time", person.lead_p50)}</td>
                <td className="num">{count("cycle_time", person.cycle_p50)}</td>
                <td className="num">
                  {count("first_time", person.clean_passes)}
                  <span className="quality-percent">
                    {firstTime(person.passes, person.clean_passes)}
                  </span>
                </td>
                <td className="num">{count("returns", person.returns)}</td>
                <td className="num">{formatNumber(person.returned_cards)}</td>
                <td className="num">{count("repeat_returns", person.repeat_returns)}</td>
                <td className="num">
                  {person.repeat_rate === null ? "-" : `${Math.round(person.repeat_rate * 100)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PeoplePage({
  slug,
  projects,
  me,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
  me: Me;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const types = projectTypes(project);
  const [itemType, setItemType] = useItemType(slug, types);
  const [period, setPeriod] = usePeriod(slug);
  const [selection, setSelection] = useFilterSelection(slug);
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [directions, setDirections] = useState<DirectionRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPeople(null);
    fetchPeopleSummary(slug, itemType, period, selection)
      .then((next) => {
        if (!cancelled) {
          setPeople(next);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType, period, selection]);
  useEffect(() => {
    let cancelled = false;
    fetchDirections(slug)
      .then((next) => !cancelled && setDirections(next))
      .catch(() => !cancelled && setDirections([]));
    return () => {
      cancelled = true;
    };
  }, [slug]);
  if (projects && !project) return <NotFoundPage />;
  const roles = new Map(directions.map((direction) => [direction.role_id, direction.name]));
  return (
    <>
      <h1>People</h1>
      <div className="with-filters">
        <FilterPanel
          slug={slug}
          itemType={itemType}
          selection={selection}
          onChange={setSelection}
          period={period}
          onPeriodChange={setPeriod}
          typeChoice={{ types, value: itemType, onChange: setItemType }}
          personId={null}
        />
        <div className={`filtered-content${people === null && !error ? " loading" : ""}`}>
          {error && <div className="banner banner-fail">{error}</div>}
          {people && (
            <MetricCard
              title="People"
              subtitle="Click a number for its cards, or a name for the person's page."
            >
              {people.length === 0 ? (
                <Empty>Nobody to show.</Empty>
              ) : (
                <PeopleTable
                  key={`${itemType}:${JSON.stringify(period)}:${JSON.stringify(selection)}`}
                  slug={slug}
                  people={people}
                  roles={roles}
                  me={me}
                  itemType={itemType}
                  period={period}
                  selection={selection}
                  canOpenRole={Boolean(project && canOpen(project, "directions"))}
                />
              )}
            </MetricCard>
          )}
        </div>
      </div>
    </>
  );
}

export function RolesPage({
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
  const [period, setPeriod] = usePeriod(slug);
  const [selection, setSelection] = useFilterSelection(slug);
  const [roles, setRoles] = useState<BreakdownRow[] | null>(null);
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRoles(null);
    setFlow(null);
    Promise.all([
      fetchDirectionSummary(slug, itemType, period, selection),
      fetchFlow(slug, itemType, selection, period),
    ])
      .then(([nextRoles, nextFlow]) => {
        if (!cancelled) {
          setRoles(nextRoles);
          setFlow(nextFlow);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType, period, selection]);
  if (projects && !project) return <NotFoundPage />;
  return (
    <>
      <h1>Roles</h1>
      <div className="with-filters">
        <FilterPanel
          slug={slug}
          itemType={itemType}
          selection={selection}
          onChange={setSelection}
          period={period}
          onPeriodChange={setPeriod}
          typeChoice={{ types, value: itemType, onChange: setItemType }}
          roleId={null}
        />
        <div className={`filtered-content${roles === null && !error ? " loading" : ""}`}>
          {error && <div className="banner banner-fail">{error}</div>}
          {roles && flow && (
            <MetricCard
              title="Roles"
              subtitle="Open a role to see its statuses and work by person. Click a number for the underlying cards."
            >
              {roles.length === 0 ? (
                <Empty>No roles assigned to these statuses yet.</Empty>
              ) : (
                <Breakdown
                  slug={slug}
                  itemType={itemType}
                  rows={roles}
                  expand={(row, kind) => (
                    <MetricList
                      list={rowCards(flow.report, null, row, kind)}
                      flow={flow}
                      slug={slug}
                      itemType={itemType}
                      taigaUrl={taigaUrl}
                    />
                  )}
                />
              )}
            </MetricCard>
          )}
        </div>
      </div>
    </>
  );
}
