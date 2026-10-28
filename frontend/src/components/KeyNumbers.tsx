import type { ReactNode } from "react";

import type { SubjectKind, Tiles } from "../api";
import type { CountKind } from "../cardLists";
import { formatDuration } from "../charts/format";
import { firstTime, formatNumber } from "../format";
import { MetricPopup } from "./MetricPopup";

export interface KeyNumbersItem {
  label: string;
  color: string;
  kind: SubjectKind;
  tiles: Tiles;
}

interface Metric {
  count?: CountKind;
  label: (kind: SubjectKind) => string;
  hint: string;
  value: (tiles: Tiles, kind: SubjectKind) => string;
  raw: (tiles: Tiles, kind: SubjectKind) => number | null;
  detail?: (tiles: Tiles, kind: SubjectKind) => string | null;
}

const METRICS: Metric[] = [
  {
    count: "in_progress",
    label: () => "In progress",
    hint: "Unfinished cards in Work statuses now; for a role, cards in its statuses now",
    value: (tiles) => formatNumber(tiles.in_progress),
    raw: (tiles) => tiles.in_progress,
  },
  {
    count: "stuck",
    label: () => "Stuck",
    hint: "Unfinished cards in a Work status longer than 85% of the past stays there",
    value: (tiles) => formatNumber(tiles.stuck),
    raw: (tiles) => tiles.stuck,
  },
  {
    count: "finished",
    label: (kind) => (kind === "role" ? "Passed through" : "Finished"),
    hint: "Cards that reached Done in the period; for a role, cards that left its statuses",
    value: (tiles) => formatNumber(tiles.finished),
    raw: (tiles) => tiles.finished,
  },
  {
    label: (kind) => (kind === "role" ? "Time in its statuses" : "Lead time"),
    hint: "Median from creation to Done; for a role, median of a stay in its statuses",
    value: (tiles) => formatDuration(tiles.lead_p50),
    raw: (tiles) => tiles.lead_p50,
    detail: (tiles) =>
      tiles.lead_p85 === null ? null : `85% within ${formatDuration(tiles.lead_p85)}`,
  },
  {
    label: () => "Cycle time",
    hint: "Median from the first Work status to Done",
    value: (tiles, kind) => (kind === "role" ? "-" : formatDuration(tiles.cycle_p50)),
    raw: (tiles, kind) => (kind === "role" ? null : tiles.cycle_p50),
    detail: (tiles, kind) =>
      kind === "role" || tiles.cycle_p85 === null
        ? null
        : `85% within ${formatDuration(tiles.cycle_p85)}`,
  },
  {
    count: "first_time",
    label: () => "First time",
    hint: "Clean first passes of statuses: one card can have a first pass in several statuses",
    value: (tiles) => formatNumber(tiles.clean_passes),
    raw: (tiles) => tiles.clean_passes,
    detail: (tiles) =>
      tiles.passes > 0
        ? `${firstTime(tiles.passes, tiles.clean_passes)} of ${formatNumber(
            tiles.passes,
          )} first passes`
        : null,
  },
  {
    count: "returns",
    label: (kind) => (kind === "person" ? "Returns credited" : "Return events"),
    hint: "Moves classified as returns in the period; a REWORK case can contain two events. Personal numbers follow the project's attribution rule.",
    value: (tiles) => formatNumber(tiles.returns),
    raw: (tiles) => tiles.returns,
    detail: (tiles) => `${formatNumber(tiles.returned_cards)} returned cards`,
  },
  {
    count: "repeat_returns",
    label: () => "Repeat returns",
    hint: "Return events after each card's first return within the selected period and subject. One card returned three times contributes two repeat returns.",
    value: (tiles) => formatNumber(tiles.repeat_returns),
    raw: (tiles) => tiles.repeat_returns,
    detail: (tiles) => `${formatNumber(tiles.repeated_cards)} cards returned more than once`,
  },
  {
    label: () => "Repeat return rate",
    hint: "Cards with two or more returns divided by all returned cards within the selected period and subject.",
    value: (tiles) =>
      tiles.repeat_rate === null ? "-" : `${Math.round(tiles.repeat_rate * 100)}%`,
    raw: (tiles) => tiles.repeat_rate,
  },
];

/** How a value relates to the first subject's, as a signed percentage. */
export function ratioText(value: number | null, base: number | null): string | null {
  if (value === null || base === null) {
    return null;
  }
  if (base === 0) {
    return value === 0 ? "same" : "new";
  }
  const change = Math.round((value / base - 1) * 100);
  return change === 0 ? "same" : `${change > 0 ? "+" : ""}${change}%`;
}

function Value({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="key-number-value">
      {color && <span className="key-number-swatch" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function KeyNumbers({
  items,
  expand,
}: {
  items: KeyNumbersItem[];
  expand?: (count: CountKind, index: number) => ReactNode;
}) {
  const compare = items.length > 1;
  const first = items[0];
  if (!first) {
    return null;
  }
  return (
    <section className={`card key-numbers${compare ? " key-numbers-compare" : ""}`}>
      {METRICS.map((metric) => {
        const raws = items.map((item) => metric.raw(item.tiles, item.kind));
        return (
          <div key={metric.hint} className="key-number" title={metric.hint}>
            <span className="key-number-label">{metric.label(first.kind)}</span>
            {items.map((item, index) => (
              <span key={item.label} className="key-number-line">
                {expand && metric.count ? (
                  <MetricPopup
                    label={`Show ${metric.label(item.kind)} cards`}
                    className="key-number-open"
                    content={() => expand(metric.count!, index)}
                  >
                    <Value color={compare ? item.color : undefined}>
                      {metric.value(item.tiles, item.kind)}
                    </Value>
                  </MetricPopup>
                ) : (
                  <Value color={compare ? item.color : undefined}>
                    {metric.value(item.tiles, item.kind)}
                  </Value>
                )}
                {!compare && metric.detail?.(item.tiles, item.kind) && (
                  <span className="key-number-detail">{metric.detail(item.tiles, item.kind)}</span>
                )}
                {compare && index > 0 && (
                  <span className="key-number-detail">
                    {ratioText(raws[index] ?? null, raws[0] ?? null) ?? ""}
                    {ratioText(raws[index] ?? null, raws[0] ?? null) ? " vs the first" : ""}
                  </span>
                )}
              </span>
            ))}
          </div>
        );
      })}
    </section>
  );
}
