import { useState } from "react";

import {
  axisDayLabel,
  Crosshair,
  dayTicks,
  minorTicks,
  TIME_PADDING,
  trendColor,
  TREND_FLAT,
  YTicks,
} from "./timeAxis";
import { formatAdaptive } from "./format";
import { useWidth } from "./useWidth";

export interface TotalPoint {
  label: string;
  current: boolean;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  cards: number;
  measured: number;
  slow: number;
  fast: number;
}

const PADDING = TIME_PADDING;
const MAIN = 240;
const INSET = 8;
const MIN_LABEL_WIDTH = 64;
const NEUTRAL_BAND = "#008aa8";
const NEUTRAL_OPACITY = 0.12;
const UPPER_OPACITY = 0.26;
const LOWER_OPACITY = 0.14;

export type TotalPart = "p25" | "p50" | "p75";

const PART_HIT = 10;

function edgeCount(point: TotalPoint, edge: "p25" | "p75"): string {
  const count = edge === "p75" ? point.slow : point.fast;
  return `${count} of ${point.measured} ${point.measured === 1 ? "card" : "cards"}`;
}

export function TotalChart({
  points,
  few,
  onPick,
}: {
  points: TotalPoint[];
  few: number;
  onPick: (index: number, part: TotalPart) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [part, setPart] = useState<TotalPart | null>(null);
  const [container, width] = useWidth<HTMLDivElement>();
  const plotWidth = width - PADDING.left - PADDING.right;
  const band = points.length > 0 ? plotWidth / points.length : plotWidth;
  const bottom = PADDING.top + MAIN;
  const height = bottom + PADDING.bottom;
  const axis = dayTicks(Math.max(1e-9, ...points.map((point) => point.p75 ?? 0)));
  const top = axis[axis.length - 1] ?? 1;
  const x = (index: number) => PADDING.left + band * (index + 0.5);
  const y = (value: number) => bottom - INSET - (value / top) * (MAIN - INSET);
  const every = Math.max(1, Math.ceil(MIN_LABEL_WIDTH / Math.max(1, band)));
  const known = points.flatMap((point, index) => (point.p50 === null ? [] : [index]));
  const reliable = (index: number) => (points[index]?.measured ?? 0) >= few;
  const done = known.filter((index) => !points[index]?.current && reliable(index));
  const halves = done.slice(1).flatMap((index, at) => {
    const from = done[at] ?? index;
    if (index !== from + 1) return [];
    const start = points[from];
    const end = points[index];
    if (!start || !end || start.p50 === null || end.p50 === null) {
      return [];
    }
    const quad = (edge: "p25" | "p75") =>
      [
        `${x(from)},${y(start.p50 ?? 0)}`,
        `${x(index)},${y(end.p50 ?? 0)}`,
        `${x(index)},${y(end[edge] ?? 0)}`,
        `${x(from)},${y(start[edge] ?? 0)}`,
      ].join(" ");
    const tone = (edge: "p25" | "p75", strength: number) => {
      const color = trendColor(start[edge] ?? 0, end[edge] ?? 0, false);
      return color === TREND_FLAT
        ? { fill: NEUTRAL_BAND, opacity: NEUTRAL_OPACITY }
        : { fill: color, opacity: strength };
    };
    return [
      { key: `upper-${from}`, points: quad("p75"), ...tone("p75", UPPER_OPACITY) },
      { key: `lower-${from}`, points: quad("p25"), ...tone("p25", LOWER_OPACITY) },
    ];
  });
  const segments = known.slice(1).flatMap((index, at) => {
    const from = known[at] ?? index;
    if (index !== from + 1 || !reliable(index) || !reliable(from)) {
      return [];
    }
    const start = points[from]?.p50 ?? 0;
    const end = points[index]?.p50 ?? 0;
    return [
      {
        key: `${from}-${index}`,
        from,
        to: index,
        color: trendColor(start, end, false),
        going: Boolean(points[index]?.current),
      },
    ];
  });
  const hovered = active === null ? null : points[active] ?? null;

  return (
    <div
      className="line-chart"
      ref={container}
      style={{ minWidth: points.length * 86 + PADDING.left + PADDING.right }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {axis.map((value) => (
          <g key={value}>
            <line
              className="chart-grid"
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={y(value)}
              y2={y(value)}
            />
            <text className="chart-tick" x={PADDING.left - 8} y={y(value) + 3} textAnchor="end">
              {axisDayLabel(value, axis)}
            </text>
          </g>
        ))}
        <YTicks
          axis={axis}
          minor={minorTicks(axis)}
          y={y}
          left={PADDING.left}
          top={PADDING.top}
          bottom={bottom}
        />
        {points.map(
          (point, index) =>
            (point.p50 === null || point.measured < few) && (
              <g key={`empty-${index}`}>
                <rect
                  className="total-no-data"
                  x={x(index) - band / 2 + 1}
                  y={PADDING.top}
                  width={Math.max(0, band - 2)}
                  height={MAIN}
                />
                <text
                  className="total-no-data-label"
                  x={x(index)}
                  y={bottom - 12}
                  textAnchor="middle"
                >
                  {point.p50 === null ? "no data" : "few cards"}
                </text>
              </g>
            ),
        )}
        {points.map((point, index) =>
          index % every === 0 ? (
            <g key={`label-${index}`}>
              <line
                className="sprint-boundary"
                x1={x(index)}
                x2={x(index)}
                y1={PADDING.top}
                y2={bottom + 6}
              />
              <text
                className={
                  point.p50 === null || point.measured < few
                    ? "chart-tick total-empty-tick"
                    : "chart-tick"
                }
                x={x(index)}
                y={height - PADDING.bottom + 18}
                textAnchor="middle"
              >
                {point.label.length > 13 ? `${point.label.slice(0, 12)}…` : point.label}
                <title>{point.label}</title>
              </text>
            </g>
          ) : null,
        )}
        <line
          className="chart-axis"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={bottom}
          y2={bottom}
        />
        {halves.map((half) => (
          <polygon
            key={half.key}
            className="total-half"
            points={half.points}
            fill={half.fill}
            fillOpacity={half.opacity}
          />
        ))}
        {segments.map((segment) => (
          <line
            key={segment.key}
            className="total-segment"
            x1={x(segment.from)}
            y1={y(points[segment.from]?.p50 ?? 0)}
            x2={x(segment.to)}
            y2={y(points[segment.to]?.p50 ?? 0)}
            stroke={segment.color}
            strokeDasharray={segment.going ? "5 4" : undefined}
          />
        ))}
        {known.map((index) => {
          const point = points[index];
          return point && point.p50 !== null ? (
            <g key={index}>
              <circle
                className={`total-point${point.current ? " going" : ""}${
                  !reliable(index) ? " weak" : ""
                }`}
                cx={x(index)}
                cy={y(point.p50)}
                r={4.5}
              />
              <text className="total-cards" x={x(index)} y={y(point.p50) + 17} textAnchor="middle">
                {point.cards}
              </text>
              {point.current && (
                <text
                  className="total-going"
                  x={x(index)}
                  y={y(point.p50) - 10}
                  textAnchor="middle"
                >
                  going
                </text>
              )}
            </g>
          ) : null;
        })}
        {hovered && active !== null && hovered.p50 !== null && (
          <g className="total-edges">
            {(["p25", "p50", "p75"] as const).map((edge) => {
              const value = hovered[edge];
              if (value === null) {
                return null;
              }
              const flip = x(active) <= width / 2;
              return (
                <g key={edge}>
                  <circle
                    className={`total-edge${part === edge ? " hot" : ""}`}
                    cx={x(active)}
                    cy={y(value)}
                    r={part === edge ? 6 : 4}
                  />
                  {edge !== "p50" && (
                    <text
                      className={`total-edge-count${part === edge ? " hot" : ""}`}
                      x={x(active) + (flip ? -10 : 10)}
                      y={y(value) + (edge === "p75" ? -4 : 12)}
                      textAnchor={flip ? "end" : "start"}
                    >
                      {edgeCount(hovered, edge)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}
        {hovered && active !== null && hovered.p50 !== null && (
          <Crosshair
            x={x(active)}
            y={y(hovered.p50)}
            left={PADDING.left}
            right={width - PADDING.right}
            top={PADDING.top}
            bottom={bottom}
            vertical
          />
        )}
        <rect
          className={`chart-hit${part ? " chart-hit-pointer" : ""}`}
          x={PADDING.left}
          y={PADDING.top}
          width={plotWidth}
          height={MAIN}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const index = Math.max(
              0,
              Math.min(points.length - 1, Math.floor((event.clientX - box.left) / band)),
            );
            const py = event.clientY - box.top + PADDING.top;
            const point = points[index];
            const near = (["p75", "p50", "p25"] as const)
              .map((edge) => ({ edge, value: point?.[edge] ?? null }))
              .filter((item): item is { edge: TotalPart; value: number } => item.value !== null)
              .map((item) => ({ edge: item.edge, gap: Math.abs(y(item.value) - py) }))
              .sort((a, b) => a.gap - b.gap)[0];
            setActive(index);
            setPart(near && near.gap <= PART_HIT ? near.edge : null);
          }}
          onPointerLeave={() => {
            setActive(null);
            setPart(null);
          }}
          onClick={() => active !== null && part && onPick(active, part)}
        />
      </svg>
      {hovered && active !== null && (
        <div
          className="chart-tooltip line-tooltip"
          style={
            x(active) > width / 2
              ? { right: width - x(active) + 12, top: 20 }
              : { left: x(active) + 12, top: 20 }
          }
        >
          <strong>
            {hovered.label}
            {hovered.current ? ", going" : ""}
          </strong>
          {hovered.p50 === null ? (
            <span>{hovered.cards > 0 ? "No time measurement available" : "No card finished"}</span>
          ) : (
            <>
              {hovered.measured < few && (
                <span>
                  Too few cards to compare reliably ({hovered.measured} of {few})
                </span>
              )}
              <span>Median {formatAdaptive(hovered.p50)}</span>
              <span>
                Middle half {formatAdaptive(hovered.p25)} to {formatAdaptive(hovered.p75)}
              </span>
              <span>
                Slow quarter: {edgeCount(hovered, "p75")}, {formatAdaptive(hovered.p75)} or more
              </span>
              <span>
                Fast quarter: {edgeCount(hovered, "p25")}, {formatAdaptive(hovered.p25)} or less
              </span>
            </>
          )}
          <span>
            {hovered.cards} {hovered.cards === 1 ? "card" : "cards"} finished
          </span>
          <span className="muted-inline">
            {part === "p75"
              ? "Click for the slowest quarter"
              : part === "p25"
                ? "Click for the fastest quarter"
                : part === "p50"
                  ? "Click for every card finished"
                  : "Point at a dot to list its cards"}
          </span>
        </div>
      )}
    </div>
  );
}
