import { useState } from "react";

import { ChartLegend, type LegendItem } from "./ChartLegend";
import {
  axisDayLabel,
  dayMarks,
  Crosshair,
  CrosshairTip,
  dayTicks,
  HIGHLIGHT,
  shortDays,
  TIME_PADDING,
} from "./timeAxis";
import { useWidth } from "./useWidth";

export interface Dot {
  key: string;
  value: number;
  title: string;
  lines: string[];
  color?: string;
}

export interface DotMarker {
  name: string;
  color: string;
  value: number;
  label: string;
  dashed?: boolean;
}

interface DotPlotProps {
  dots: Dot[];
  color: string;
  markers: DotMarker[];
  legend: LegendItem[];
  count: string;
  selectedId: string | null;
  selectedKeys: ReadonlySet<string> | null;
  focusKey: string | null;
  markerPreview: (name: string) => ReadonlySet<string>;
  onDot: (dot: Dot) => void;
  onMarker: (name: string) => void;
  onAll: () => void;
  withLegend?: boolean;
  height?: number;
}

const MAX_RADIUS = 7;
const COUNT_ROOM = 30;
const COUNT_GAP = 22;
const COUNT_LIFT = 12;
const MIN_RADIUS = 3;
const MAX_HEIGHT = 560;
const MARKER_ROW = 13;
const MARKER_HIT = 5;
const AXIS_TICKS = 12;
const LEGEND_ROOM = 30;

interface Column {
  cx: number;
  dots: Dot[];
}

function columns(dots: Dot[], x: (days: number) => number, left: number, width: number): Column[] {
  const byBucket = new Map<number, Dot[]>();
  for (const dot of dots) {
    const bucket = Math.floor((x(dot.value) - left) / width);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), dot]);
  }
  return [...byBucket.entries()].map(([bucket, members]) => ({
    cx: left + bucket * width + width / 2,
    dots: members,
  }));
}

export function DotPlot({
  dots,
  color,
  markers,
  legend,
  count,
  selectedId,
  selectedKeys,
  focusKey,
  markerPreview,
  onDot,
  onMarker,
  onAll,
  withLegend = true,
  height = 200,
}: DotPlotProps) {
  const [hoverAll, setHoverAll] = useState(false);
  const [pointer, setPointer] = useState<number | null>(null);
  const [active, setActive] = useState<{ dot: Dot; cx: number; cy: number } | null>(null);
  const [hoverMarker, setHoverMarker] = useState<string | null>(null);
  const [container, width] = useWidth<HTMLDivElement>();
  const padding = { ...TIME_PADDING, top: TIME_PADDING.top + markers.length * MARKER_ROW };
  const plotWidth = width - padding.left - padding.right;
  const sorted = [...dots].sort((a, b) => a.value - b.value);
  const axis = dayTicks(Math.max(1e-9, ...sorted.map((dot) => dot.value)), AXIS_TICKS);
  const right = axis[axis.length - 1] ?? 1;
  const x = (days: number) => padding.left + (days / right) * plotWidth;
  const frame = padding.top + padding.bottom;
  let radius = MAX_RADIUS;
  let stacks = columns(sorted, x, padding.left, radius * 2);
  const tallest = () => Math.max(0, ...stacks.map((column) => column.dots.length));
  while (radius > MIN_RADIUS && frame + tallest() * radius * 2 + 2 > MAX_HEIGHT) {
    radius -= 0.5;
    stacks = columns(sorted, x, padding.left, radius * 2);
  }
  const needed = frame + tallest() * radius * 2 + 2;
  const chartHeight = Math.min(MAX_HEIGHT, Math.max(height, needed));
  const plotHeight = chartHeight - frame;
  const bottom = padding.top + plotHeight;
  const overflow = needed > chartHeight;
  const room = plotHeight - (overflow ? COUNT_ROOM : 0);
  const fits = Math.max(1, Math.floor(room / (radius * 2)));
  const placed = stacks.flatMap((column) => {
    const shown = column.dots.length > fits ? column.dots.slice(0, fits - 1) : column.dots;
    return shown.map((dot, level) => ({
      dot,
      cx: column.cx,
      cy: bottom - radius - 1 - level * radius * 2,
    }));
  });
  const counts = stacks
    .filter((column) => column.dots.length > fits)
    .map((column) => ({
      cx: column.cx,
      top: bottom - radius - 1 - (fits - 2) * radius * 2 - radius,
      count: column.dots.length,
    }))
    .reduce<{ cx: number; top: number; count: number }[]>((placedCounts, item) => {
      const previous = placedCounts[placedCounts.length - 1];
      const crowded =
        previous !== undefined &&
        item.cx - previous.cx < COUNT_GAP &&
        Math.abs(item.top - previous.top) < COUNT_LIFT;
      placedCounts.push(crowded ? { ...item, top: previous.top - COUNT_LIFT } : item);
      return placedCounts;
    }, []);

  const move = (clientX: number, clientY: number, element: SVGRectElement) => {
    const box = element.getBoundingClientRect();
    const px = clientX - box.left + padding.left;
    const py = clientY - box.top + padding.top;
    setPointer(px);
    const hit = placed.find(
      (item) => Math.hypot(item.cx - px, item.cy - py) <= Math.max(radius, 5),
    );
    if (hit) {
      setActive(hit);
      setHoverMarker(null);
      return;
    }
    setActive(null);
    setHoverMarker(
      markers.find((candidate) => Math.abs(x(candidate.value) - px) <= MARKER_HIT)?.name ?? null,
    );
  };

  const preview: ReadonlySet<string> | null = active
    ? new Set([active.dot.key])
    : hoverMarker
      ? markerPreview(hoverMarker)
      : hoverAll
        ? new Set(dots.map((dot) => dot.key))
        : null;
  const marked = (key: string) =>
    Boolean(preview?.has(key) || selectedKeys?.has(key) || focusKey === key);

  return (
    <div className="line-chart" ref={container}>
      {withLegend && (
        <ChartLegend
          items={[
            {
              ...(legend[0] ?? { color, kind: "dot" as const }),
              name: count,
              onClick: onAll,
              onHover: setHoverAll,
              active: selectedId === "all",
            },
            ...legend.slice(1),
          ]}
        />
      )}
      <svg
        width={width}
        height={chartHeight}
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="img"
        aria-label={`${dots.length} cards by time taken`}
      >
        {axis.map((tick) => (
          <g key={tick}>
            <line
              className="chart-tick-mark"
              x1={x(tick)}
              x2={x(tick)}
              y1={bottom}
              y2={bottom + 4}
            />
            <text
              className="chart-tick"
              x={x(tick)}
              y={chartHeight - padding.bottom + 18}
              textAnchor="middle"
            >
              {axisDayLabel(tick, axis)}
            </text>
          </g>
        ))}
        <line
          className="chart-axis"
          x1={padding.left}
          x2={width - padding.right}
          y1={bottom}
          y2={bottom}
        />
        {dayMarks(plotWidth / right, right).map((day) => (
          <line
            key={`day-${day}`}
            className="chart-tick-mark"
            x1={x(day)}
            x2={x(day)}
            y1={bottom}
            y2={bottom + 3}
          />
        ))}
        {markers.map((marker, index) => {
          const mx = x(marker.value);
          const flip = mx > width - 140;
          return (
            <g
              key={marker.name}
              className={`scatter-line${selectedId === marker.name ? " selected" : ""}${
                hoverMarker === marker.name ? " hovered" : ""
              }`}
            >
              <text
                className="chart-marker-label"
                x={flip ? mx - 4 : mx + 4}
                y={TIME_PADDING.top + index * MARKER_ROW}
                textAnchor={flip ? "end" : "start"}
                style={{ fill: marker.color }}
              >
                {marker.label}
              </text>
              <line
                className="scatter-rule"
                x1={mx}
                x2={mx}
                y1={TIME_PADDING.top + index * MARKER_ROW - 10}
                y2={bottom}
                stroke={marker.color}
                strokeDasharray={marker.dashed ? "5 4" : undefined}
              />
            </g>
          );
        })}
        {placed.map(({ dot, cx, cy }) => {
          const hot = marked(dot.key);
          const dim = selectedKeys !== null && !hot;
          return (
            <circle
              key={dot.key}
              cx={cx}
              cy={cy}
              r={radius}
              fill={focusKey === dot.key ? HIGHLIGHT : dot.color ?? color}
              fillOpacity={focusKey === dot.key ? 1 : dim ? 0.15 : 0.6}
              stroke={hot ? HIGHLIGHT : dot.color ?? color}
              strokeOpacity={dim ? 0.3 : 1}
              strokeWidth={hot ? 2 : 1}
            />
          );
        })}
        {counts.map((item) => (
          <text
            key={`count-${item.cx}`}
            className="chart-stack-count"
            x={item.cx}
            y={item.top - 5}
            textAnchor="middle"
          >
            <title>{`${item.count} stays here; the column is cut to fit`}</title>
            {item.count}
          </text>
        ))}
        {pointer !== null && !active && (
          <Crosshair
            x={pointer}
            y={bottom}
            left={padding.left}
            right={width - padding.right}
            top={padding.top}
            bottom={bottom}
            vertical
            horizontal={false}
          />
        )}
        <rect
          className={`chart-hit${active || hoverMarker ? " chart-hit-pointer" : ""}`}
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          onPointerMove={(event) => move(event.clientX, event.clientY, event.currentTarget)}
          onPointerLeave={() => {
            setActive(null);
            setHoverMarker(null);
            setPointer(null);
          }}
          onClick={() => {
            if (active) {
              onDot(active.dot);
            } else if (hoverMarker) {
              onMarker(hoverMarker);
            }
          }}
        />
      </svg>
      {pointer !== null && !active && (
        <CrosshairTip
          x={pointer}
          y={bottom + LEGEND_ROOM - 40}
          width={width}
          text={`${shortDays(Math.max(0, ((pointer - padding.left) / plotWidth) * right))}${
            hoverMarker ? ` · ${hoverMarker}: click for the cards within it` : ""
          }`}
        />
      )}
      {active && (
        <div
          className="chart-tooltip line-tooltip"
          style={
            active.cx > width / 2
              ? { right: width - active.cx + 12, top: active.cy - 20 }
              : { left: active.cx + 12, top: active.cy - 20 }
          }
        >
          <strong>{active.dot.title}</strong>
          {active.dot.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
    </div>
  );
}
