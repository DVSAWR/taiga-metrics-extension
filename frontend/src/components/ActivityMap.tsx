import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { ActivityKind } from "../api";
import { formatNumber } from "../format";

export const KIND_LABELS: Record<ActivityKind, string> = {
  create: "Created",
  move: "Moved",
  assign: "Changed assignees",
  comment: "Commented",
  edit: "Edited",
  delete: "Deleted",
};
export const ACTIVITY_KINDS: ActivityKind[] = [
  "create",
  "move",
  "assign",
  "comment",
  "edit",
  "delete",
];

export interface ActivityCounts {
  day: string;
  counts: Partial<Record<ActivityKind, number>>;
}

const HEATMAP_WEEKS = 53;
const DAY_MS = 86_400_000;
const CELL_GAP = 4;
const LABEL_WIDTH = 32;
const LABEL_GAP = 6;
const EDGE_PADDING = 8;
const LEVELS = [0, 1, 2, 3, 4];
const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return isoDay(new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS));
}

export function today(): string {
  return isoDay(new Date());
}

function mapDays(from: string | null, to: string | null): string[] {
  const end = to ? new Date(`${to}T00:00:00Z`) : new Date(`${isoDay(new Date())}T00:00:00Z`);
  const start = from
    ? new Date(`${from}T00:00:00Z`)
    : new Date(end.getTime() - (HEATMAP_WEEKS * 7 - 1) * DAY_MS);
  const monday = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY_MS);
  const days: string[] = [];
  for (let day = monday; day <= end; day = new Date(day.getTime() + DAY_MS)) {
    days.push(isoDay(day));
  }
  return days;
}

export function totalOf(counts: Partial<Record<ActivityKind, number>>, kind: ActivityKind | null) {
  if (kind !== null) {
    return counts[kind] ?? 0;
  }
  return Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
}

function monthLabels(days: string[]): { week: number; label: string }[] {
  const labels: { week: number; label: string }[] = [];
  let last = -1;
  days.forEach((day, index) => {
    const month = Number(day.slice(5, 7)) - 1;
    if (index % 7 === 0 && month !== last) {
      labels.push({ week: index / 7, label: MONTHS[month] ?? "" });
      last = month;
    }
  });
  const [first, second] = labels;
  if (first && second && second.week - first.week < 3) {
    labels.shift();
  }
  return labels;
}

export function ActivityMap({
  days,
  kind,
  from,
  to,
  selected,
  onSelect,
  start = from,
  end = to,
}: {
  days: ActivityCounts[];
  kind: ActivityKind | null;
  from: string | null;
  to: string | null;
  start?: string | null;
  end?: string | null;
  selected: string | null;
  onSelect: (day: string | null) => void;
}) {
  const counts = new Map(days.map((day) => [day.day, totalOf(day.counts, kind)]));
  const shown = mapDays(start, end);
  const weeks = Math.ceil(shown.length / 7);
  const scroller = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(18);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const resize = () => {
      const available =
        element.clientWidth - EDGE_PADDING - LABEL_WIDTH - LABEL_GAP - (weeks - 1) * CELL_GAP;
      setCellSize(Math.max(10, Math.min(18, Math.floor(available / weeks))));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [weeks]);
  const highest = Math.max(1, ...counts.values());
  const hasSelectedPeriod = from !== null || to !== null;
  const inRange = (day: string) => (!from || day >= from) && (!to || day <= to);
  const levelOf = (count: number) =>
    count === 0 ? 0 : Math.max(1, Math.ceil((Math.log1p(count) / Math.log1p(highest)) * 4));
  return (
    <div className="activity-map">
      <div className="activity-map-scroll" ref={scroller}>
        <div
          className="activity-map-content"
          style={{ "--activity-cell": `${cellSize}px` } as CSSProperties}
        >
          <div className="activity-map-grid" style={{ "--weeks": weeks } as CSSProperties}>
            <div className="activity-map-months">
              {monthLabels(shown).map((month) => (
                <span
                  key={`${month.week}-${month.label}`}
                  style={{ gridColumn: month.week + 1 } as CSSProperties}
                >
                  {month.label}
                </span>
              ))}
            </div>
            <div className="activity-map-weekdays">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index}>{label}</span>
              ))}
            </div>
            <div className="heatmap">
              {shown.map((day) => {
                const count = counts.get(day) ?? 0;
                return (
                  <button
                    key={day}
                    type="button"
                    className={`heatmap-day level-${levelOf(count)}${
                      selected === day ? " selected" : ""
                    }${hasSelectedPeriod && inRange(day) ? " in-range" : ""}`}
                    title={`${day}: ${formatNumber(count)} ${count === 1 ? "action" : "actions"}`}
                    onClick={() => onSelect(selected === day ? null : day)}
                  />
                );
              })}
            </div>
          </div>
          <div className="activity-map-legend">
            <span>Less</span>
            {LEVELS.map((level) => (
              <span key={level} className={`heatmap-day level-${level}`} />
            ))}
            <span>More</span>
            {hasSelectedPeriod && (
              <span className="activity-period-legend">
                <span className="activity-period-swatch" />
                Selected period
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
