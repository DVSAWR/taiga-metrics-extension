import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import type {
  ColumnCard,
  Distribution,
  FlowResponse,
  ItemType,
  MoveCount,
  MoveEvent,
  ReturnEvent,
  Sample,
} from "../api";
import { BarChart } from "../charts/BarChart";
import { CdfChart } from "../charts/CdfChart";
import type { LegendItem } from "../charts/ChartLegend";
import { CumulativeChart } from "../charts/CumulativeChart";
import { DotPlot } from "../charts/DotPlot";
import { ScatterChart } from "../charts/ScatterChart";
import {
  HoverTimeProvider,
  shortDays,
  TREND_BAD,
  TREND_GOOD,
  type AxisDay,
  type TimeGap,
  type TimeSpan,
} from "../charts/timeAxis";
import { fillWidth, formatDuration } from "../charts/format";
import { CardTitle } from "../components/CardTitle";
import { MetricPopup, useExclusiveMetricList } from "../components/MetricPopup";
import { FirstPassList, ReturnEventList } from "../components/QualityLists";
import { PeopleRefs, PersonRef } from "../components/PersonLink";
import { Segmented } from "../components/Segmented";
import { SortTitle, sortRows, useSort } from "../components/SortTitle";
import { CARD_BACKGROUND, FALLBACK_MARK, PANEL_BACKGROUND, readable } from "../colors";
import { firstTime, formatDateTime, formatNumber } from "../format";
import { cardPath, columnPath, openInNewTab } from "../router";
import { MODULE_OF_TYPE } from "../modules";
import { TextLink } from "../components/TextLink";
import { Icon } from "../icons";
import { readStored, writeStored } from "../storage";
import { repeatReturns, returnStats } from "../cardLists";

export function Expandable({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="metric-table">
      <button
        type="button"
        className="expand-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : label}
      </button>
      {open && <div className="table-scroll">{children}</div>}
    </div>
  );
}

export function MetricCard({
  title,
  subtitle,
  children,
  table,
  tableLabel = "Show details",
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  children?: ReactNode;
  table?: ReactNode;
  tableLabel?: string;
  actions?: ReactNode;
}) {
  const key = `collapsed:${title}`;
  const [collapsed, setCollapsed] = useState(() => readStored(key) === "true");
  const toggle = () => {
    writeStored(key, String(!collapsed));
    setCollapsed(!collapsed);
  };
  const empty = !children && !table;
  return (
    <section className={`card metric-card${collapsed ? " collapsed" : ""}`}>
      <header className="card-header">
        <div className="card-title-row">
          {!empty && (
            <button
              type="button"
              className="card-collapse"
              aria-expanded={!collapsed}
              aria-label={collapsed ? `Show ${title}` : `Hide ${title}`}
              title={collapsed ? "Show" : "Hide"}
              onClick={toggle}
            >
              <Icon name="chevronDown" />
            </button>
          )}
          <h2>{title}</h2>
        </div>
        {!collapsed && <p>{subtitle}</p>}
        {actions && !collapsed && <div className="card-actions">{actions}</div>}
      </header>
      {children && !collapsed && <div className="metric-body">{children}</div>}
      {table && !collapsed && <Expandable label={tableLabel}>{table}</Expandable>}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted metric-empty">{children}</p>;
}

function ColumnCards({
  cards,
  now,
  withStatus = false,
  ...props
}: TabProps & { cards: ColumnCard[]; now: boolean; withStatus?: boolean }) {
  const { flow, slug, itemType, taigaUrl } = props;
  const [sort, onSort] = useSort();
  const order = statusOrder(flow);
  const newest = [...cards].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const sorted = sortRows(newest, sort, (card, key) => {
    switch (key) {
      case "created":
        return card.created_at;
      case "card":
        return card.ref ?? card.item_id;
      case "status":
        return order(card.status_id);
      case "days":
        return card.days;
      case "assigned":
        return peopleText(flow, card.assignees);
      default:
        return card.user_id === null ? null : personName(flow, card.user_id, "");
    }
  });
  const title = (label: string, key: string, numeric = false) => (
    <SortTitle
      label={label}
      sortKey={key}
      sort={sort}
      onSort={onSort}
      className={numeric ? "table-sort num-sort" : "table-sort"}
    />
  );
  return (
    <table className="table table-compact move-events">
      <colgroup>
        <col className="col-when" />
        <col />
        {withStatus && <col className="col-status" />}
        <col className="col-time" />
        <col className="col-people" />
        <col className="col-by" />
      </colgroup>
      <thead>
        <tr>
          <th>{title("Created at", "created")}</th>
          <th>{title("Card", "card")}</th>
          {withStatus && <th>{title("Status", "status")}</th>}
          <th className="num">{title(now ? "In it so far" : "Time in it", "days", true)}</th>
          <th>{title("Assigned", "assigned")}</th>
          <th>{title(now ? "Moved in by" : "Moved out by", "user")}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((card) => (
          <tr key={`${card.item_id}-${card.status_id}-${card.now}`}>
            <td className="nowrap">{formatDateTime(card.created_at)}</td>
            <td className="truncate">
              <CardTitle
                slug={slug}
                itemType={itemType}
                itemId={card.item_id}
                cardRef={card.ref}
                subject={card.subject}
                isDeleted={card.is_deleted}
                taigaUrl={taigaUrl}
              />
            </td>
            {withStatus && (
              <td className="truncate">
                <ColumnLabel
                  flow={flow}
                  id={card.status_id}
                  empty="-"
                  to={columnPath(slug, itemType, card.status_id)}
                />
              </td>
            )}
            <td className="num nowrap">{formatDuration(card.days)}</td>
            <td className="truncate">
              <PeopleRefs directory={flow} ids={card.assignees} nobody="Unassigned" />
            </td>
            <td className="truncate">
              <PersonRef directory={flow} id={card.user_id} nobody="Unknown" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface TimesOpen {
  status: number | null;
  now: boolean;
  progress?: boolean;
  stuck?: boolean;
}

const IN_PROGRESS_TYPES: ReadonlySet<string> = new Set(["work"]);
export const OPEN_IN_PROGRESS = "in-progress";
export const OPEN_NOW = "now";
export const OPEN_STUCK = "stuck";
export const OPEN_FINISHED = "finished";

const OPENED_CARDS = "opened-cards";
const SETTLE_MS = 1500;
const SETTLE_STEP_MS = 100;

function scrollWhenSettled(id: string): () => void {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  events.forEach((name) => window.addEventListener(name, stop, { passive: true }));
  const started = Date.now();
  let timer = 0;
  const step = () => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
    if (!stopped && Date.now() - started < SETTLE_MS) {
      timer = window.setTimeout(step, SETTLE_STEP_MS);
    }
  };
  timer = window.setTimeout(step, 0);
  return () => {
    stop();
    window.clearTimeout(timer);
    events.forEach((name) => window.removeEventListener(name, stop));
  };
}

function openedTimes(open: string | null): TimesOpen | null {
  if (open === OPEN_IN_PROGRESS) {
    return { status: null, now: true, progress: true };
  }
  if (open === OPEN_STUCK) {
    return { status: null, now: true, stuck: true };
  }
  return open === OPEN_NOW ? { status: null, now: true } : null;
}

function restNote(mine: number | null, theirs: number | null): { text: string; color?: string } {
  const selected = mine ?? 0;
  const other = theirs ?? 0;
  if (selected <= 0 && other <= 0) {
    return { text: "" };
  }
  if (other <= 0) {
    return { text: "only the selected stay here", color: TREND_BAD };
  }
  if (selected <= 0) {
    return { text: "only the rest stay here", color: TREND_GOOD };
  }
  const change = Math.round(((selected - other) / other) * 100);
  if (change === 0) {
    return { text: "the same median as the rest" };
  }
  return change > 0
    ? { text: `median ${change}% longer than the rest`, color: TREND_BAD }
    : { text: `median ${-change}% shorter than the rest`, color: TREND_GOOD };
}

function ReturnSummaryCells({
  events,
  title,
  ...props
}: TabProps & { events: ReturnEvent[]; title: string }) {
  const stats = returnStats(events);
  return (
    <>
      <td className="num">{formatNumber(stats.returned_cards)}</td>
      <td className="num">
        {stats.repeat_returns > 0 ? (
          <MetricPopup
            label={`Show repeat returns: ${title}`}
            content={() => (
              <ReturnEventList
                {...props}
                title={`${title}: repeat returns`}
                events={repeatReturns(events)}
              />
            )}
          >
            {formatNumber(stats.repeat_returns)}
          </MetricPopup>
        ) : (
          "·"
        )}
      </td>
      <td
        className="num"
        title={`${stats.repeated_cards} of ${stats.returned_cards} returned cards came back more than once`}
      >
        {stats.repeat_rate === null ? "-" : `${Math.round(stats.repeat_rate * 100)}%`}
      </td>
    </>
  );
}

function ColumnTimes({
  open,
  setOpen,
  statuses = null,
  ...props
}: TabProps & {
  open: TimesOpen | null;
  setOpen: (update: (current: TimesOpen | null) => TimesOpen | null) => void;
  statuses?: number[] | null;
}) {
  const { flow, slug, itemType, rest } = props;
  const announceOpen = useExclusiveMetricList(() => setOpen(() => null));
  const columns = flow.report.columns.filter(
    (column) => column.used && (statuses === null || statuses.includes(column.status_id)),
  );
  const others = new Map(rest?.report.columns.map((column) => [column.status_id, column]));
  const max = Math.max(
    0,
    ...[...columns, ...(rest?.report.columns ?? [])].map(
      (column) => column.p85 ?? column.p50 ?? 0,
    ),
  );
  const width = (days: number | null) => (max > 0 && days ? (days / max) * 100 : 0);
  const cameBack = new Map<number, number>();
  const events = flow.report.credited_returns ?? flow.report.back_moves.events;
  for (const event of events) {
    cameBack.set(event.credited_status, (cameBack.get(event.credited_status) ?? 0) + 1);
  }
  const columnIds = new Set(columns.map((column) => column.status_id));
  const cleanEvents = flow.report.first_passes.filter(
    (event) => event.clean && columnIds.has(event.status_id),
  );
  const returnEvents = events.filter((event) => columnIds.has(event.credited_status));
  const allBack = returnEvents.length;
  const eventSlices = (statusIds: number[]): Slice[] =>
    columns.flatMap((column) => {
      const count = statusIds.filter((id) => id === column.status_id).length;
      return count
        ? [
            {
              key: String(column.status_id),
              label: null,
              name: column.name,
              to: columnPath(slug, itemType, column.status_id),
              color: statusColor(flow, column.status_id, false),
              count,
            },
          ]
        : [];
    });
  const toggle = (status: number | null, now: boolean) => {
    if (!(open?.status === status && open.now === now)) announceOpen();
    setOpen((current) =>
      current?.status === status && current.now === now ? null : { status, now },
    );
  };
  return (
    <div className="wide-table-scroll">
      <table className="table column-times">
        <colgroup>
          <col className="col-status" />
          <col className="col-type" />
          <col />
          <col className="col-num" />
          <col className="col-num" />
          <col className="col-num" />
          <col className="col-count" />
          <col className="col-count" />
          <col className="col-count" />
          <col className="col-count" />
          <col className="col-count" />
          <col className="col-count" />
          <col className="col-count" />
        </colgroup>
        <thead>
          <tr>
            <th>Status</th>
            <th>Type</th>
            <th className="bar-cell">Typical time</th>
            <th className="num" title="Half of the cards spent less time in the status than this">
              Median
            </th>
            <th
              className="num"
              title="85 of every 100 cards spent less time in the status than this"
            >
              85% within
            </th>
            <th
              className="num"
              title="95 of every 100 cards spent less time in the status than this"
            >
              95% within
            </th>
            <th className="num" title="Cards in the status right now; click to list them">
              In it now
            </th>
            <th
              className="num"
              title="Cards that left the status in the period; click to list them"
            >
              Cards
            </th>
            <th
              className="num"
              title="Of the cards that left the status for the first time in the period, the share that never came back to it, by the project's return rules"
            >
              First time
            </th>
            <th
              className="num"
              title="Returns in the period credited to the status, by the project's return rules: whose work came back"
            >
              Return events
            </th>
            <th className="num">Returned cards</th>
            <th
              className="num"
              title="Return events after each card's first return to this status in the period"
            >
              Repeat returns
            </th>
            <th
              className="num"
              title="Cards with two or more returns / all returned cards in this status and period"
            >
              Repeat return rate
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => {
            const color = readable(column.color || NEUTRAL, CARD_BACKGROUND, FALLBACK_MARK);
            const passed = flow.report.column_cards.filter(
              (card) => card.status_id === column.status_id && !card.now,
            );
            const now = flow.report.column_cards.filter(
              (card) => card.status_id === column.status_id && card.now,
            );
            const isOpen = open?.status === column.status_id ? open : null;
            const other = others.get(column.status_id);
            const cell = (list: ColumnCard[], count: number, forNow: boolean) => (
              <td
                className={`num${count > 0 ? " matrix-cell" : ""}${
                  isOpen?.now === forNow ? " open" : ""
                }`}
                onClick={() => count > 0 && toggle(column.status_id, forNow)}
                title={count > 0 ? "Click to list these cards" : undefined}
              >
                {list.length || count ? (
                  <button
                    type="button"
                    className="count-open"
                    aria-label={`Show ${column.name}: ${forNow ? "now" : "passed"}`}
                    aria-expanded={isOpen?.now === forNow}
                  >
                    <span className="matrix-number">{formatNumber(list.length || count)}</span>
                  </button>
                ) : (
                  <span className="matrix-empty">·</span>
                )}
                {rest && (
                  <span className="rest-value" title={REST_NAME}>
                    {formatNumber(forNow ? other?.in_column_now ?? 0 : other?.cards ?? 0)}
                  </span>
                )}
              </td>
            );
            const note = restNote(column.p50, other?.p50 ?? null);
            const restLine = (value: number | null) =>
              rest && (
                <span className="rest-value" title={REST_NAME}>
                  {formatDuration(value)}
                </span>
              );
            return (
              <Fragment key={column.status_id}>
                <tr>
                  <td>
                    <span className="column-name">
                      <span
                        className="column-color"
                        style={{ background: column.color || NEUTRAL }}
                      />
                      <TextLink
                        to={columnPath(slug, itemType, column.status_id)}
                        target="_blank"
                        rel="noreferrer"
                        title={`${column.name}: cards in it now and how long they stay`}
                      >
                        {column.name}
                      </TextLink>
                    </span>
                    {column.is_deleted && <span className="badge badge-accent">Removed</span>}
                  </td>
                  <td>
                    {column.type && <span className="badge badge-muted">{column.type}</span>}
                  </td>
                  <td
                    className="bar-cell"
                    title={`Median ${formatDuration(column.p50)}, 85% within ${formatDuration(
                      column.p85,
                    )}`}
                  >
                    <span className="status-track">
                      <span
                        className="status-range"
                        style={{ ...fillWidth(width(column.p85)), background: color }}
                      />
                      <span
                        className="status-median"
                        style={{ ...fillWidth(width(column.p50)), background: color }}
                      />
                    </span>
                    {rest && (
                      <>
                        <span
                          className="status-track status-track-rest"
                          title={`${REST_NAME}: median ${formatDuration(
                            other?.p50 ?? null,
                          )}, 85% within ${formatDuration(other?.p85 ?? null)}`}
                        >
                          <span
                            className="status-range"
                            style={{
                              ...fillWidth(width(other?.p85 ?? null)),
                              background: REST_COLOR,
                            }}
                          />
                          <span
                            className="status-median"
                            style={{
                              ...fillWidth(width(other?.p50 ?? null)),
                              background: REST_COLOR,
                            }}
                          />
                        </span>
                        {note.text && (
                          <span className="rest-note" style={{ color: note.color }}>
                            {note.text}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="num">
                    {formatDuration(column.p50)}
                    {restLine(other?.p50 ?? null)}
                  </td>
                  <td className="num">
                    {formatDuration(column.p85)}
                    {restLine(other?.p85 ?? null)}
                  </td>
                  <td className="num">
                    {formatDuration(column.p95)}
                    {restLine(other?.p95 ?? null)}
                  </td>
                  {cell(now, column.in_column_now, true)}
                  {cell(passed, column.cards, false)}
                  <td
                    className="num"
                    title={`${column.clean_passes} of ${column.passes} first passes never came back`}
                  >
                    {column.clean_passes > 0 ? (
                      <MetricPopup
                        label={`Show clean first passes of ${column.name}`}
                        content={
                          <FirstPassList
                            {...props}
                            title={`${column.name}: clean first passes`}
                            events={flow.report.first_passes.filter(
                              (event) => event.clean && event.status_id === column.status_id,
                            )}
                          />
                        }
                      >
                        {formatNumber(column.clean_passes)}
                      </MetricPopup>
                    ) : (
                      "·"
                    )}
                    <span className="quality-percent">
                      {firstTime(column.passes, column.clean_passes)}
                    </span>
                    {rest && (
                      <span className="rest-value" title={REST_NAME}>
                        {firstTime(other?.passes ?? 0, other?.clean_passes ?? 0)}
                      </span>
                    )}
                  </td>
                  <td
                    className={`num${cameBack.get(column.status_id) ? " back-cell" : ""}`}
                    title="Returns credited to this status in the period"
                  >
                    {cameBack.get(column.status_id) ? (
                      <MetricPopup
                        label={`Show returns credited to ${column.name}`}
                        content={
                          <ReturnEventList
                            {...props}
                            title={`${column.name}: returns`}
                            events={events.filter(
                              (event) => event.credited_status === column.status_id,
                            )}
                          />
                        }
                      >
                        {formatNumber(cameBack.get(column.status_id) ?? 0)}
                      </MetricPopup>
                    ) : (
                      "·"
                    )}
                  </td>
                  <ReturnSummaryCells
                    {...props}
                    title={column.name}
                    events={events.filter((event) => event.credited_status === column.status_id)}
                  />
                </tr>
                {isOpen && (
                  <tr className="history-row">
                    <td colSpan={13} className="matrix-panel-cell">
                      <ColumnCards {...props} cards={isOpen.now ? now : passed} now={isOpen.now} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="matrix-total-row">
            <th scope="row">Total</th>
            <td colSpan={5} />
            {([true, false] as const).map((forNow) => {
              const count = flow.report.column_cards.filter((card) => card.now === forNow).length;
              const isOpen =
                open?.status === null && open.now === forNow && !open.progress && !open.stuck;
              return (
                <td
                  key={String(forNow)}
                  className={`num matrix-total${count > 0 ? " matrix-cell" : ""}${
                    isOpen ? " open" : ""
                  }`}
                  onClick={() => count > 0 && toggle(null, forNow)}
                  title={count > 0 ? "Click for the split by status and the cards" : undefined}
                >
                  {count > 0 ? (
                    <button
                      type="button"
                      className="count-open"
                      aria-label={`Show all cards ${forNow ? "now" : "passed"}`}
                      aria-expanded={isOpen}
                    >
                      <span className="matrix-number">{formatNumber(count)}</span>
                    </button>
                  ) : (
                    <span className="matrix-number">0</span>
                  )}
                </td>
              );
            })}
            <td className="num">
              {cleanEvents.length ? (
                <MetricPopup
                  label="Show all clean first passes"
                  content={
                    <>
                      <DonutSplit
                        slices={eventSlices(cleanEvents.map((event) => event.status_id))}
                        total={cleanEvents.length}
                        caption="passes"
                      />
                      <FirstPassList
                        {...props}
                        title="All clean first passes"
                        events={cleanEvents}
                      />
                    </>
                  }
                >
                  {formatNumber(columns.reduce((sum, column) => sum + column.clean_passes, 0))}
                </MetricPopup>
              ) : (
                "·"
              )}
              <span className="quality-percent">
                {firstTime(
                  columns.reduce((sum, column) => sum + column.passes, 0),
                  columns.reduce((sum, column) => sum + column.clean_passes, 0),
                )}
              </span>
            </td>
            <td className="num">
              {allBack ? (
                <MetricPopup
                  label="Show all return events"
                  content={
                    <>
                      <DonutSplit
                        slices={eventSlices(returnEvents.map((event) => event.credited_status))}
                        total={returnEvents.length}
                        caption="returns"
                      />
                      <ReturnEventList
                        {...props}
                        title="All return events"
                        events={returnEvents}
                      />
                    </>
                  }
                >
                  {formatNumber(allBack)}
                </MetricPopup>
              ) : (
                "·"
              )}
            </td>
            <ReturnSummaryCells {...props} title="All statuses" events={returnEvents} />
          </tr>
          {open?.status === null && (
            <StatusTotals
              {...props}
              now={open.now}
              progress={Boolean(open.progress)}
              stuck={Boolean(open.stuck)}
            />
          )}
        </tfoot>
      </table>
    </div>
  );
}

function StatusTotals({
  now,
  progress,
  stuck,
  ...props
}: TabProps & { now: boolean; progress: boolean; stuck: boolean }) {
  const { flow } = props;
  const working = new Set(
    flow.report.columns
      .filter((column) => column.type !== null && IN_PROGRESS_TYPES.has(column.type))
      .map((column) => column.status_id),
  );
  const stuckIds = new Set(
    flow.report.stuck.filter((card) => card.level).map((card) => card.item_id),
  );
  const cards = flow.report.column_cards.filter(
    (card) =>
      card.now === now &&
      (!progress || working.has(card.status_id)) &&
      (!stuck || stuckIds.has(card.item_id)),
  );
  const total = cards.length;
  const slices: Slice[] = flow.report.columns.flatMap((column) => {
    const count = cards.filter((card) => card.status_id === column.status_id).length;
    return count
      ? [
          {
            key: String(column.status_id),
            label: null,
            name: column.name,
            to: columnPath(props.slug, props.itemType, column.status_id),
            color: statusColor(flow, column.status_id, false),
            count,
          },
        ]
      : [];
  });
  return (
    <>
      <tr id={OPENED_CARDS} className="history-row donut-row">
        <td colSpan={13}>
          <DonutSplit slices={slices} total={total} caption="cards" />
        </td>
      </tr>
      <tr className="history-row">
        <td colSpan={13} className="matrix-panel-cell glued">
          <ColumnCards {...props} cards={cards} now={now} withStatus />
        </td>
      </tr>
    </>
  );
}

const CARD_DOT = "#008aa8";
const MEDIAN_LINE = "#4c566a";
const P85_LINE = "#d1435b";
const GAP_DAYS = 28;
const GAP_SHARE = 0.1;
const ROLLING_DAYS = 28;
const DAY_MS = 86400000;
const MEDIAN = "Median";
const P85 = "85% within";
const ROLLING = "Median of the last 4 weeks";
const BIN_STEPS = [1 / 24, 2 / 24, 6 / 24, 12 / 24, 1, 2, 5, 10, 20, 50, 100, 200];
const DOT_PLOT_BELOW = 30;
const MAX_BINS = 20;

interface FinishedRow {
  item_id: number;
  ref: number | null;
  subject: string;
  finished_at: string;
  is_deleted: boolean;
  assignees: number[];
  user_id: number | null;
  days: number | null;
}

interface Selection {
  id: string;
  keys: ReadonlySet<string>;
  caption: string;
}

function useSelection() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const choose = (next: Selection) =>
    setSelection((current) => (current?.id === next.id ? null : next));
  return [selection, choose, setSelection] as const;
}

function keysOf<T extends { item_id: number }>(items: T[]): Set<string> {
  return new Set(items.map((item) => String(item.item_id)));
}

function FinishedCards({
  rows,
  caption,
  took,
  onFocus,
  ...props
}: TabProps & {
  rows: FinishedRow[];
  caption: string;
  took: string;
  onFocus?: (key: string | null) => void;
}) {
  const { flow, slug, itemType, taigaUrl } = props;
  const [sort, onSort] = useSort();
  const newest = [...rows].sort((a, b) => b.finished_at.localeCompare(a.finished_at));
  const sorted = sortRows(newest, sort, (row, key) => {
    switch (key) {
      case "finished":
        return row.finished_at;
      case "card":
        return row.ref ?? row.item_id;
      case "days":
        return row.days;
      case "assigned":
        return peopleText(flow, row.assignees);
      default:
        return row.user_id === null ? null : personName(flow, row.user_id, "");
    }
  });
  const title = (label: string, key: string, numeric = false) => (
    <SortTitle
      label={label}
      sortKey={key}
      sort={sort}
      onSort={onSort}
      className={numeric ? "table-sort num-sort" : "table-sort"}
    />
  );
  return (
    <div className="chart-list" onPointerLeave={() => onFocus?.(null)}>
      <p className="chart-list-caption">{caption}</p>
      <table className="table table-compact move-events">
        <colgroup>
          <col className="col-when" />
          <col />
          <col className="col-time" />
          <col className="col-people" />
          <col className="col-by" />
        </colgroup>
        <thead>
          <tr>
            <th>{title("Finished at", "finished")}</th>
            <th>{title("Card", "card")}</th>
            <th className="num">{title(took, "days", true)}</th>
            <th>{title("Assigned", "assigned")}</th>
            <th>{title("Finished by", "user")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.item_id} onPointerEnter={() => onFocus?.(String(row.item_id))}>
              <td className="nowrap">{formatDateTime(row.finished_at)}</td>
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
              <td className="num nowrap">{row.days === null ? "-" : formatDuration(row.days)}</td>
              <td className="truncate">
                <PeopleRefs directory={flow} ids={row.assignees} nobody="Unassigned" />
              </td>
              <td className="truncate">
                <PersonRef directory={flow} id={row.user_id} nobody="Unknown" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function zoneMidnight(day: string, zone: string): number {
  const guess = dayNumber(day) * DAY_MS;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const shown = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  return guess - (shown - guess);
}

function chartDays(flow: FlowResponse, start: number, end: number): AxisDay[] {
  const zone = flow.timezone;
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    ...(end - start > 300 * DAY_MS ? { year: "2-digit" as const } : {}),
    timeZone: "UTC",
  });
  const days: AxisDay[] = [];
  const last = dayNumber(localDay(new Date(end), zone));
  for (let value = dayNumber(localDay(new Date(start), zone)); value <= last; value += 1) {
    const day = dayText(value);
    const at = zoneMidnight(day, zone);
    if (at < start || at > end) {
      continue;
    }
    days.push({
      at,
      monday: new Date(value * DAY_MS).getUTCDay() === 1,
      label: format.format(new Date(value * DAY_MS)),
    });
  }
  return days;
}

function finishGaps(flow: FlowResponse, moments: number[], start: number, end: number): TimeGap[] {
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    ...(end - start > 300 * DAY_MS ? { year: "2-digit" as const } : {}),
    timeZone: flow.timezone,
  });
  const edges = [start, ...[...moments].sort((a, b) => a - b), end];
  const least = Math.max(GAP_DAYS * DAY_MS, (end - start) * GAP_SHARE);
  const gaps: TimeGap[] = [];
  edges.forEach((from, index) => {
    const to = edges[index + 1];
    if (to !== undefined && to - from >= least) {
      gaps.push({
        from,
        to,
        label: `No cards finished, ${format.format(new Date(from))} to ${format.format(
          new Date(to),
        )}`,
      });
    }
  });
  return gaps;
}

function timeSpan(flow: FlowResponse): TimeSpan {
  const moments = flow.report.finishes.map((finish) => new Date(finish.finished_at).getTime());
  const [start, end] = chartSpan(flow, moments);
  return {
    start,
    end,
    days: chartDays(flow, start, end),
    gaps: finishGaps(flow, moments, start, end),
  };
}

function chartSpan(flow: FlowResponse, moments: number[]): [number, number] {
  const endMoment =
    flow.period_end && flow.period_end < flow.generated_at ? flow.period_end : flow.generated_at;
  const end = new Date(endMoment).getTime();
  const start = flow.period_start
    ? new Date(flow.period_start).getTime()
    : Math.min(end - DAY_MS, ...moments);
  return [start, Math.max(end, start + DAY_MS)];
}

function rollingMedians(samples: Sample[]): Map<number, number> {
  const sorted = [...samples].sort((a, b) => a.finished_at.localeCompare(b.finished_at));
  const window = ROLLING_DAYS * DAY_MS;
  const result = new Map<number, number>();
  for (const sample of sorted) {
    const at = new Date(sample.finished_at).getTime();
    const days = sorted
      .filter((other) => {
        const moment = new Date(other.finished_at).getTime();
        return moment <= at && moment > at - window;
      })
      .map((other) => other.days);
    const median = days.length >= 3 ? percentile(days, 0.5) : null;
    if (median !== null) {
      result.set(sample.item_id, median);
    }
  }
  return result;
}

function rollingLine(
  samples: Sample[],
  medians: Map<number, number>,
): ([number, number] | null)[] {
  const sorted = [...samples].sort((a, b) => a.finished_at.localeCompare(b.finished_at));
  const window = ROLLING_DAYS * DAY_MS;
  const result: ([number, number] | null)[] = [];
  let previous: number | null = null;
  sorted.forEach((sample, index) => {
    const at = new Date(sample.finished_at).getTime();
    const next = sorted[index + 1];
    if (
      next &&
      Math.floor(new Date(next.finished_at).getTime() / DAY_MS) === Math.floor(at / DAY_MS)
    ) {
      return;
    }
    const median = medians.get(sample.item_id) ?? null;
    if (median === null || (previous !== null && at - previous > window)) {
      result.push(null);
    }
    if (median !== null) {
      result.push([at, median]);
      previous = at;
    }
  });
  return result;
}

function sameSamples(first: Distribution, second: Distribution): boolean {
  if (first.samples.length !== second.samples.length) {
    return false;
  }
  const days = new Map(first.samples.map((sample) => [sample.item_id, sample.days]));
  return second.samples.every(
    (sample) => Math.abs((days.get(sample.item_id) ?? -1) - sample.days) < 1e-6,
  );
}

function sampleRow(sample: Sample): FinishedRow {
  return { ...sample, days: sample.days };
}

function within(distribution: Distribution, name: string, medians: Map<number, number>) {
  const limit = name === MEDIAN ? distribution.p50 : name === P85 ? distribution.p85 : null;
  return (sample: Sample) =>
    name === ROLLING
      ? sample.days <= (medians.get(sample.item_id) ?? -1) + 1e-9
      : limit !== null && sample.days <= limit + 1e-9;
}

function withinCaption(count: number, name: string, distribution: Distribution): string {
  const cards = plural(count, "card", "cards");
  if (name === MEDIAN) {
    return `${cards} within the median, ${formatDuration(distribution.p50)}`;
  }
  if (name === P85) {
    return `${cards} within 85%, ${formatDuration(distribution.p85)}`;
  }
  return `${cards} within the median of the 4 weeks before they finished`;
}

function DistributionChart({
  distribution,
  took,
  span,
  ...props
}: TabProps & { distribution: Distribution; took: string; span: TimeSpan }) {
  const { slug, itemType, flow } = props;
  const [selection, choose] = useSelection();
  const [focus, setFocus] = useState<string | null>(null);
  if (distribution.samples.length === 0) {
    return <Empty>No finished cards in this period.</Empty>;
  }
  const samples = distribution.samples;
  const medians = rollingMedians(samples);
  const lineKeys = (name: string) => keysOf(samples.filter(within(distribution, name, medians)));
  const dayFormat = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: flow.timezone,
  });
  const rows = selection
    ? samples.filter((sample) => selection.keys.has(String(sample.item_id)))
    : [];
  return (
    <>
      <div className="metric-chart">
        <ScatterChart
          points={samples.map((sample) => ({
            key: String(sample.item_id),
            x: new Date(sample.finished_at).getTime(),
            y: sample.days,
            title: `${sample.ref === null ? "" : `#${sample.ref} `}${sample.subject}`,
            lines: [
              `Finished ${formatDateTime(sample.finished_at)}`,
              `Took ${formatDuration(sample.days)}`,
            ],
          }))}
          rules={[
            ...(distribution.p50 === null
              ? []
              : [{ name: MEDIAN, color: MEDIAN_LINE, value: distribution.p50 }]),
            ...(distribution.p85 === null
              ? []
              : [{ name: P85, color: P85_LINE, value: distribution.p85, dashed: true }]),
          ]}
          trend={{ name: ROLLING, points: rollingLine(samples, medians) }}
          span={span}
          color={CARD_DOT}
          count={plural(samples.length, "card", "cards")}
          selectedId={selection?.id ?? null}
          selectedKeys={selection?.keys ?? null}
          focusKey={focus}
          linePreview={lineKeys}
          formatX={(time) => dayFormat.format(new Date(time))}
          onLine={(name) => {
            const keys = lineKeys(name);
            choose({ id: name, keys, caption: withinCaption(keys.size, name, distribution) });
          }}
          onCluster={(keys, at) =>
            choose({
              id: `cluster-${at}`,
              keys: new Set(keys),
              caption: `${plural(keys.length, "card", "cards")} finished around ${dayFormat.format(
                new Date(at),
              )}`,
            })
          }
          onAll={() =>
            choose({
              id: "all",
              keys: keysOf(samples),
              caption: `All ${plural(samples.length, "card", "cards")}`,
            })
          }
          onPoint={(point) =>
            openInNewTab(cardPath(slug, MODULE_OF_TYPE[itemType], Number(point.key)))
          }
        />
      </div>
      {selection && (
        <FinishedCards
          {...props}
          rows={rows.map(sampleRow)}
          caption={selection.caption}
          took={took}
          onFocus={setFocus}
        />
      )}
    </>
  );
}

function binStep(top: number): number {
  return BIN_STEPS.find((step) => top / step <= MAX_BINS) ?? BIN_STEPS[BIN_STEPS.length - 1] ?? 1;
}

type DistributionView = "shape" | "cumulative";

const DISTRIBUTION_VIEWS: { value: DistributionView; label: string }[] = [
  { value: "shape", label: "Distribution" },
  { value: "cumulative", label: "Cumulative %" },
];

function Histogram({
  distribution,
  took,
  title,
  embedded,
  ...props
}: TabProps & {
  distribution: Distribution;
  took: string;
  title: string;
  embedded?: DistributionView;
}) {
  const { slug, itemType } = props;
  const [selection, choose, setSelection] = useSelection();
  const [focus, setFocus] = useState<string | null>(null);
  const [ownView, setView] = useState<DistributionView>("shape");
  const view = embedded ?? ownView;
  const samples = distribution.samples;
  const values = samples.map((sample) => sample.days);
  const few = values.length < DOT_PLOT_BELOW;
  const max = Math.max(1 / 24, ...values);
  const step = binStep(max);
  const count = Math.max(1, Math.ceil(max / step - 1e-9));
  const binOf = (days: number) => Math.min(count - 1, Math.floor(days / step));
  const binKey = (sample: Sample) => `bin-${binOf(sample.days)}`;
  const sizes = Array.from({ length: count }, () => 0);
  for (const value of values) {
    sizes[binOf(value)] = (sizes[binOf(value)] ?? 0) + 1;
  }
  const titleOf = (index: number) => {
    const from = index * step;
    return index === 0
      ? `under ${formatDuration(step)}`
      : `${formatDuration(from)} to ${formatDuration(from + step)}`;
  };
  const markers = [
    { name: MEDIAN, color: MEDIAN_LINE, value: distribution.p50, dashed: false, short: "50%" },
    { name: P85, color: P85_LINE, value: distribution.p85, dashed: true, short: "85%" },
  ].flatMap((marker) =>
    marker.value === null
      ? []
      : [
          {
            name: marker.name,
            color: marker.color,
            dashed: marker.dashed,
            value: marker.value,
            at: Math.min(count, marker.value / step),
            label: `${marker.short}: ${formatDuration(marker.value)}`,
          },
        ],
  );
  const withinKeys = (name: string) =>
    keysOf(samples.filter(within(distribution, name, new Map())));
  const binsOf = (keys: ReadonlySet<string>) =>
    new Set(samples.filter((sample) => keys.has(String(sample.item_id))).map(binKey));
  const chooseMarker = (name: string) => {
    const keys = withinKeys(name);
    choose({ id: name, keys, caption: withinCaption(keys.size, name, distribution) });
  };
  const chooseAll = () =>
    choose({
      id: "all",
      keys: keysOf(samples),
      caption: `All ${plural(samples.length, "card", "cards")}`,
    });
  const rows = selection
    ? samples.filter((sample) => selection.keys.has(String(sample.item_id)))
    : [];
  const countLabel = plural(samples.length, "card", "cards");
  const legend: LegendItem[] = [
    { name: countLabel, color: CARD_DOT, kind: few && view === "shape" ? "dot" : "bar" },
    { name: MEDIAN, color: MEDIAN_LINE, kind: "line" },
    { name: P85, color: P85_LINE, kind: "dashed" },
  ];
  const subtitle =
    view === "cumulative"
      ? "Share of the cards that finished within a given time. Click anywhere for the cards up to that time."
      : few
        ? "Each dot is a finished card, placed by the time it took; fewer than 30 cards are too few for a histogram. Click a dot for the card, a line for the cards within it."
        : "How many cards finished within each span of time. Click a bar for its cards, a line for the cards within it.";

  const body = (
    <>
      {values.length === 0 ? (
        <Empty>No finished cards in this period.</Empty>
      ) : (
        <>
          <div className="metric-chart">
            {view === "cumulative" ? (
              <CdfChart
                values={values}
                color={CARD_DOT}
                markers={markers.map((marker) => ({
                  name: marker.name,
                  color: marker.color,
                  value: marker.value,
                  share: marker.name === MEDIAN ? 0.5 : 0.85,
                  dashed: marker.dashed,
                }))}
                legend={[
                  { name: countLabel, color: CARD_DOT, kind: "line" },
                  { name: MEDIAN, color: MEDIAN_LINE, kind: "line" },
                  { name: P85, color: P85_LINE, kind: "dashed" },
                ]}
                count={countLabel}
                selectedId={selection?.id ?? null}
                onAll={chooseAll}
                onPick={(days) => {
                  const keys = keysOf(samples.filter((sample) => sample.days <= days + 1e-9));
                  choose({
                    id: `upto-${days}`,
                    keys,
                    caption: `${plural(
                      keys.size,
                      "card",
                      "cards",
                    )} that took up to ${formatDuration(days)}`,
                  });
                }}
              />
            ) : few ? (
              <DotPlot
                dots={samples.map((sample) => ({
                  key: String(sample.item_id),
                  value: sample.days,
                  title: `${sample.ref === null ? "" : `#${sample.ref} `}${sample.subject}`,
                  lines: [
                    `Finished ${formatDateTime(sample.finished_at)}`,
                    `Took ${formatDuration(sample.days)}`,
                  ],
                }))}
                color={CARD_DOT}
                markers={markers}
                legend={legend}
                count={countLabel}
                selectedId={selection?.id ?? null}
                selectedKeys={selection?.keys ?? null}
                focusKey={focus}
                markerPreview={withinKeys}
                onDot={(dot) =>
                  openInNewTab(cardPath(slug, MODULE_OF_TYPE[itemType], Number(dot.key)))
                }
                onMarker={chooseMarker}
                onAll={chooseAll}
              />
            ) : (
              <BarChart
                bars={sizes.map((size, index) => ({
                  key: `bin-${index}`,
                  label: shortDays(index * step),
                  title: titleOf(index),
                  value: size,
                }))}
                color={CARD_DOT}
                barName="Cards"
                count={countLabel}
                markers={markers}
                legend={legend}
                format={(value) => formatNumber(Math.round(value))}
                lineFormat={(value) => value.toFixed(1)}
                crossX={(position) => shortDays(Math.max(0, position * step))}
                selectedId={selection?.id ?? null}
                selectedBars={selection ? binsOf(selection.keys) : null}
                focusBar={
                  focus === null
                    ? null
                    : binsOf(new Set([focus]))
                        .values()
                        .next().value ?? null
                }
                dayWidth={step}
                markerPreview={(name) => binsOf(withinKeys(name))}
                gap={0}
                onBar={(bar) => {
                  const keys = keysOf(samples.filter((sample) => binKey(sample) === bar.key));
                  const index = Number(bar.key.slice(4));
                  choose({
                    id: bar.key,
                    keys,
                    caption: `${plural(keys.size, "card", "cards")} that took ${titleOf(index)}`,
                  });
                }}
                onMarker={chooseMarker}
                onAll={chooseAll}
              />
            )}
          </div>
          {selection && (
            <FinishedCards
              {...props}
              rows={rows.map(sampleRow)}
              caption={selection.caption}
              took={took}
              onFocus={setFocus}
            />
          )}
        </>
      )}
    </>
  );
  if (embedded) {
    return body;
  }
  return (
    <MetricCard
      title={title}
      subtitle={subtitle}
      actions={
        values.length > 0 && (
          <Segmented
            label="View"
            options={DISTRIBUTION_VIEWS}
            value={view}
            onChange={(next) => {
              setSelection(null);
              setView(next);
            }}
          />
        )
      }
    >
      {body}
    </MetricCard>
  );
}

interface TabProps {
  flow: FlowResponse;
  slug: string;
  itemType: ItemType;
  taigaUrl: string | null;
  rest?: FlowResponse | null;
}

export const REST_COLOR = "#c5c9d6";
export const REST_NAME = "The rest";

const DELETED = "Deleted";
const CREATED = "Created";

function columnNames(flow: FlowResponse): (id: number | null) => string {
  const names = new Map(flow.report.columns.map((column) => [column.status_id, column.name]));
  return (id) => (id === null ? "-" : names.get(id) ?? `Status ${id}`);
}

export function ColumnLabel({
  flow,
  id,
  empty,
  to,
}: {
  flow: FlowResponse;
  id: number | null;
  empty: string;
  to?: string;
}) {
  const column = flow.report.columns.find((candidate) => candidate.status_id === id);
  if (id === null || !column) {
    if (id === null && empty === DELETED) {
      return <span className="deleted-status">{DELETED}</span>;
    }
    return <span className="muted-inline">{id === null ? empty : `Status ${id}`}</span>;
  }
  return (
    <span className="column-name">
      <span className="column-color" style={{ background: column.color || "#a9aabc" }} />
      {to ? (
        <TextLink
          to={to}
          target="_blank"
          rel="noreferrer"
          title={`${column.name}: cards in it now and how long they stay`}
          onClick={(event) => event.stopPropagation()}
        >
          {column.name}
        </TextLink>
      ) : (
        column.name
      )}
    </span>
  );
}

function statusOrder(flow: FlowResponse): (id: number | null) => number {
  const position = new Map(flow.report.columns.map((column, index) => [column.status_id, index]));
  return (id) => (id === null ? -1 : position.get(id) ?? flow.report.columns.length);
}

function peopleText(flow: FlowResponse, ids: number[]): string | null {
  return ids.length === 0 ? null : ids.map((id) => personName(flow, id, "")).join(", ");
}

export function personName(flow: FlowResponse, id: number | null, nobody: string): string {
  return id === null ? nobody : flow.people[String(id)] ?? `#${id}`;
}

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export type Bucket = "day" | "week" | "month" | "year";

export function localDay(moment: string | Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(moment));
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1) / 86400000;
}

function dayText(value: number): string {
  return new Date(value * 86400000).toISOString().slice(0, 10);
}

function bucketOf(day: string, bucket: Bucket): string {
  if (bucket === "day") {
    return day;
  }
  if (bucket === "month") {
    return `${day.slice(0, 7)}-01`;
  }
  if (bucket === "year") {
    return `${day.slice(0, 4)}-01-01`;
  }
  const value = dayNumber(day);
  const weekday = (new Date(value * 86400000).getUTCDay() + 6) % 7;
  return dayText(value - weekday);
}

function nextBucket(key: string, bucket: Bucket): string {
  if (bucket === "year") {
    return `${Number(key.slice(0, 4)) + 1}-01-01`;
  }
  if (bucket === "month") {
    const [year, month] = key.split("-").map(Number);
    const next = new Date(Date.UTC(year ?? 1970, month ?? 1, 1));
    return next.toISOString().slice(0, 10);
  }
  return dayText(dayNumber(key) + (bucket === "week" ? 7 : 1));
}

const bucketFormat: Record<Bucket, Intl.DateTimeFormat> = {
  day: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }),
  week: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }),
  month: new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
  year: new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" }),
};

function percentile(values: number[], share: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(share * sorted.length - 1e-9));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

const JUMP_LEAST = 5;
const JUMP_SHARE = 0.1;
const MAX_JUMPS = 3;

function jumpsOf(flow: FlowResponse): { at: number; count: number; label: string }[] {
  const byDay = new Map<string, number[]>();
  for (const finish of flow.report.finishes) {
    const day = localDay(finish.finished_at, flow.timezone);
    byDay.set(day, [...(byDay.get(day) ?? []), new Date(finish.finished_at).getTime()]);
  }
  const total = flow.report.finishes.length;
  const least = Math.max(JUMP_LEAST, total * JUMP_SHARE);
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  return [...byDay.entries()]
    .filter(([, moments]) => moments.length >= least)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_JUMPS)
    .map(([day, moments]) => ({
      at: Math.max(...moments),
      count: moments.length,
      label: `+${moments.length}, ${format.format(new Date(dayNumber(day) * DAY_MS))}`,
    }));
}

interface TrendPoint {
  key: string;
  label: string;
  detail?: string;
}

interface Trend {
  points: TrendPoint[];
  values: number[][];
}

export function trendOf(
  flow: FlowResponse,
  bucket: Bucket,
  items: { moment: string; value: number }[],
): Trend {
  const zone = flow.timezone;
  const workdays = new Set(flow.working_weekdays.length ? flow.working_weekdays : [1, 2, 3, 4, 5]);
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const key = bucketOf(localDay(item.moment, zone), bucket);
    grouped.set(key, [...(grouped.get(key) ?? []), item.value]);
  }
  const earliest = [...items].map((item) => item.moment).sort()[0];
  const firstDay = flow.period_start
    ? localDay(flow.period_start, zone)
    : earliest
      ? localDay(earliest, zone)
      : null;
  const endMoment =
    flow.period_end && flow.period_end < flow.generated_at ? flow.period_end : flow.generated_at;
  const lastDay = localDay(new Date(new Date(endMoment).getTime() - 1), zone);
  const points: TrendPoint[] = [];
  const values: number[][] = [];
  if (firstDay) {
    const last = bucketOf(lastDay, bucket);
    for (
      let key = bucketOf(firstDay, bucket);
      key <= last && points.length < 1500;
      key = nextBucket(key, bucket)
    ) {
      const weekday = ((new Date(dayNumber(key) * 86400000).getUTCDay() + 6) % 7) + 1;
      if (bucket === "day" && !workdays.has(weekday) && !grouped.has(key)) {
        continue;
      }
      const label = bucketFormat[bucket].format(new Date(dayNumber(key) * 86400000));
      const list = grouped.get(key) ?? [];
      points.push({
        key,
        label,
        detail: `${bucket === "week" ? "Week of " : ""}${label}: ${list.length} ${
          list.length === 1 ? "card" : "cards"
        } finished`,
      });
      values.push(list);
    }
  }
  return { points, values };
}

function Throughput({
  span,
  openAll,
  ...props
}: TabProps & {
  span: TimeSpan;
  openAll: boolean;
}) {
  const { flow } = props;
  const [selection, choose, setSelection] = useSelection();
  useEffect(() => {
    if (openAll && flow.report.finishes.length > 0) {
      setSelection({
        id: "all",
        keys: keysOf(flow.report.finishes),
        caption: `All ${plural(flow.report.finishes.length, "card finished", "cards finished")}`,
      });
    }
  }, [openAll]);
  const finishes = flow.report.finishes;
  const total = finishes.length;
  const dateFormat = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: flow.timezone,
  });
  const lead = new Map(
    flow.report.lead_time.samples.map((sample) => [sample.item_id, sample.days]),
  );
  const chosen = selection
    ? finishes.filter((finish) => selection.keys.has(String(finish.item_id)))
    : [];
  const countLabel = plural(total, "card finished", "cards finished");
  const chooseAll = () =>
    choose({ id: "all", keys: keysOf(finishes), caption: `All ${countLabel}` });
  return (
    <MetricCard
      title="Throughput"
      subtitle={`Cards finished so far, ${formatNumber(
        total,
      )} in all. The line climbs with every finish: flat stretches are pauses, steep ones bursts; the largest are labelled. Click the line for the cards.`}
    >
      {total === 0 ? (
        <Empty>No finished cards yet.</Empty>
      ) : (
        <div className="metric-chart">
          <CumulativeChart
            count={countLabel}
            selectedId={selection?.id ?? null}
            onAll={chooseAll}
            moments={finishes.map((finish) => new Date(finish.finished_at).getTime())}
            span={span}
            color={CARD_DOT}
            name="Cards finished so far"
            jumps={jumpsOf(flow)}
            describe={(time, count) =>
              `${plural(count, "card", "cards")} finished by ${dateFormat.format(new Date(time))}`
            }
          />
        </div>
      )}
      {selection && (
        <div id={openAll && selection.id === "all" ? OPENED_CARDS : undefined}>
          <FinishedCards
            {...props}
            rows={chosen.map((finish) => ({
              ...finish,
              days: lead.get(finish.item_id) ?? null,
            }))}
            caption={selection.caption}
            took="Lead time"
            onFocus={() => undefined}
          />
        </div>
      )}
    </MetricCard>
  );
}

function sameAsLeadNote(flow: FlowResponse): string {
  const first = flow.report.columns.find((column) => !column.is_deleted);
  return first?.type === "work"
    ? `Cycle time is the same as lead time here: cards start in ${first.name}, which is typed Work, so their work starts at creation.`
    : "Cycle time is the same as lead time here: every finished card was in a Work status from its creation.";
}

export function StatusTimesCard({
  statuses = null,
  ...props
}: TabProps & { statuses?: number[] | null }) {
  const [opened] = useState(() => new URLSearchParams(window.location.search).get("open"));
  const [timesOpen, setTimesOpen] = useState<TimesOpen | null>(() => openedTimes(opened));
  useEffect(() => {
    if (openedTimes(opened)) {
      return scrollWhenSettled(OPENED_CARDS);
    }
    return undefined;
  }, [opened]);
  return (
    <MetricCard
      title="Time in statuses"
      subtitle="How long a card spends in each status, all its visits added up, in Taiga's status order; the share that passed it the first time, and how many returns came back to it (whose work did not pass), by the return settings. Click a status for its page, a number under In it now or Cards for the cards."
    >
      <ColumnTimes {...props} statuses={statuses} open={timesOpen} setOpen={setTimesOpen} />
    </MetricCard>
  );
}

type SpeedView = "dots" | DistributionView;

const SPEED_VIEWS: { value: SpeedView; label: string }[] = [
  { value: "dots", label: "Over time" },
  { value: "shape", label: "Distribution" },
  { value: "cumulative", label: "Cumulative %" },
];

const MEASURES: { value: "lead" | "cycle"; label: string }[] = [
  { value: "lead", label: "Lead time" },
  { value: "cycle", label: "Cycle time" },
];

export function ThroughputCard(props: TabProps) {
  const [opened] = useState(() => new URLSearchParams(window.location.search).get("open"));
  useEffect(() => {
    if (opened === OPEN_FINISHED) {
      return scrollWhenSettled(OPENED_CARDS);
    }
    return undefined;
  }, [opened]);
  return (
    <HoverTimeProvider>
      <Throughput {...props} span={timeSpan(props.flow)} openAll={opened === OPEN_FINISHED} />
    </HoverTimeProvider>
  );
}

export function SpeedCard(props: TabProps) {
  const { flow } = props;
  const { report } = flow;
  const [measure, setMeasure] = useState<"lead" | "cycle">(() =>
    readStored("speed-measure") === "cycle" ? "cycle" : "lead",
  );
  const [view, setView] = useState<SpeedView>(() =>
    readStored("speed-view") === "shape"
      ? "shape"
      : readStored("speed-view") === "cumulative"
        ? "cumulative"
        : "dots",
  );
  const sameCycle =
    report.lead_time.samples.length > 0 && sameSamples(report.lead_time, report.cycle_time);
  const shown = measure === "cycle" && !sameCycle ? report.cycle_time : report.lead_time;
  const took = measure === "cycle" && !sameCycle ? "Cycle time" : "Lead time";
  return (
    <HoverTimeProvider>
      <MetricCard
        title="Speed"
        subtitle={
          measure === "lead"
            ? "Lead time: from creation to Done, one dot per finished card."
            : sameCycle
              ? sameAsLeadNote(flow)
              : "Cycle time: from the first Work status to Done, one dot per finished card."
        }
        actions={
          <div className="card-actions-row">
            <Segmented
              label="Measure"
              options={MEASURES}
              value={measure}
              onChange={(next) => {
                writeStored("speed-measure", next);
                setMeasure(next);
              }}
            />
            <Segmented
              label="View"
              options={SPEED_VIEWS}
              value={view}
              onChange={(next) => {
                writeStored("speed-view", next);
                setView(next);
              }}
            />
          </div>
        }
      >
        {view === "dots" ? (
          <DistributionChart {...props} distribution={shown} took={took} span={timeSpan(flow)} />
        ) : (
          <Histogram {...props} title={took} distribution={shown} took={took} embedded={view} />
        )}
      </MetricCard>
    </HoverTimeProvider>
  );
}

export function OverviewTab(props: TabProps) {
  return (
    <div className="flow-metrics">
      <StatusTimesCard {...props} />
      <ThroughputCard {...props} />
      <SpeedCard {...props} />
    </div>
  );
}

function pairName(flow: FlowResponse, source: number | null, target: number | null): string {
  const name = columnNames(flow);
  return `${source === null ? CREATED : name(source)} → ${
    target === null ? DELETED : name(target)
  }`;
}

type Side = "out" | "in";
type EventSide = Side | "pair" | null;

function eventRows(
  moves: MoveCount[],
  uniqueCards = false,
): { move: MoveCount; event: MoveEvent }[] {
  const rows = moves
    .flatMap((move) => move.events.map((event) => ({ move, event })))
    .sort((a, b) => b.event.happened_at.localeCompare(a.event.happened_at));
  if (!uniqueCards) return rows;
  const seen = new Set<number>();
  return rows.filter(({ event }) => {
    if (seen.has(event.item_id)) return false;
    seen.add(event.item_id);
    return true;
  });
}

function MoveEvents({
  moves,
  side,
  uniqueCards = false,
  ...props
}: TabProps & { moves: MoveCount[]; side: EventSide; uniqueCards?: boolean }) {
  const { flow, slug, itemType, taigaUrl } = props;
  const [sort, onSort] = useSort();
  const order = statusOrder(flow);
  const rows = sortRows(eventRows(moves, uniqueCards), sort, ({ move, event }, key) => {
    switch (key) {
      case "when":
        return event.happened_at;
      case "card":
        return event.ref ?? event.item_id;
      case "status":
        return side === "pair"
          ? order(move.from_status) * 1000 + order(move.to_status)
          : order(side === "out" ? move.to_status : move.from_status);
      case "assigned":
        return peopleText(flow, event.assignees);
      default:
        return event.user_id === null ? null : personName(flow, event.user_id, "");
    }
  });
  const title = (label: string, key: string) => (
    <SortTitle label={label} sortKey={key} sort={sort} onSort={onSort} className="table-sort" />
  );
  return (
    <table className="table table-compact move-events">
      <colgroup>
        <col className="col-when" />
        <col />
        {side && <col className="col-status" />}
        <col className="col-people" />
        <col className="col-by" />
      </colgroup>
      <thead>
        <tr>
          <th>{title("When", "when")}</th>
          <th>{title("Card", "card")}</th>
          {side && (
            <th>{title(side === "out" ? "To" : side === "in" ? "From" : "Change", "status")}</th>
          )}
          <th>{title("Assigned", "assigned")}</th>
          <th>
            {title(
              moves.length > 0 && moves.every((move) => move.from_status === null)
                ? "Created by"
                : "Moved by",
              "user",
            )}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ move, event }) => (
          <tr key={`${event.item_id}-${event.happened_at}-${move.from_status}-${move.to_status}`}>
            <td className="nowrap">{formatDateTime(event.happened_at)}</td>
            <td className="truncate">
              <CardTitle
                slug={slug}
                itemType={itemType}
                itemId={event.item_id}
                cardRef={event.ref}
                subject={event.subject}
                isDeleted={event.is_deleted}
                taigaUrl={taigaUrl}
              />
            </td>
            {side === "pair" && (
              <td className="truncate" title={pairName(flow, move.from_status, move.to_status)}>
                <span className="move-line">
                  <ColumnLabel
                    flow={flow}
                    id={move.from_status}
                    empty={CREATED}
                    to={statusLink(slug, itemType, move.from_status)}
                  />
                  <span className="move-arrow">→</span>
                  <ColumnLabel
                    flow={flow}
                    id={move.to_status}
                    empty={DELETED}
                    to={statusLink(slug, itemType, move.to_status)}
                  />
                </span>
              </td>
            )}
            {(side === "out" || side === "in") && (
              <td className="truncate">
                <ColumnLabel
                  flow={flow}
                  id={side === "out" ? move.to_status : move.from_status}
                  empty={side === "out" ? DELETED : CREATED}
                  to={statusLink(
                    slug,
                    itemType,
                    side === "out" ? move.to_status : move.from_status,
                  )}
                />
              </td>
            )}
            <td className="truncate">
              <PeopleRefs directory={flow} ids={event.assignees} nobody="Unassigned" />
            </td>
            <td className="truncate">
              <PersonRef directory={flow} id={event.user_id} nobody="Unknown" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const NEUTRAL = "#a9aabc";

export function statusColor(flow: FlowResponse, id: number | null, deleted: boolean): string {
  const raw =
    id === null
      ? deleted
        ? "#e44057"
        : NEUTRAL
      : flow.report.columns.find((column) => column.status_id === id)?.color || NEUTRAL;
  return readable(raw, PANEL_BACKGROUND, FALLBACK_MARK);
}

export interface Slice {
  key: string;
  label: ReactNode;
  name: string;
  to?: string;
  color: string;
  count: number;
}

function Donut({
  slices,
  total,
  caption = "moves",
}: {
  slices: Slice[];
  total: number;
  caption?: string;
}) {
  const size = 132;
  const radius = 52;
  const width = 18;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <svg
      className="donut"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={slices.map((slice) => `${slice.name}: ${slice.count}`).join(", ")}
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {slices.map((slice) => {
          const length = (slice.count / total) * circumference;
          const dash = Math.max(length - gap, 0.5);
          const circle = (
            <circle
              key={slice.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={width}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            >
              <title>{`${slice.name}: ${slice.count} (${Math.round(
                (slice.count / total) * 100,
              )}%)`}</title>
            </circle>
          );
          offset += length;
          return circle;
        })}
      </g>
      <text x="50%" y="48%" textAnchor="middle" className="donut-total">
        {formatNumber(total)}
      </text>
      <text x="50%" y="62%" textAnchor="middle" className="donut-caption">
        {caption}
      </text>
    </svg>
  );
}

export function DonutSplit({
  slices,
  total,
  caption,
}: {
  slices: Slice[];
  total: number;
  caption: string;
}) {
  return (
    <div className="status-split">
      <Donut slices={slices} total={total} caption={caption} />
      <ul className="status-split-legend">
        {slices.map((slice) => (
          <li key={slice.key}>
            <span className="split-swatch" style={{ background: slice.color }} />
            <span className="status-split-name">
              {slice.to ? (
                <TextLink
                  to={slice.to}
                  target="_blank"
                  rel="noreferrer"
                  title={`${slice.name}: cards in it now and how long they stay`}
                >
                  {slice.name}
                </TextLink>
              ) : (
                slice.name
              )}
            </span>
            <span className="status-split-count" style={{ color: slice.color }}>
              {formatNumber(slice.count)} · {Math.round((slice.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ListedCard {
  item_id: number;
  ref: number | null;
  subject: string;
  status_id: number | null;
  days: number | null;
  assignees: number[];
  is_deleted?: boolean;
}

export function CardsBreakdown({
  flow,
  slug,
  itemType,
  taigaUrl,
  cards,
  caption,
  timeLabel,
  showSplit = true,
}: {
  flow: FlowResponse;
  slug: string;
  itemType: ItemType;
  taigaUrl: string | null;
  cards: ListedCard[];
  caption: string;
  timeLabel: string;
  showSplit?: boolean;
}) {
  const [sort, onSort] = useSort();
  const names = new Map(flow.report.columns.map((column) => [column.status_id, column.name]));
  const counts = new Map<number | null, number>();
  for (const card of cards) {
    counts.set(card.status_id, (counts.get(card.status_id) ?? 0) + 1);
  }
  const order = new Map(flow.report.columns.map((column, index) => [column.status_id, index]));
  const slices: Slice[] = [...counts.entries()]
    .sort((a, b) => (order.get(a[0] ?? -1) ?? 999) - (order.get(b[0] ?? -1) ?? 999))
    .map(([status, count]) => ({
      key: String(status),
      label: null,
      name: status === null ? "No status" : names.get(status) ?? `Status ${status}`,
      to: statusLink(slug, itemType, status),
      color: statusColor(flow, status, false),
      count,
    }));
  const rows = sortRows(
    [...cards].sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    sort,
    (card, key) =>
      key === "card"
        ? card.ref ?? card.item_id
        : key === "status"
          ? card.status_id
          : key === "assigned"
            ? peopleText(flow, card.assignees)
            : card.days,
  );
  const title = (label: string, key: string) => (
    <SortTitle label={label} sortKey={key} sort={sort} onSort={onSort} className="table-sort" />
  );
  if (cards.length === 0) {
    return <Empty>No cards.</Empty>;
  }
  return (
    <div className="cards-breakdown">
      {showSplit && <DonutSplit slices={slices} total={cards.length} caption={caption} />}
      <table className="table cards-breakdown-table">
        <thead>
          <tr>
            <th>{title("Card", "card")}</th>
            <th>{title("Status", "status")}</th>
            <th className="num">{title(timeLabel, "time")}</th>
            <th>{title("Assigned", "assigned")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((card) => (
            <tr key={card.item_id}>
              <td>
                <CardTitle
                  slug={slug}
                  itemType={itemType}
                  itemId={card.item_id}
                  cardRef={card.ref}
                  subject={card.subject}
                  isDeleted={card.is_deleted ?? false}
                  taigaUrl={taigaUrl}
                />
              </td>
              <td>
                {card.status_id === null ? (
                  <span className="muted-inline">-</span>
                ) : (
                  <ColumnLabel
                    flow={flow}
                    id={card.status_id}
                    empty="-"
                    to={columnPath(slug, itemType, card.status_id)}
                  />
                )}
              </td>
              <td className="num">{formatDuration(card.days)}</td>
              <td>
                <PeopleRefs directory={flow} ids={card.assignees} nobody="Unassigned" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusLink(slug: string, itemType: ItemType, id: number | null): string | undefined {
  return id === null ? undefined : columnPath(slug, itemType, id);
}

function Split({
  moves,
  side,
  flow,
  slug,
  itemType,
}: {
  moves: MoveCount[];
  side: Side;
  flow: FlowResponse;
  slug: string;
  itemType: ItemType;
}) {
  const counts = new Map<string, { id: number | null; count: number; move: MoveCount }>();
  for (const move of moves) {
    const id = side === "out" ? move.to_status : move.from_status;
    const key = String(id);
    const current = counts.get(key);
    counts.set(key, { id, count: (current?.count ?? 0) + move.count, move });
  }
  const total = moves.reduce((sum, move) => sum + move.count, 0);
  const empty = side === "out" ? DELETED : CREATED;
  const name = columnNames(flow);
  const slices: Slice[] = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, value]) => ({
      key,
      label: null,
      to: statusLink(slug, itemType, value.id),
      name: value.id === null ? empty : name(value.id),
      color: statusColor(flow, value.id, side === "out"),
      count: value.count,
    }));
  return <DonutSplit slices={slices} total={total} caption="moves" />;
}

function MovesPanel({
  title,
  moves,
  side,
  ...props
}: TabProps & { title: ReactNode; moves: MoveCount[]; side: Side | null }) {
  const total = moves.reduce((sum, move) => sum + move.count, 0);
  return (
    <div className="moves-panel">
      <div className="moves-panel-head">
        <span className="moves-panel-title">
          {title}: {plural(total, "move", "moves")}
        </span>
      </div>
      {side && (
        <Split
          moves={moves}
          side={side}
          flow={props.flow}
          slug={props.slug}
          itemType={props.itemType}
        />
      )}
      <MoveEvents {...props} moves={moves} side={side} />
    </div>
  );
}

type Open =
  | { kind: "cell"; source: number | null; target: number | null }
  | { kind: "out"; source: number | null }
  | { kind: "in"; target: number | null }
  | { kind: "all" }
  | null;

function sameOpen(a: Open, b: Open): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type MoveMeasure = "cards" | "moves";

const MOVE_MEASURES: { value: MoveMeasure; label: string }[] = [
  { value: "cards", label: "Cards" },
  { value: "moves", label: "Moves" },
];

function MoveMatrix({ measure, ...props }: TabProps & { measure: MoveMeasure }) {
  const { flow, slug, itemType } = props;
  const { columns, moves } = flow.report;
  const [open, setOpen] = useState<Open>(null);
  const announceOpen = useExclusiveMetricList(() => setOpen(null));
  const scroller = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => setVisible(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const toggle = (next: Open) => {
    if (!sameOpen(open, next)) announceOpen();
    setOpen((current) => (sameOpen(current, next) ? null : next));
  };
  const count = new Map(moves.map((move) => [`${move.from_status}:${move.to_status}`, move]));
  const position = new Map(columns.map((column, index) => [column.status_id, index]));
  const deleted = moves.some((move) => move.to_status === null);
  const known = new Set(columns.map((c) => c.status_id));
  const others = [
    ...new Set(
      moves
        .flatMap((move) => [move.from_status, move.to_status])
        .filter((id): id is number => id !== null && !known.has(id)),
    ),
  ];
  const statuses = [...columns.map((c) => c.status_id), ...others];
  const sources: (number | null)[] = [null, ...statuses];
  const targets: (number | null)[] = [...statuses, ...(deleted ? [null] : [])];
  const emptyTargets = new Set(
    targets.filter((target) => !moves.some((move) => move.to_status === target)),
  );
  const from = (source: number | null) => moves.filter((move) => move.from_status === source);
  const into = (target: number | null) => moves.filter((move) => move.to_status === target);
  const sum = (list: MoveCount[]) => list.reduce((total, move) => total + move.count, 0);
  const shown = (list: MoveCount[]) =>
    measure === "moves" ? sum(list) : eventRows(list, true).length;
  const isBack = (source: number | null, target: number | null) =>
    source !== null &&
    target !== null &&
    (position.get(target) ?? 0) < (position.get(source) ?? 0);
  const name = columnNames(flow);
  const span = targets.length + 2;

  const listRow = (list: MoveCount[], side: EventSide, glued = false) => (
    <tr className="history-row">
      <td colSpan={span} className={`matrix-panel-cell${glued ? " glued" : ""}`}>
        <div
          className="matrix-panel"
          style={visible ? { width: `calc(${visible}px - 2.2rem)` } : undefined}
        >
          <MoveEvents {...props} moves={list} side={side} uniqueCards={measure === "cards"} />
        </div>
      </td>
    </tr>
  );

  const splitRow = (
    list: MoveCount[],
    by: "target" | "source" = "target",
    showCreators = false,
  ) => {
    const rows = eventRows(list, measure === "cards");
    const total = rows.length;
    const byStatus = new Map<string, number>();
    for (const { move } of rows) {
      const key = String(by === "target" ? move.to_status : move.from_status);
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }
    const slices: Slice[] = (by === "target" ? targets : sources).flatMap((status) => {
      const value = byStatus.get(String(status));
      return value
        ? [
            {
              key: String(status),
              label: null,
              name: status === null ? (by === "target" ? DELETED : CREATED) : name(status),
              to: statusLink(slug, itemType, status),
              color: statusColor(flow, status, by === "target"),
              count: value,
            },
          ]
        : [];
    });
    return (
      <tr className="history-row donut-row">
        <td colSpan={span}>
          {showCreators ? (
            <div className="matrix-splits">
              <div>
                <h4>By status</h4>
                <DonutSplit slices={slices} total={total} caption={measure} />
              </div>
              <div>
                <h4>By creator</h4>
                {creatorSplit(list)}
              </div>
            </div>
          ) : (
            <DonutSplit slices={slices} total={total} caption={measure} />
          )}
        </td>
      </tr>
    );
  };

  const creatorSplit = (list: MoveCount[]) => {
    const createdCards = eventRows(list, true);
    const creators = new Map<number | null, number>();
    for (const { event } of createdCards) {
      creators.set(event.user_id, (creators.get(event.user_id) ?? 0) + 1);
    }
    const colors = [
      "#006b8f",
      "#a74b3f",
      "#6861a6",
      "#3d8054",
      "#a05d1d",
      "#9b4779",
      "#467780",
      "#706b31",
    ];
    const slices: Slice[] = [...creators.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] ?? -1) - (b[0] ?? -1))
      .map(([id, count], index) => ({
        key: String(id),
        label: null,
        name: personName(flow, id, "Unknown"),
        color: id === null ? NEUTRAL : colors[index % colors.length] ?? NEUTRAL,
        count,
      }));
    return <DonutSplit slices={slices} total={createdCards.length} caption="cards" />;
  };

  const creatorRow = (list: MoveCount[]) => (
    <tr className="history-row donut-row">
      <td colSpan={span}>
        <h4>By creator</h4>
        {creatorSplit(list)}
      </td>
    </tr>
  );

  return (
    <div className="matrix-scroll" ref={scroller}>
      <table className="table move-matrix">
        <thead>
          <tr>
            <th className="matrix-corner">From \ To</th>
            {targets.map((target) => (
              <th
                key={String(target)}
                className={`num matrix-target${emptyTargets.has(target) ? " no-moves" : ""}`}
              >
                <span className="matrix-head-label vertical-status-label">
                  <ColumnLabel
                    flow={flow}
                    id={target}
                    empty={DELETED}
                    to={target === null ? undefined : columnPath(slug, itemType, target)}
                  />
                </span>
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => {
            const outgoing = from(source);
            const total = sum(outgoing);
            const rowOpen = open?.kind === "out" && open.source === source;
            const cellOpen = open?.kind === "cell" && open.source === source ? open : null;
            const cellMove = cellOpen ? count.get(`${source}:${cellOpen.target}`) : undefined;
            return (
              <Fragment key={String(source)}>
                <tr
                  className={`${total > 0 ? "clickable" : ""}${rowOpen ? " selected" : ""}`}
                  onClick={() => total > 0 && toggle({ kind: "out", source })}
                  title={
                    total > 0
                      ? `Click for the split of where cards went from ${
                          source === null ? CREATED : name(source)
                        }`
                      : undefined
                  }
                >
                  <th scope="row">
                    {source === null ? (
                      <span className="muted-inline">{CREATED}</span>
                    ) : (
                      <ColumnLabel
                        flow={flow}
                        id={source}
                        empty={CREATED}
                        to={columnPath(slug, itemType, source)}
                      />
                    )}
                  </th>
                  {targets.map((target) => {
                    const move = count.get(`${source}:${target}`);
                    const isOpen = cellOpen?.target === target;
                    return (
                      <td
                        key={String(target)}
                        className={`num${emptyTargets.has(target) ? " no-moves" : ""}${
                          move && isBack(source, target) ? " back-cell" : ""
                        }${move ? " matrix-cell" : ""}${isOpen ? " open" : ""}`}
                        title={
                          move
                            ? `${pairName(flow, source, target)}: ${plural(
                                move.cards,
                                "card",
                                "cards",
                              )}, ${plural(move.count, "move", "moves")}. Click to see them.`
                            : undefined
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          if (move) {
                            toggle({ kind: "cell", source, target });
                          }
                        }}
                      >
                        {move ? (
                          <span className="matrix-number">
                            {formatNumber(measure === "moves" ? move.count : move.cards)}
                          </span>
                        ) : (
                          <span className="matrix-empty">{source === target ? "-" : "0"}</span>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className={`num matrix-total${total > 0 ? " matrix-cell" : ""}${
                      rowOpen ? " open" : ""
                    }`}
                  >
                    {total > 0 ? (
                      <button
                        type="button"
                        className="count-open"
                        aria-expanded={rowOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle({ kind: "out", source });
                        }}
                      >
                        <span className="matrix-number">{formatNumber(shown(outgoing))}</span>
                      </button>
                    ) : (
                      "0"
                    )}
                  </td>
                </tr>
                {source === null && cellMove && creatorRow([cellMove])}
                {cellMove && listRow([cellMove], null)}
                {rowOpen && splitRow(outgoing, "target", source === null)}
                {rowOpen && listRow(outgoing, "out", true)}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="matrix-total-row">
            <th scope="row">Total</th>
            {targets.map((target) => {
              const total = sum(into(target));
              const isOpen = open?.kind === "in" && open.target === target;
              return (
                <td
                  key={String(target)}
                  className={`num matrix-total${total > 0 ? " matrix-cell" : " no-moves"}${
                    isOpen ? " open" : ""
                  }`}
                  title={
                    total > 0
                      ? `Click to see every ${measure === "cards" ? "card" : "move"} into ${
                          target === null ? DELETED : name(target)
                        }`
                      : undefined
                  }
                >
                  {total > 0 ? (
                    <button
                      type="button"
                      className="count-open"
                      aria-expanded={isOpen}
                      onClick={() => toggle({ kind: "in", target })}
                    >
                      <span className="matrix-number">{formatNumber(shown(into(target)))}</span>
                    </button>
                  ) : (
                    "0"
                  )}
                </td>
              );
            })}
            <td
              className={`num matrix-total${moves.length > 0 ? " matrix-cell" : ""}${
                open?.kind === "all" ? " open" : ""
              }`}
              title={
                moves.length > 0
                  ? `Click to see every ${measure === "cards" ? "card" : "move"}`
                  : undefined
              }
            >
              {moves.length > 0 ? (
                <button
                  type="button"
                  className="count-open"
                  aria-expanded={open?.kind === "all"}
                  onClick={() => toggle({ kind: "all" })}
                >
                  <span className="matrix-number">{formatNumber(shown(moves))}</span>
                </button>
              ) : (
                <span className="matrix-number">0</span>
              )}
            </td>
          </tr>
          {open?.kind === "in" && splitRow(into(open.target), "source")}
          {open?.kind === "in" && listRow(into(open.target), "in", true)}
          {open?.kind === "all" && splitRow(moves)}
          {open?.kind === "all" && listRow(moves, "pair", true)}
        </tfoot>
      </table>
    </div>
  );
}

export function StatusMoves({ column, ...props }: TabProps & { column: number }) {
  const { flow } = props;
  const name = columnNames(flow)(column);
  const outgoing = flow.report.moves.filter((move) => move.from_status === column);
  const incoming = flow.report.moves.filter((move) => move.to_status === column);
  return (
    <MetricCard
      title="Moves"
      subtitle="Where cards went from this status and where they came from"
    >
      <div className="pair-tables">
        {outgoing.length > 0 ? (
          <MovesPanel
            {...props}
            title={
              <>
                {name} <span className="move-arrow">→</span>
              </>
            }
            moves={outgoing}
            side="out"
          />
        ) : (
          <Empty>No card left this status in the period.</Empty>
        )}
        {incoming.length > 0 ? (
          <MovesPanel
            {...props}
            title={
              <>
                <span className="move-arrow">→</span> {name}
              </>
            }
            moves={incoming}
            side="in"
          />
        ) : (
          <Empty>No card came into this status in the period.</Empty>
        )}
      </div>
    </MetricCard>
  );
}

export function MovesTab(props: TabProps) {
  const { report } = props.flow;
  const [measure, setMeasure] = useState<MoveMeasure>(() =>
    readStored("moves-measure") === "moves" ? "moves" : "cards",
  );
  return (
    <div className="flow-metrics">
      <MetricCard
        title="Status to status"
        actions={
          <Segmented
            label="Count"
            options={MOVE_MEASURES}
            value={measure}
            onChange={(next) => {
              writeStored("moves-measure", next);
              setMeasure(next);
            }}
          />
        }
        subtitle={
          <>
            How many cards (or moves: a card can go the same way more than once) went from each
            status (rows) to each other one (columns). <span className="back-sample">Red</span>{" "}
            numbers are moves back to an earlier status in Taiga's order. Click a number for the
            cards behind it, a row or its total for the split of where cards went from that status,
            a column total for the cards that came in, and the grand total for every{" "}
            {measure === "cards" ? "card" : "move"}.
          </>
        }
      >
        {report.moves.length === 0 && <Empty>No card changed status in this period.</Empty>}
        <MoveMatrix {...props} measure={measure} />
      </MetricCard>
    </div>
  );
}
