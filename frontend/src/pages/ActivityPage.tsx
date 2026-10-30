import { Fragment, useEffect, useState } from "react";

import {
  fetchDirections,
  fetchFilterPanel,
  fetchTeamActivity,
  fetchTeamEvents,
  parseSubject,
  type ActivityKind,
  type DirectionRef,
  type Me,
  type Period,
  type FilterSelection,
  type ItemType,
  type ProjectSummary,
  type TeamActivity,
} from "../api";
import {
  ACTIVITY_KINDS,
  ActivityMap,
  KIND_LABELS,
  shiftDay,
  today,
} from "../components/ActivityMap";
import { FilterPanel } from "../components/FilterPanel";
import { useExclusiveMetricList } from "../components/MetricPopup";
import { PersonLink } from "../components/PersonLink";
import { SortTitle, sortRows, useSort } from "../components/SortTitle";
import { EMPTY_SELECTION, useFilterSelection, useItemType, usePeriod } from "../filterState";
import { formatDateTime, formatNumber } from "../format";
import { Empty, MetricCard } from "./FlowMetrics";
import { NotFoundPage } from "./HomePage";
import { projectTypes } from "./KanbanPage";
import { EventDetail, EventTarget, useLoaded } from "./PersonPage";

const YEAR = 364;
const EVERYONE = "everyone";

type Counts = Partial<Record<ActivityKind, number>>;

interface Opened {
  person: number | null;
  kind: ActivityKind | null;
}

function readWho(): string {
  return new URLSearchParams(window.location.search).get("who") ?? "";
}

function writeWho(who: string) {
  const query = new URLSearchParams(window.location.search);
  if (who === EVERYONE) {
    query.delete("who");
  } else {
    query.set("who", who);
  }
  const text = query.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${text ? `?${text}` : ""}`);
}

function sumOf(counts: Counts): number {
  return Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
}

function add(into: Counts, counts: Counts) {
  for (const kind of ACTIVITY_KINDS) {
    if (counts[kind]) {
      into[kind] = (into[kind] ?? 0) + (counts[kind] ?? 0);
    }
  }
}

function Events({
  slug,
  project,
  period,
  role,
  person,
  kind,
  taigaUrl,
  selection,
  itemType,
}: {
  slug: string;
  project: ProjectSummary;
  period: Period;
  role: number | null;
  person: number | null;
  kind: ActivityKind | null;
  taigaUrl: string | null;
  selection: FilterSelection;
  itemType: ItemType;
}) {
  const [events, error] = useLoaded(
    () => fetchTeamEvents(slug, period, role, person, kind, selection, itemType),
    [slug, period.from, period.to, role, person, kind, selection, itemType],
  );
  const [sort, onSort] = useSort();
  if (error) {
    return <div className="banner banner-fail">{error}</div>;
  }
  if (!events) {
    return <p className="muted metric-empty">Loading...</p>;
  }
  if (events.events.length === 0) {
    return <Empty>Nothing here.</Empty>;
  }
  return (
    <div className="activity-events">
      <table className="table activity-table">
        <thead>
          <tr>
            {(
              [
                ["When", "when"],
                ["Who", "who"],
                ["What", "what"],
                ["Card", "card"],
                ["Details", "details"],
              ] as [string, string][]
            ).map(([label, key]) => (
              <th key={key}>
                <SortTitle label={label} sortKey={key} sort={sort} onSort={onSort} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortRows(events.events, sort, (event, key) =>
            key === "when"
              ? event.happened_at
              : key === "who"
                ? event.user_name
                : key === "what"
                  ? KIND_LABELS[event.kind]
                  : key === "card"
                    ? event.ref ?? event.item_id
                    : `${event.from_status ?? ""} ${event.to_status ?? ""}`,
          ).map((event) => (
            <tr key={event.id}>
              <td className="nowrap">{formatDateTime(event.happened_at)}</td>
              <td className="nowrap">
                <PersonLink name={event.user_name} id={event.user_id} />
              </td>
              <td className="nowrap">{KIND_LABELS[event.kind]}</td>
              <td>
                <EventTarget event={event} project={project} taigaUrl={taigaUrl} />
              </td>
              <td>
                <EventDetail event={event} slug={slug} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.truncated && (
        <p className="muted metric-empty">
          The latest {formatNumber(events.events.length)} of {formatNumber(events.total)}; pick a
          day or a shorter period to see older ones.
        </p>
      )}
    </div>
  );
}

function Count({ value, open, onClick }: { value: number; open: boolean; onClick: () => void }) {
  if (!value) {
    return <>·</>;
  }
  return (
    <button
      type="button"
      className={`count-open${open ? " open" : ""}`}
      aria-expanded={open}
      title="Show the actions"
      onClick={onClick}
    >
      {formatNumber(value)}
    </button>
  );
}

export function ActivityPage({
  slug,
  projects,
  me,
  taigaUrl,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
  me: Me;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const [period, setPeriod] = usePeriod(slug);
  const types = projectTypes(project);
  const [itemType, setItemType] = useItemType(slug, types);
  const [selection, setSelection] = useFilterSelection(slug);
  const teamWide = project ? project.access.scope === "all" : true;
  const defaultWho = teamWide ? EVERYONE : `person:${me.id}`;
  const [who, setWho] = useState(() => readWho() || defaultWho);
  const [day, setDay] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const announceOpen = useExclusiveMetricList(() => setOpened(null));
  const [directions, setDirections] = useState<DirectionRef[]>([]);
  const [people, setPeople] = useState<{ user_id: number; name: string }[]>([]);
  const subject = parseSubject(who);
  const role = subject?.kind === "role" ? subject.id : null;
  const person = subject?.kind === "person" ? subject.id : null;
  const end = period.to && period.to > today() ? period.to : today();
  const start =
    period.from && period.from < shiftDay(end, -YEAR) ? period.from : shiftDay(end, -YEAR);

  useEffect(() => writeWho(who), [who]);
  useEffect(() => setWho(readWho() || defaultWho), [slug]);
  useEffect(() => {
    if (!teamWide && who !== defaultWho) setWho(defaultWho);
  }, [teamWide, who, defaultWho]);
  useEffect(() => {
    setDay(null);
    setOpened(null);
  }, [slug, who, period.from, period.to, selection, itemType]);
  useEffect(() => {
    let cancelled = false;
    fetchDirections(slug)
      .then((next) => !cancelled && setDirections(next))
      .catch(() => !cancelled && setDirections([]));
    fetchFilterPanel(slug, null, EMPTY_SELECTION)
      .then(
        (panel) =>
          !cancelled &&
          setPeople(
            panel.categories
              .find((category) => category.key === "assigned")
              ?.values.filter((value) => /^\d+$/.test(value.value))
              .map((value) => ({ user_id: Number(value.value), name: value.label })) ?? [],
          ),
      )
      .catch(() => !cancelled && setPeople([]));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const [activity, error] = useLoaded<TeamActivity>(
    () => fetchTeamActivity(slug, { from: start, to: end }, role, person, selection, itemType),
    [slug, start, end, role, person, selection, itemType],
  );

  if (projects && !project) {
    return <NotFoundPage />;
  }

  const from = day ?? period.from;
  const to = day ?? period.to;
  const inside = (candidate: string) => (!from || candidate >= from) && (!to || candidate <= to);
  const totals: Counts = {};
  const byPerson = new Map<number, Counts>();
  for (const entry of activity?.days ?? []) {
    if (!inside(entry.day)) {
      continue;
    }
    add(totals, entry.counts);
    for (const [id, counts] of Object.entries(entry.person_kinds)) {
      const known = byPerson.get(Number(id)) ?? {};
      add(known, counts);
      byPerson.set(Number(id), known);
    }
  }
  const kinds = ACTIVITY_KINDS.filter((kind) => totals[kind]);
  const total = sumOf(totals);
  const rows = [...byPerson.entries()]
    .map(([id, counts]) => ({ id, name: activity?.people[id] ?? `#${id}`, counts }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shownPeriod: Period = { from, to, days: period.days };
  const scopeText = day ? day : period.from || period.to ? "the period" : "all time";
  const isOpen = (target: Opened) =>
    opened?.person === target.person && opened.kind === target.kind;
  const toggle = (target: Opened) => {
    if (!isOpen(target)) announceOpen();
    setOpened(isOpen(target) ? null : target);
  };
  const events = (target: Opened) =>
    project ? (
      <Events
        slug={slug}
        project={project}
        period={shownPeriod}
        role={role}
        person={target.person ?? person}
        kind={target.kind}
        taigaUrl={taigaUrl}
        selection={selection}
        itemType={itemType}
      />
    ) : null;
  const whoOptions = teamWide
    ? [
        { value: EVERYONE, label: "Everyone" },
        ...directions.map((direction) => ({
          value: `role:${direction.role_id}`,
          label: `Role: ${direction.name}`,
        })),
        ...people.map((candidate) => ({
          value: `person:${candidate.user_id}`,
          label: candidate.name,
        })),
      ]
    : [{ value: defaultWho, label: me.full_name || me.username || "Me" }];

  return (
    <>
      <h1>Activity</h1>
      <div className="with-filters">
        <FilterPanel
          slug={slug}
          itemType={itemType}
          selection={selection}
          onChange={setSelection}
          typeChoice={{ types, value: itemType, onChange: setItemType }}
          period={period}
          onPeriodChange={setPeriod}
          activityChoice={{
            value: who,
            defaultValue: defaultWho,
            options: whoOptions,
            onChange: setWho,
          }}
        />
        <div className={`filtered-content${activity === null && !error ? " loading" : ""}`}>
          {error && <div className="banner banner-fail">{error}</div>}
          {activity && (
            <div className="flow-metrics">
              <MetricCard
                title="Over the year"
                subtitle="Every action in Taiga's history, one square a day, for the last year up to today, reaching further back when the filter's period starts earlier; order-only changes and integration bots are left out. The selected period has a dark gray outline; hover a day for its date and action count. A day narrows the numbers below to it; click it again to go back."
              >
                <div className="metric-chart activity-map-chart">
                  <ActivityMap
                    days={activity.days}
                    kind={null}
                    from={from}
                    to={to}
                    start={start}
                    end={end}
                    selected={day}
                    onSelect={setDay}
                  />
                </div>
              </MetricCard>
              <MetricCard
                title="What was done"
                subtitle={`${formatNumber(
                  total,
                )} actions in ${scopeText}, by kind. A number opens the actions right under it: who did what, on which card.`}
              >
                {total === 0 ? (
                  <Empty>Nothing was done in {scopeText}.</Empty>
                ) : (
                  <>
                    <div className="activity-kinds">
                      {[null, ...kinds].map((kind) => (
                        <div key={kind ?? "all"} className="key-number">
                          <span className="key-number-label">
                            {kind ? KIND_LABELS[kind] : "All"}
                          </span>
                          <button
                            type="button"
                            className={`key-number-open${
                              isOpen({ person: null, kind }) ? " open" : ""
                            }`}
                            aria-expanded={isOpen({ person: null, kind })}
                            onClick={() => toggle({ person: null, kind })}
                          >
                            <span className="key-number-value">
                              {formatNumber(kind ? totals[kind] ?? 0 : total)}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                    {opened?.person === null && (
                      <div className="inline-metric-list">{events(opened)}</div>
                    )}
                  </>
                )}
              </MetricCard>
              {rows.length > 0 && (
                <MetricCard
                  title="Who did it"
                  subtitle="Everyone's actions in the same days, alphabetical. A number opens that person's actions right under the row."
                >
                  <div className="wide-table-scroll">
                    <table
                      className="table breakdown-table activity-people-table"
                      style={{ minWidth: `${10 + (kinds.length + 1) * 6.5}rem` }}
                    >
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th className="num">All</th>
                          {kinds.map((kind) => (
                            <th key={kind} className="num">
                              {KIND_LABELS[kind]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <Fragment key={row.id}>
                            <tr>
                              <td>
                                <PersonLink name={row.name} id={row.id} />
                              </td>
                              <td className="num">
                                <Count
                                  value={sumOf(row.counts)}
                                  open={isOpen({ person: row.id, kind: null })}
                                  onClick={() => toggle({ person: row.id, kind: null })}
                                />
                              </td>
                              {kinds.map((kind) => (
                                <td key={kind} className="num">
                                  <Count
                                    value={row.counts[kind] ?? 0}
                                    open={isOpen({ person: row.id, kind })}
                                    onClick={() => toggle({ person: row.id, kind })}
                                  />
                                </td>
                              ))}
                            </tr>
                            {opened?.person === row.id && (
                              <tr className="expanded-row">
                                <td colSpan={kinds.length + 2}>
                                  <div className="inline-metric-list">{events(opened)}</div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </MetricCard>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
