import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  fetchPeriodFinished,
  fetchPeriodStatusTimes,
  fetchPeriodStays,
  type CellStats,
  type ColumnRef,
  type FilterSelection,
  type FinishedRow,
  type GroupCell,
  type ItemType,
  type PeriodKind,
  type PeriodRef,
  type PeriodStatusTimes,
  type PeriodFinished,
  type PeriodStays,
  type Period,
  type ProjectSummary,
  type ScrumScope,
  type SpreadStats,
} from "../api";
import { DotPlot } from "../charts/DotPlot";
import { formatAdaptive } from "../charts/format";
import { Sparkline } from "../charts/Sparkline";
import { StatTile } from "../charts/StatTile";
import { StatusTrendChart } from "../charts/StatusTrendChart";
import { TotalChart, type TotalPart } from "../charts/TotalChart";
import { TREND_BAD, TREND_FLAT, TREND_GOOD } from "../charts/timeAxis";
import { CardTitle } from "../components/CardTitle";
import { Dropdown } from "../components/Dropdown";
import { useExclusiveMetricList } from "../components/MetricPopup";
import { PeopleRefs, PersonRef } from "../components/PersonLink";
import { Segmented } from "../components/Segmented";
import { SortTitle, sortRows, useSort } from "../components/SortTitle";
import { formatDateTime, formatNumber } from "../format";
import { MODULE_OF_TYPE, TYPE_LABELS } from "../modules";
import { cardPath, columnPath, openInNewTab } from "../router";
import { TextLink } from "../components/TextLink";
import { Empty, MetricCard } from "./FlowMetrics";
import { projectTypes } from "./KanbanPage";

type Metric = "p50" | "p75" | "p90" | "mean" | "sum" | "n";
type TotalKind = "lead" | "cycle";

interface Settings {
  by: PeriodKind;
  metric: Metric;
  few: number;
  change: number;
  pass: number;
  closed: string[];
  total: TotalKind;
  last: number;
}

const METRICS: { value: Metric; label: string }[] = [
  { value: "p50", label: "Median" },
  { value: "p75", label: "75%" },
  { value: "p90", label: "90%" },
  { value: "mean", label: "Mean" },
  { value: "sum", label: "Total time" },
  { value: "n", label: "Entries" },
];

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
  { value: "sprint", label: "Sprints" },
];

function kindsOf(hasSprints: boolean): { value: PeriodKind; label: string }[] {
  return KINDS.filter((kind) => kind.value !== "sprint" || hasSprints);
}

const TOTAL_KINDS: { value: TotalKind; label: string }[] = [
  { value: "lead", label: "Lead time" },
  { value: "cycle", label: "Cycle time" },
];

const GROUPS: { key: string; label: string; types: (string | null)[] }[] = [
  { key: "waiting", label: "Waiting", types: ["queue"] },
  { key: "work", label: "Work", types: ["work"] },
  { key: "done", label: "Done", types: ["done", "cancelled"] },
  { key: "none", label: "Type not set", types: [null] },
];

const OUTSIDE = "outside";
const SCRUM_TYPES: ItemType[] = ["epic", "userstory", "task", "issue"];
const FLAT = TREND_FLAT;
const FLAT_TEXT = "#70728f";
const TREND_PERIODS = 12;
const MIN_FEW = 1;
const MIN_CHANGE = 5;
const TABLE_KEYS: (keyof Settings)[] = ["metric", "few", "change", "pass", "closed"];

function defaults(): Settings {
  return {
    by: "sprint",
    metric: "p50",
    few: 3,
    change: 25,
    pass: 5,
    closed: ["done"],
    total: "lead",
    last: 10,
  };
}

function readSettings(base: Settings, hasSprints: boolean): Settings {
  const query = new URLSearchParams(window.location.search);
  const number = (key: string, fallback: number, least: number) => {
    const value = Number(query.get(key));
    return query.has(key) && Number.isFinite(value) && value >= least ? value : fallback;
  };
  const pick = <T extends string>(key: string, options: { value: T }[], fallback: T): T =>
    options.find((option) => option.value === query.get(key))?.value ?? fallback;
  return {
    by: pick("by", kindsOf(hasSprints), hasSprints ? base.by : "week"),
    metric: pick("metric", METRICS, base.metric),
    few: number("few", base.few, MIN_FEW),
    change: number("change", base.change, MIN_CHANGE),
    pass: number("pass", base.pass, 0),
    closed: query.has("closed")
      ? (query.get("closed") ?? "").split(",").filter(Boolean)
      : base.closed,
    total: pick("total", TOTAL_KINDS, base.total),
    last: number("last", base.last, 1),
  };
}

function writeUrl(settings: Settings, base: Settings) {
  const query = new URLSearchParams(window.location.search);
  query.delete("scale");
  const text = (value: Settings[keyof Settings]) =>
    Array.isArray(value) ? value.join(",") : String(value);
  (Object.keys(settings) as (keyof Settings)[]).forEach((key) => {
    if (text(settings[key]) !== text(base[key])) {
      query.set(key, text(settings[key]));
    } else {
      query.delete(key);
    }
  });
  const search = query.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
  );
}

function statValue(stats: SpreadStats | CellStats | undefined, metric: Metric): number | null {
  if (!stats) {
    return null;
  }
  return metric === "n" ? stats.n : stats[metric];
}

function show(value: number | null, metric: Metric): string {
  if (value === null) {
    return "";
  }
  return metric === "n" ? formatNumber(value) : formatAdaptive(value);
}

type Verdict = "worse" | "better" | "same";

interface Change {
  ratio: number;
  verdict: Verdict;
  grey: boolean;
  neutral: boolean;
}

function changeOf(
  value: number | null,
  n: number,
  previous: number | null,
  previousN: number,
  settings: Settings,
  current: boolean,
): Change | null {
  if (
    value === null ||
    previous === null ||
    previous <= 0 ||
    value <= 0 ||
    n < settings.few ||
    previousN < settings.few
  ) {
    return null;
  }
  const ratio = value / previous;
  const significant =
    Math.abs(ratio - 1) * 100 >= settings.change && settings.metric !== "n" && !current;
  return {
    ratio,
    verdict: !significant ? "same" : ratio > 1 ? "worse" : "better",
    grey: current,
    neutral: settings.metric === "n",
  };
}

const VERDICT_COLOR: Record<Verdict, string> = {
  worse: TREND_BAD,
  better: TREND_GOOD,
  same: FLAT,
};

function percentOf(ratio: number): number {
  return Math.round((ratio - 1) * 100);
}

function changeText(ratio: number): string {
  const percent = percentOf(ratio);
  return `${percent > 0 ? "\u2191" : percent < 0 ? "\u2193" : "\u2192"} ${Math.abs(percent)}%`;
}

function signColor(change: Change): string {
  const percent = percentOf(change.ratio);
  if (change.grey || change.neutral || percent === 0) {
    return FLAT_TEXT;
  }
  return percent > 0 ? TREND_BAD : TREND_GOOD;
}

function ChangeMark({ change }: { change: Change | null }) {
  if (!change) {
    return null;
  }
  return (
    <span
      className="cell-change"
      style={{ color: signColor(change) }}
      title={
        change.grey
          ? "The period is still going, so its change is not judged"
          : `${percentOf(change.ratio) > 0 ? "Longer" : "Shorter"} than the period before`
      }
    >
      {changeText(change.ratio)}
    </span>
  );
}

function tooltip(
  stats: SpreadStats | CellStats | undefined,
  period: string,
  name: string,
  unit: string,
) {
  if (!stats) {
    return undefined;
  }
  return [
    `${name} in ${period}`,
    `Median ${formatAdaptive(stats.p50)}`,
    `Middle half ${formatAdaptive(stats.p25)} to ${formatAdaptive(stats.p75)}`,
    `90% within ${formatAdaptive(stats.p90)}`,
    `Longest ${formatAdaptive(stats.max)}`,
    `${stats.n} ${unit}`,
  ].join("\n");
}

function nearest(values: number[], share: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length, Math.max(1, Math.ceil(share * sorted.length))) - 1] ?? null
  );
}

interface Opened {
  kind: "cell" | "status";
  status: ColumnRef;
  period?: PeriodRef | null;
}

interface RowData {
  key: string;
  label: string;
  status?: ColumnRef;
  group?: string;
  values: (number | null)[];
  ns: number[];
  stats: (SpreadStats | CellStats | undefined)[];
}

function Matrix({
  data,
  settings,
  onSettings,
  onOpen,
  opened,
  detail,
}: {
  data: PeriodStatusTimes;
  settings: Settings;
  onSettings: (next: Partial<Settings>) => void;
  onOpen: (opened: Opened) => void;
  opened: Opened | null;
  detail: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (element) {
      element.scrollLeft = element.scrollWidth;
    }
  }, [data]);
  const cell = new Map(data.cells.map((item) => [`${item.period}:${item.status_id}`, item]));
  const groupCell = new Map(data.groups.map((item) => [`${item.period}:${item.group}`, item]));
  const now = new Map(data.now.map((item) => [item.status_id, item]));
  const periods = data.periods;
  const offset = Math.max(0, periods.length - settings.last);
  const visible = periods.map((_, index) => index).slice(offset);
  const metric = settings.metric;
  const statusRow = (status: ColumnRef): RowData => {
    const stats = periods.map((period) => cell.get(`${period.key}:${status.status_id}`));
    return {
      key: String(status.status_id),
      label: status.name,
      status,
      stats,
      values: stats.map((item) => statValue(item, metric)),
      ns: stats.map((item) => item?.n ?? 0),
    };
  };
  const groupRow = (key: string, label: string): RowData => {
    const found = periods.map((period) => groupCell.get(`${period.key}:${key}`));
    const valueOf = (item: GroupCell | undefined) =>
      !item ? null : metric === "n" ? item.stays : statValue(item.stats, metric);
    return {
      key: `group-${key}`,
      label,
      group: key,
      stats: found.map((item) => item?.stats),
      values: found.map(valueOf),
      ns: found.map((item) => item?.stats.n ?? 0),
    };
  };
  const hasData = (row: RowData) => visible.some((index) => row.values[index] != null);
  const groups = GROUPS.map((group) => {
    const rows = data.columns
      .filter((column) => group.types.includes(column.type))
      .map(statusRow)
      .filter(hasData);
    return { ...group, rows, head: groupRow(group.key, group.label) };
  }).filter((group) => group.rows.length > 0);
  const changeAt = (row: RowData, index: number) => {
    const older = index - 1;
    const period = periods[index];
    return older >= 0 && period
      ? changeOf(
          row.values[index] ?? null,
          row.ns[index] ?? 0,
          row.values[older] ?? null,
          row.ns[older] ?? 0,
          settings,
          period.current,
        )
      : null;
  };

  const cellOf = (row: RowData, index: number, period: PeriodRef) => {
    const value = row.values[index] ?? null;
    const n = row.ns[index] ?? 0;
    const weak = n < settings.few;
    const waiting = row.status && period.current ? now.get(row.status.status_id) : undefined;
    const unit = row.group ? "cards" : "stays";
    const title = [
      tooltip(row.stats[index], period.label, row.label, unit),
      waiting
        ? `${waiting.cards} ${
            waiting.cards === 1 ? "card" : "cards"
          } in it now, the oldest for ${formatAdaptive(waiting.oldest_days)}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
    return (
      <td
        key={period.key}
        className={`num scrum-cell${weak ? " weak" : ""}${
          row.status && value !== null ? " clickable" : ""
        }${period.current ? " current" : ""}`}
        title={title || undefined}
        onClick={() =>
          row.status && value !== null && onOpen({ kind: "cell", status: row.status, period })
        }
      >
        {value === null ? (
          <span className="cell-missing">-</span>
        ) : (
          <>
            <span className="cell-value">{show(value, metric)}</span>
            <span className="cell-n">{n}</span>
            {!weak && <ChangeMark change={changeAt(row, index)} />}
          </>
        )}
        {waiting && <span className="cell-now-badge">now {waiting.cards}</span>}
      </td>
    );
  };

  const trendOf = (row: RowData) => {
    const recent = visible.slice(-TREND_PERIODS);
    const values = recent.map((index) => row.values[index] ?? null);
    const segments = recent.map((index) => {
      const change = changeAt(row, index);
      return change && !change.grey ? VERDICT_COLOR[change.verdict] : FLAT;
    });
    return (
      <td className="scrum-trend sticky-trend-left">
        <Sparkline
          values={values}
          weak={recent.map((index) => (row.ns[index] ?? 0) < settings.few)}
          segments={segments}
          label={`Trend of ${row.label}`}
        />
      </td>
    );
  };

  const line = (row: RowData) => (
    <Fragment key={row.key}>
      <tr className={row.group ? "scrum-group-row" : undefined}>
        <th scope="row" className="sticky-status">
          {row.group ? (
            <button
              type="button"
              className="scrum-group-toggle"
              title="Each card's time in the group's statuses added up, then the median over cards"
              onClick={() => {
                const key = row.group ?? "";
                onSettings({
                  closed: settings.closed.includes(key)
                    ? settings.closed.filter((item) => item !== key)
                    : [...settings.closed, key],
                });
              }}
            >
              <span className="scrum-chevron">
                {settings.closed.includes(row.group) ? "\u25B8" : "\u25BE"}
              </span>
              {row.label}
            </button>
          ) : (
            <button
              type="button"
              className="legend-link scrum-status"
              title="Open this status across all periods"
              onClick={() => row.status && onOpen({ kind: "status", status: row.status })}
            >
              {row.label}
            </button>
          )}
        </th>
        {trendOf(row)}
        {visible.map((index) => {
          const period = periods[index];
          return period ? cellOf(row, index, period) : null;
        })}
      </tr>
      {row.status && opened?.status.status_id === row.status.status_id && (
        <tr className="expanded-row">
          <td colSpan={visible.length + 2}>
            <div className="inline-metric-list">{detail}</div>
          </td>
        </tr>
      )}
    </Fragment>
  );

  if (periods.length === 0) {
    return (
      <Empty>
        {settings.by === "sprint"
          ? "This project has no sprints with planned dates in the range. Switch to weeks or months."
          : "No stay ended in the range."}
      </Empty>
    );
  }
  return (
    <div className="scrum-scroll" ref={scroller}>
      <table className="table scrum-matrix">
        <thead>
          <tr>
            <th className="sticky-status">Status</th>
            <th
              className="sticky-trend-left"
              title={`The last ${TREND_PERIODS} periods, oldest on the left`}
            >
              Trend
            </th>
            {periods.slice(offset).map((period) => (
              <th key={period.key} className={`num${period.current ? " current" : ""}`}>
                <span className="period-name">{period.label}</span>
                {period.current && (
                  <span className="period-going">
                    going, {period.days_left} {period.days_left === 1 ? "day" : "days"} left
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              {line(group.head)}
              {!settings.closed.includes(group.key) && group.rows.map(line)}
            </Fragment>
          ))}
        </tbody>
      </table>
      {groups.length === 0 && (
        <p className="muted">
          No completed stays in these periods. The periods are shown even without measurements.
        </p>
      )}
    </div>
  );
}

const PART_TITLES: Record<TotalPart, string> = {
  p75: "the slowest quarter",
  p50: "every card finished",
  p25: "the fastest quarter",
};

function FinishedList({
  slug,
  itemType,
  taigaUrl,
  selection,
  scope,
  period,
  part,
  kind,
  edges,
}: {
  slug: string;
  itemType: ItemType;
  taigaUrl: string | null;
  selection: FilterSelection;
  scope: ScrumScope;
  period: PeriodRef;
  part: TotalPart;
  kind: TotalKind;
  edges: { p25: number | null; p75: number | null } | undefined;
}) {
  const [sort, onSort] = useSort();
  const [found, setFound] = useState<PeriodFinished | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPeriodFinished(slug, itemType, selection, scope, period.key)
      .then((next) => !cancelled && setFound(next))
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType, selection, scope, period]);
  if (error) {
    return <div className="banner banner-fail">{error}</div>;
  }
  if (!found) {
    return <p className="muted">Loading...</p>;
  }
  const took = (row: FinishedRow) => (kind === "lead" ? row.lead_days : row.cycle_days);
  const measured = found.rows.filter((row) => took(row) !== null);
  const rows =
    part === "p75"
      ? measured.filter((row) => (took(row) ?? 0) >= (edges?.p75 ?? Infinity) - 1e-9)
      : part === "p25"
        ? measured.filter((row) => (took(row) ?? 0) <= (edges?.p25 ?? -Infinity) + 1e-9)
        : measured;
  const defaultRows = [...rows].sort((a, b) =>
    part === "p25" ? (took(a) ?? 0) - (took(b) ?? 0) : (took(b) ?? 0) - (took(a) ?? 0),
  );
  const sorted = sortRows(defaultRows, sort, (row, key) =>
    key === "card"
      ? row.ref ?? row.item_id
      : key === "time"
        ? took(row)
        : key === "finished"
          ? row.finished_at
          : key === "assigned"
            ? row.assignees.length
            : row.finished_by,
  );
  const label = kind === "lead" ? "Lead time" : "Cycle time";
  return (
    <div className="cell-detail">
      <p className="metric-summary">
        {sorted.length} of {measured.length} {measured.length === 1 ? "card" : "cards"} finished in{" "}
        {period.label}
        {part === "p75" && edges?.p75 != null
          ? `, taking ${formatAdaptive(edges.p75)} or more`
          : ""}
        {part === "p25" && edges?.p25 != null
          ? `, taking ${formatAdaptive(edges.p25)} or less`
          : ""}
      </p>
      <table className="table table-compact stays-table">
        <thead>
          <tr>
            <th>
              <SortTitle label="Card" sortKey="card" sort={sort} onSort={onSort} />
            </th>
            <th className="num">
              <SortTitle label={label} sortKey="time" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Finished" sortKey="finished" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Assigned" sortKey="assigned" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Finished by" sortKey="person" sort={sort} onSort={onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.item_id}>
              <td className="truncate">
                <CardTitle
                  slug={slug}
                  itemType={itemType}
                  itemId={row.item_id}
                  cardRef={row.ref}
                  subject={row.subject}
                  isDeleted={row.is_deleted}
                  taigaUrl={taigaUrl}
                />
              </td>
              <td className="num nowrap">{formatAdaptive(took(row))}</td>
              <td>{formatDateTime(row.finished_at)}</td>
              <td className="truncate">
                <PeopleRefs directory={found} ids={row.assignees} nobody="Unassigned" />
              </td>
              <td className="truncate">
                <PersonRef directory={found} id={row.finished_by} nobody="-" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TotalSection({
  data,
  settings,
  onSettings,
  slug,
  itemType,
  taigaUrl,
  selection,
  scope,
}: {
  data: PeriodStatusTimes;
  settings: Settings;
  onSettings: (next: Partial<Settings>) => void;
  slug: string;
  itemType: ItemType;
  taigaUrl: string | null;
  selection: FilterSelection;
  scope: ScrumScope;
}) {
  const [picked, setPicked] = useState<{ index: number; part: TotalPart } | null>(null);
  const announceOpen = useExclusiveMetricList(() => setPicked(null));
  const totals = new Map(data.totals.map((item) => [item.period, item]));
  const points = data.periods.map((period) => {
    const total = totals.get(period.key);
    const stats = total ? total[settings.total] : null;
    return {
      label: period.label,
      current: period.current,
      p25: stats?.p25 ?? null,
      p50: stats?.p50 ?? null,
      p75: stats?.p75 ?? null,
      cards: total?.cards ?? 0,
      measured: stats?.n ?? 0,
      slow: stats?.slow ?? 0,
      fast: stats?.fast ?? 0,
      waiting: total?.waiting_days ?? 0,
      work: total?.work_days ?? 0,
    };
  });
  const filled = points.flatMap((point, index) => (point.p50 === null ? [] : [index]));
  const latestIndex = filled[filled.length - 1] ?? points.length - 1;
  const previousIndex = filled[filled.length - 2];
  const latest = points[latestIndex];
  const previous = previousIndex === undefined ? undefined : points[previousIndex];
  const ratio =
    latest?.p50 &&
    previous?.p50 &&
    latest.measured >= settings.few &&
    previous.measured >= settings.few
      ? latest.p50 / previous.p50
      : null;
  const waitingShare =
    latest && latest.waiting + latest.work > 0
      ? latest.waiting / (latest.waiting + latest.work)
      : null;
  const oldest = data.oldest_in_work;
  return (
    <MetricCard
      title="Total time per card"
      subtitle={
        settings.total === "lead"
          ? "For every card finished in a period: its time from creation to Done, then the median over those cards, with the middle half as a band. The line is red where it grew, green where it fell, grey on a plateau; the step into the running period is dashed; the number under each point is how many cards finished. The band's upper half (the slow quarter, up to 75%) and lower half (the fast quarter, from 25%) are tinted the same way by how their edge moved, the lower half fainter; a neutral band did not move. Point at a period and click the median, 75% or 25% dot for its cards."
          : "For every card finished in a period: its time from the first Work status to Done, then the median over those cards, with the middle half as a band. The line is red where it grew, green where it fell, grey on a plateau; the step into the running period is dashed; the number under each point is how many cards finished. The band's upper half (the slow quarter, up to 75%) and lower half (the fast quarter, from 25%) are tinted the same way by how their edge moved, the lower half fainter; a neutral band did not move. Point at a period and click the median, 75% or 25% dot for its cards."
      }
      actions={
        <Segmented
          label="Total"
          options={TOTAL_KINDS}
          value={settings.total}
          onChange={(total) => onSettings({ total })}
        />
      }
    >
      <div className="stat-row scrum-tiles">
        <StatTile
          label={`${settings.total === "lead" ? "Lead" : "Cycle"} time, median`}
          value={formatAdaptive(latest?.p50 ?? null)}
          detail={
            <>
              {latest?.label}
              {latest?.current ? " (going)" : ""}
              {latest && latest.measured < settings.few
                ? `, only ${latest.measured} measured`
                : ""}
              {ratio !== null ? `, ${changeText(ratio)} against ${previous?.label}` : ""}
            </>
          }
        />
        <StatTile
          label="In work now"
          value={formatNumber(data.in_work_now)}
          detail="cards in Work statuses"
        />
        <StatTile
          label="Oldest in work"
          value={formatAdaptive(oldest?.days ?? null)}
          detail={
            oldest ? (
              <CardTitle
                slug={slug}
                itemType={itemType}
                itemId={oldest.item_id}
                cardRef={oldest.ref}
                subject={oldest.subject}
                isDeleted={false}
                taigaUrl={taigaUrl}
              />
            ) : (
              "no card in work"
            )
          }
        />
        <StatTile
          label="Time spent waiting"
          value={waitingShare === null ? "-" : `${Math.round(waitingShare * 100)}%`}
          detail={latest ? `of the time of the cards finished in ${latest.label}` : undefined}
        />
      </div>
      <div className="metric-chart">
        <TotalChart
          points={points}
          few={settings.few}
          onPick={(index, part) => {
            if (picked?.index !== index || picked.part !== part) announceOpen();
            setPicked((current) =>
              current?.index === index && current.part === part ? null : { index, part },
            );
          }}
        />
      </div>
      {picked && data.periods[picked.index] && (
        <div className="inline-metric-list">
          <div className="inline-metric-heading">
            <h3>
              {data.periods[picked.index]?.label ?? ""} · {PART_TITLES[picked.part]}
            </h3>
            <button type="button" className="link-button" onClick={() => setPicked(null)}>
              Close
            </button>
          </div>
          <FinishedList
            slug={slug}
            itemType={itemType}
            taigaUrl={taigaUrl}
            selection={selection}
            scope={scope}
            period={data.periods[picked.index] as PeriodRef}
            part={picked.part}
            kind={settings.total}
            edges={points[picked.index]}
          />
        </div>
      )}
    </MetricCard>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: ReactNode; days: number[] }[];
}) {
  return (
    <table className="table table-compact breakdown-table">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">Stays</th>
          <th className="num">Median</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="truncate">{row.label}</td>
            <td className="num">{row.days.length}</td>
            <td className="num nowrap">{formatAdaptive(nearest(row.days, 0.5))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CellDetail({
  slug,
  itemType,
  selection,
  scope,
  status,
  period,
  taigaUrl,
}: {
  slug: string;
  itemType: ItemType;
  selection: FilterSelection;
  scope: ScrumScope;
  status: ColumnRef;
  period: PeriodRef | null;
  taigaUrl: string | null;
}) {
  const [sort, onSort] = useSort();
  const [stays, setStays] = useState<PeriodStays | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPeriodStays(slug, itemType, selection, scope, period?.key ?? OUTSIDE, status.status_id)
      .then((next) => !cancelled && setStays(next))
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType, selection, scope, period, status]);
  if (error) {
    return <div className="banner banner-fail">{error}</div>;
  }
  if (!stays) {
    return <p className="muted">Loading...</p>;
  }
  const days = stays.rows.map((row) => row.days);
  const byPerson = new Map<string, number[]>();
  const byRole = new Map<string, number[]>();
  for (const row of stays.rows) {
    const people = row.assignees.length ? row.assignees.map(String) : ["none"];
    for (const person of people) {
      byPerson.set(person, [...(byPerson.get(person) ?? []), row.days]);
      const role = person === "none" ? null : stays.role_of[person] ?? null;
      const roleKey = role === null ? "none" : String(role);
      byRole.set(roleKey, [...(byRole.get(roleKey) ?? []), row.days]);
    }
  }
  const sorted = (map: Map<string, number[]>) =>
    [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  const median = nearest(days, 0.5);
  return (
    <div className="cell-detail">
      <p className="metric-summary">
        {stays.rows.length} {stays.rows.length === 1 ? "stay" : "stays"} · median{" "}
        {formatAdaptive(median)} · middle half {formatAdaptive(nearest(days, 0.25))} to{" "}
        {formatAdaptive(nearest(days, 0.75))} · 90% within {formatAdaptive(nearest(days, 0.9))}
      </p>
      <DotPlot
        dots={stays.rows.map((row) => ({
          key: `${row.item_id}-${row.end}`,
          value: row.days,
          title: `${row.ref === null ? "" : `#${row.ref} `}${row.subject}`,
          lines: [`Stayed ${formatAdaptive(row.days)}`, `Left ${formatDateTime(row.end)}`],
        }))}
        color="#008aa8"
        markers={
          median === null
            ? []
            : [
                {
                  name: "Median",
                  color: "#4c566a",
                  value: median,
                  label: `50%: ${formatAdaptive(median)}`,
                },
              ]
        }
        legend={[{ name: "Stays", color: "#008aa8", kind: "dot" }]}
        count={`${stays.rows.length} stays`}
        selectedId={null}
        selectedKeys={null}
        focusKey={null}
        markerPreview={() => new Set()}
        onDot={(dot) =>
          openInNewTab(cardPath(slug, MODULE_OF_TYPE[itemType], Number(dot.key.split("-")[0])))
        }
        onMarker={() => undefined}
        onAll={() => undefined}
        withLegend={false}
        height={170}
      />
      <div className="breakdowns">
        <Breakdown
          title="Assigned"
          rows={sorted(byPerson).map(([person, values]) => ({
            key: person,
            label:
              person === "none" ? (
                "Unassigned"
              ) : (
                <PersonRef directory={stays} id={Number(person)} nobody="Unassigned" />
              ),
            days: values,
          }))}
        />
        <Breakdown
          title="Role"
          rows={sorted(byRole).map(([role, values]) => ({
            key: role,
            label: role === "none" ? "No role" : stays.roles[role] ?? `Role ${role}`,
            days: values,
          }))}
        />
      </div>
      <table className="table table-compact stays-table">
        <thead>
          <tr>
            <th>
              <SortTitle label="Card" sortKey="card" sort={sort} onSort={onSort} />
            </th>
            <th className="num">
              <SortTitle label="Stayed" sortKey="days" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Left" sortKey="left" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Assigned" sortKey="assigned" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Moved on by" sortKey="person" sort={sort} onSort={onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sortRows(stays.rows, sort, (row, key) =>
            key === "card"
              ? row.ref ?? row.item_id
              : key === "days"
                ? row.days
                : key === "left"
                  ? row.end
                  : key === "assigned"
                    ? row.assignees.length
                    : row.exited_by,
          ).map((row) => (
            <tr key={`${row.item_id}-${row.end}`}>
              <td className="truncate">
                <CardTitle
                  slug={slug}
                  itemType={itemType}
                  itemId={row.item_id}
                  cardRef={row.ref}
                  subject={row.subject}
                  isDeleted={row.is_deleted}
                  taigaUrl={taigaUrl}
                />
              </td>
              <td className="num nowrap">{formatAdaptive(row.days)}</td>
              <td>{formatDateTime(row.end)}</td>
              <td className="truncate">
                <PeopleRefs directory={stays} ids={row.assignees} nobody="Unassigned" />
              </td>
              <td className="truncate">
                <PersonRef directory={stays} id={row.exited_by} nobody="-" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumberSetting({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="scrum-setting">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= 0) {
            onChange(next);
          }
        }}
      />
      <span className="muted-inline">{unit}</span>
    </label>
  );
}

function StatusSummary({
  data,
  status,
  settings,
  slug,
  itemType,
  onPeriod,
}: {
  data: PeriodStatusTimes;
  status: ColumnRef;
  settings: Settings;
  slug: string;
  itemType: ItemType;
  onPeriod: (period: PeriodRef) => void;
}) {
  const waiting = data.now.find((item) => item.status_id === status.status_id);
  const periods = [...data.periods].reverse();
  const cells = periods.map((period) =>
    data.cells.find((item) => item.period === period.key && item.status_id === status.status_id),
  );
  const stays = cells.reduce((total, item) => total + (item?.n ?? 0), 0);
  return (
    <div className="status-summary">
      <div className="stat-row">
        <StatTile
          label="In it now"
          value={formatNumber(waiting?.cards ?? 0)}
          detail={
            waiting
              ? `the oldest for ${formatAdaptive(waiting.oldest_days)}`
              : "no card stands in it"
          }
        />
        <StatTile
          label="Stays in the range"
          value={formatNumber(stays)}
          detail={`over ${periods.length} ${periods.length === 1 ? "period" : "periods"}`}
        />
        <StatTile
          label="Type"
          value={status.type ?? "not set"}
          detail={
            <TextLink
              to={columnPath(slug, itemType, status.status_id)}
              target="_blank"
              rel="noreferrer"
            >
              Open the status page
            </TextLink>
          }
        />
      </div>
      <table className="table table-compact status-periods">
        <thead>
          <tr>
            <th>Period</th>
            <th className="num">Stays</th>
            <th className="num">Median</th>
            <th className="num">Middle half</th>
            <th className="num">90% within</th>
            <th className="num">Longest</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period, index) => {
            const item = cells[index];
            const older = cells[index + 1];
            const weak = (item?.n ?? 0) < settings.few;
            const change = item
              ? changeOf(
                  item.p50,
                  item.n,
                  older?.p50 ?? null,
                  older?.n ?? 0,
                  { ...settings, metric: "p50" },
                  period.current,
                )
              : null;
            return (
              <tr
                key={period.key}
                className={`${item ? "clickable" : ""}${weak ? " weak" : ""}${
                  period.current ? " current" : ""
                }`}
                title={item ? "Click for the stays of this period" : undefined}
                onClick={() => item && onPeriod(period)}
              >
                <td>
                  {period.label}
                  {period.current && <span className="period-going"> going</span>}
                </td>
                <td className="num">{item ? item.n : ""}</td>
                <td className="num nowrap">{item ? formatAdaptive(item.p50) : ""}</td>
                <td className="num">
                  {item ? `${formatAdaptive(item.p25)} to ${formatAdaptive(item.p75)}` : ""}
                </td>
                <td className="num nowrap">{item ? formatAdaptive(item.p90) : ""}</td>
                <td className="num nowrap">{item ? formatAdaptive(item.max) : ""}</td>
                <td className="num nowrap">{!weak && <ChangeMark change={change} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableSettings({
  settings,
  base,
  onSettings,
}: {
  settings: Settings;
  base: Settings;
  onSettings: (next: Partial<Settings>) => void;
}) {
  const update = onSettings;
  const changed = TABLE_KEYS.some(
    (key) => JSON.stringify(settings[key]) !== JSON.stringify(base[key]),
  );
  return (
    <div className="scrum-table-settings">
      <div className="scrum-settings-row">
        <Dropdown
          label="Metric"
          value={settings.metric}
          options={METRICS}
          onChange={(metric) => update({ metric: metric as Metric })}
        />
        <button
          type="button"
          className="link-button scrum-reset"
          disabled={!changed}
          title="Put every setting of this table back to its default"
          onClick={() =>
            update(
              Object.fromEntries(TABLE_KEYS.map((key) => [key, base[key]])) as Partial<Settings>,
            )
          }
        >
          Reset to defaults
        </button>
      </div>
      <div className="scrum-settings-row scrum-settings">
        <NumberSetting
          label="Too few below"
          value={settings.few}
          unit="stays"
          onChange={(few) => update({ few: Math.max(MIN_FEW, few) })}
        />
        <NumberSetting
          label="Clear change from"
          value={settings.change}
          unit="%"
          onChange={(change) => update({ change: Math.max(MIN_CHANGE, change) })}
        />
        <NumberSetting
          label="Passing through under"
          value={settings.pass}
          unit="min"
          onChange={(pass) => update({ pass })}
        />
      </div>
    </div>
  );
}

export function PeriodSection({
  slug,
  project,
  selection,
  period,
  taigaUrl,
  itemType = null,
}: {
  slug: string;
  project: ProjectSummary;
  selection: FilterSelection;
  period: Period;
  taigaUrl: string | null;
  itemType?: ItemType | null;
}) {
  const available = projectTypes(project);
  const types = itemType ? [] : SCRUM_TYPES.filter((type) => available.includes(type));
  const [chosen, setChosen] = useState<ItemType | null>(null);
  const shown =
    itemType ??
    (chosen && types.includes(chosen)
      ? chosen
      : types.includes("userstory")
        ? "userstory"
        : types[0] ?? null);
  const hasSprints = project.has_periods;
  const base = useMemo(() => defaults(), []);
  const [settings, setSettings] = useState<Settings>(() => readSettings(base, hasSprints));
  const [data, setData] = useState<PeriodStatusTimes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const announceOpen = useExclusiveMetricList(() => setOpened(null));

  useEffect(() => writeUrl(settings, base), [settings, base]);

  const scope = useMemo<ScrumScope>(
    () => ({
      by: settings.by,
      from: period.from,
      to: period.to,
      pass: settings.pass,
      days: period.days,
    }),
    [settings.by, period.from, period.to, settings.pass, period.days],
  );
  const update = (next: Partial<Settings>) => setSettings((current) => ({ ...current, ...next }));

  useEffect(() => {
    if (!shown) {
      return;
    }
    let cancelled = false;
    setData(null);
    setError(null);
    setOpened(null);
    fetchPeriodStatusTimes(slug, shown, selection, scope)
      .then((next) => {
        if (!cancelled) {
          setData(next);
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
  }, [slug, shown, selection, scope]);

  const shownData = useMemo(
    () => (data ? { ...data, periods: data.periods.slice(-settings.last) } : null),
    [data, settings.last],
  );

  if (!shown) {
    return null;
  }

  const metricLabel = METRICS.find((metric) => metric.value === settings.metric)?.label ?? "";
  const statusPoints =
    opened?.kind === "status" && shownData
      ? shownData.periods.map((item) => {
          const found = shownData.cells.find(
            (cell) => cell.period === item.key && cell.status_id === opened.status.status_id,
          );
          return found
            ? { label: item.label, p25: found.p25, p50: found.p50, p75: found.p75, n: found.n }
            : null;
        })
      : [];

  return (
    <>
      <div className="section-title">
        <h2>Period by period</h2>
        <p className="muted">
          How the time of cards changes from one{" "}
          {settings.by === "sprint" ? "sprint" : settings.by} to the next, under the filters and
          dates above.
        </p>
      </div>
      <div className="toolbar">
        {types.length > 1 && (
          <Segmented
            label="Card type"
            options={types.map((type) => ({ value: type, label: TYPE_LABELS[type] }))}
            value={shown}
            onChange={setChosen}
          />
        )}
        <Segmented
          label="Periods"
          options={kindsOf(hasSprints)}
          value={settings.by}
          onChange={(by) => update({ by })}
        />
        <NumberSetting
          label="Show the last"
          value={settings.last}
          unit={settings.by === "sprint" ? "sprints" : `${settings.by}s`}
          onChange={(last) => update({ last: Math.max(1, Math.round(last)) })}
        />
      </div>
      {error && <div className="banner banner-fail">{error}</div>}
      {shownData && (
        <div className={`flow-metrics${data === null ? " loading" : ""}`}>
          {shownData.periods.length > 0 && (
            <TotalSection
              data={shownData}
              settings={settings}
              onSettings={update}
              slug={slug}
              itemType={shown}
              taigaUrl={taigaUrl}
              selection={selection}
              scope={scope}
            />
          )}
          <MetricCard
            title="Time in statuses by period"
            subtitle={
              <>
                {metricLabel} of the stays in each status that ended in each period, oldest period
                first; the small number is how many stays. Cells with too few stays are pale and
                not compared. The arrow is the change against the period before, in percent: red
                when longer, green when shorter; a group row adds up each card's time in the
                group's statuses and takes the median over cards. Click a cell for its stays, a
                status for its trend.
              </>
            }
          >
            <TableSettings settings={settings} base={base} onSettings={update} />
            <Matrix
              data={data ?? shownData}
              settings={settings}
              onSettings={update}
              onOpen={(next) => {
                if (
                  !(
                    opened?.kind === next.kind &&
                    opened.status.status_id === next.status.status_id &&
                    opened.period?.key === next.period?.key
                  )
                )
                  announceOpen();
                setOpened((current) =>
                  current?.kind === next.kind &&
                  current.status.status_id === next.status.status_id &&
                  current.period?.key === next.period?.key
                    ? null
                    : next,
                );
              }}
              opened={opened}
              detail={
                opened && (
                  <>
                    <div className="inline-metric-heading">
                      <h3>
                        {opened.kind === "status"
                          ? opened.status.name
                          : `${opened.status.name} · ${opened.period?.label ?? "No sprint"}`}
                      </h3>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setOpened(null)}
                      >
                        Close
                      </button>
                    </div>
                    {opened.kind === "status" && shownData ? (
                      <>
                        <p className="muted">
                          Median of each period with the middle half of the stays as a band; a
                          bigger dot means more stays, a hollow one too few to judge.
                        </p>
                        <StatusTrendChart
                          labels={shownData.periods.map((item) => item.label)}
                          points={statusPoints}
                          few={settings.few}
                        />
                        <StatusSummary
                          data={shownData}
                          status={opened.status}
                          settings={settings}
                          slug={slug}
                          itemType={shown}
                          onPeriod={(item) =>
                            setOpened({ kind: "cell", status: opened.status, period: item })
                          }
                        />
                      </>
                    ) : (
                      <CellDetail
                        slug={slug}
                        itemType={shown}
                        selection={selection}
                        scope={scope}
                        status={opened.status}
                        period={opened.period ?? null}
                        taigaUrl={taigaUrl}
                      />
                    )}
                  </>
                )
              }
            />
          </MetricCard>
        </div>
      )}
    </>
  );
}
