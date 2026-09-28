import { useMemo, useState } from "react";

import { ChartLegend, type LegendItem } from "./ChartLegend";
import {
  axisDayLabel,
  Crosshair,
  CrosshairTip,
  dayTicks,
  HIGHLIGHT,
  minorTicks,
  shortDays,
  TIME_PADDING,
  TimeCursor,
  TimeGaps,
  TimeTicks,
  TrendPath,
  useHoverTime,
  YTicks,
  type TimeSpan,
} from "./timeAxis";
import { useWidth } from "./useWidth";

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  title: string;
  lines: string[];
}

export interface ScatterRule {
  name: string;
  color: string;
  value: number;
  dashed?: boolean;
}

export interface ScatterTrend {
  name: string;
  points: ([number, number] | null)[];
}

interface ScatterChartProps {
  points: ScatterPoint[];
  rules: ScatterRule[];
  trend?: ScatterTrend;
  span: TimeSpan;
  color: string;
  count: string;
  selectedId: string | null;
  selectedKeys: ReadonlySet<string> | null;
  focusKey: string | null;
  linePreview: (name: string) => ReadonlySet<string>;
  formatX: (time: number) => string;
  onLine: (name: string) => void;
  onCluster: (keys: string[], at: number) => void;
  onAll: () => void;
  onPoint: (point: ScatterPoint) => void;
  height?: number;
}

const PADDING = TIME_PADDING;
const RADIUS = 4;
const INSET = 8;
const TOP_ROOM = 20;
const HIT_RADIUS = 8;
const LINE_HIT = 5;
const SHIFT = 3;
const MAX_SHIFTS = 6;
const LIFT = 2;
const MAX_LIFTS = 2;
const CLUSTER_WIDTH = 6;
const CLUSTER_LABEL = 8;

interface Placed {
  point: ScatterPoint;
  px: number;
  cx: number;
  cy: number;
}

function place(
  points: ScatterPoint[],
  x: (value: number) => number,
  y: (value: number) => number,
  dayWidth: number,
) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const placed: Placed[] = [];
  const spread = Math.min(SHIFT * MAX_SHIFTS, Math.max(0, dayWidth / 2 - RADIUS / 2));
  const reach = spread + RADIUS * 2;
  const offsets: [number, number][] = [[0, 0]];
  for (let step = 1; step * SHIFT <= spread; step += 1) {
    offsets.push([step * SHIFT, 0], [-step * SHIFT, 0]);
  }
  for (let step = 1; step <= MAX_LIFTS; step += 1) {
    offsets.push([0, -step * LIFT], [0, step * LIFT]);
  }
  for (const point of sorted) {
    const px = x(point.x);
    const py = y(point.y);
    const free = (cx: number, cy: number) => {
      for (let index = placed.length - 1; index >= 0; index -= 1) {
        const other = placed[index];
        if (!other || other.px < px - reach) {
          break;
        }
        if (Math.hypot(other.cx - cx, other.cy - cy) < RADIUS * 1.6) {
          return false;
        }
      }
      return true;
    };
    const [dx, dy] = offsets.find(([ox, oy]) => free(px + ox, py + oy)) ?? [0, 0];
    const cx = px + dx;
    const cy = py + dy;
    placed.push({ point, px, cx, cy });
  }
  return placed;
}

interface Cluster {
  x: number;
  top: number;
  keys: string[];
  at: number;
}

function clusters(placed: Placed[]): Cluster[] {
  const result: Cluster[] = [];
  let group: Placed[] = [];
  const flush = () => {
    if (group.length >= CLUSTER_LABEL) {
      result.push({
        x: group.reduce((sum, item) => sum + item.px, 0) / group.length,
        top: Math.min(...group.map((item) => item.cy)),
        keys: group.map((item) => item.point.key),
        at: group.reduce((sum, item) => sum + item.point.x, 0) / group.length,
      });
    }
  };
  for (const item of placed) {
    if (group.length > 0 && item.px - (group[0]?.px ?? 0) > CLUSTER_WIDTH) {
      flush();
      group = [];
    }
    group.push(item);
  }
  flush();
  return result;
}

function segmentDistance(
  px: number,
  py: number,
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): number {
  const length = (bx - ax) ** 2 + (by - ay) ** 2;
  const share =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length));
  return Math.hypot(px - (ax + share * (bx - ax)), py - (ay + share * (by - ay)));
}

export function ScatterChart({
  points,
  rules,
  trend,
  span,
  color,
  count,
  selectedId,
  selectedKeys,
  focusKey,
  linePreview,
  formatX,
  onLine,
  onCluster,
  onAll,
  onPoint,
  height = 280,
}: ScatterChartProps) {
  const [active, setActive] = useState<Placed | null>(null);
  const [hoverLine, setHoverLine] = useState<string | null>(null);
  const [hoverCluster, setHoverCluster] = useState<number | null>(null);
  const [hoverAll, setHoverAll] = useState(false);
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const { setTime } = useHoverTime();
  const [container, width] = useWidth<HTMLDivElement>();
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const plotTop = PADDING.top + TOP_ROOM;
  const chartHeight = height + TOP_ROOM;
  const bottom = plotTop + plotHeight;
  const axis = dayTicks(
    Math.max(1e-9, ...points.map((point) => point.y), ...rules.map((rule) => rule.value)),
  );
  const top = axis[axis.length - 1] ?? 1;
  const length = Math.max(1, span.end - span.start);
  const x = (value: number) => PADDING.left + ((value - span.start) / length) * plotWidth;
  const y = (value: number) => bottom - INSET - (value / top) * (plotHeight - INSET);
  const valueAt = (py: number) =>
    Math.max(0, ((bottom - INSET - py) / (plotHeight - INSET)) * top);
  const placed = useMemo(
    () => place(points, x, y, (plotWidth * 86400000) / length),
    [points, width, height, top, span.start, span.end],
  );
  const stacks = clusters(placed);
  const trendPoints = trend
    ? trend.points.map((point): [number, number] | null =>
        point === null ? null : [x(point[0]), y(point[1])],
      )
    : [];
  const hasTrend = trendPoints.filter((point) => point !== null).length > 1;
  const ruleLabels = rules.map((rule) => ({ rule, at: y(rule.value) }));
  ruleLabels.forEach((label, index) => {
    const previous = ruleLabels[index - 1];
    if (previous && Math.abs(previous.at - label.at) < 12) {
      label.at = previous.at - 12;
    }
  });
  const preview: ReadonlySet<string> | null = active
    ? new Set([active.point.key])
    : hoverLine
      ? linePreview(hoverLine)
      : hoverCluster !== null
        ? new Set(stacks[hoverCluster]?.keys ?? [])
        : hoverAll
          ? new Set(points.map((point) => point.key))
          : null;

  const move = (clientX: number, clientY: number, element: SVGRectElement) => {
    const box = element.getBoundingClientRect();
    const px = clientX - box.left + PADDING.left;
    const py = clientY - box.top + plotTop;
    setPointer([px, py]);
    setTime(span.start + ((px - PADDING.left) / plotWidth) * length);
    const label = stacks.findIndex(
      (stack) => Math.abs(stack.x - px) <= 12 && Math.abs(stack.top - 13 - py) <= 8,
    );
    if (label >= 0) {
      setActive(null);
      setHoverLine(null);
      setHoverCluster(label);
      return;
    }
    let best: Placed | null = null;
    let distance = HIT_RADIUS;
    for (const item of placed) {
      const gap = Math.hypot(item.cx - px, item.cy - py);
      if (gap <= distance) {
        best = item;
        distance = gap;
      }
    }
    setActive(best);
    if (best) {
      setHoverLine(null);
      setHoverCluster(null);
      return;
    }
    setHoverCluster(null);
    const rule = rules.find((candidate) => Math.abs(y(candidate.value) - py) <= LINE_HIT);
    if (rule) {
      setHoverLine(rule.name);
      return;
    }
    const nearTrend =
      trend &&
      trendPoints.some((point, index) => {
        const previous = index > 0 ? trendPoints[index - 1] : null;
        return point && previous && segmentDistance(px, py, previous, point) <= LINE_HIT;
      });
    setHoverLine(nearTrend && trend ? trend.name : null);
  };

  const legend: LegendItem[] = [
    {
      name: count,
      color,
      kind: "dot",
      onClick: onAll,
      onHover: setHoverAll,
      active: selectedId === "all",
    },
    ...rules.map((rule) => ({
      name: rule.name,
      color: rule.color,
      kind: rule.dashed ? ("dashed" as const) : ("line" as const),
    })),
    ...(trend && hasTrend
      ? [{ name: trend.name, color: "", kind: "trend" as const, risingIsGood: false }]
      : []),
  ];
  const lineClass = (name: string) =>
    `scatter-line${selectedId === name ? " selected" : ""}${hoverLine === name ? " hovered" : ""}`;
  const marked = (key: string) =>
    Boolean(preview?.has(key) || selectedKeys?.has(key) || focusKey === key);
  const ordered = [...placed].sort(
    (a, b) => Number(marked(a.point.key)) - Number(marked(b.point.key)),
  );
  const pointed = active || hoverLine || hoverCluster !== null;

  return (
    <div className="line-chart" ref={container}>
      <ChartLegend items={legend} />
      <svg
        width={width}
        height={chartHeight}
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="img"
        aria-label={`${points.length} cards; ${rules
          .map((rule) => `${rule.name} ${shortDays(rule.value)}`)
          .join(", ")}`}
      >
        <TimeGaps span={span} x={x} top={plotTop} bottom={bottom} />
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
          top={plotTop}
          bottom={bottom}
        />
        <TimeTicks span={span} x={x} plotWidth={plotWidth} bottom={bottom} height={chartHeight} />
        <line
          className="chart-axis"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={bottom}
          y2={bottom}
        />
        {rules.map((rule) => (
          <g key={rule.name} className={lineClass(rule.name)}>
            <line
              className="scatter-rule"
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={y(rule.value)}
              y2={y(rule.value)}
              stroke={rule.color}
              strokeDasharray={rule.dashed ? "5 4" : undefined}
            />
          </g>
        ))}
        {trend && hasTrend && (
          <g className={lineClass(trend.name)}>
            <TrendPath points={trendPoints} risingIsGood={false} />
          </g>
        )}
        {ordered.map(({ point, cx, cy }) => {
          const hot = marked(point.key);
          const dim = selectedKeys !== null && !hot;
          const big = focusKey === point.key || active?.point.key === point.key;
          return (
            <circle
              key={point.key}
              cx={cx}
              cy={cy}
              r={big ? RADIUS + 2 : RADIUS}
              fill={focusKey === point.key ? HIGHLIGHT : color}
              fillOpacity={focusKey === point.key ? 1 : dim ? 0.12 : 0.6}
              stroke={hot ? HIGHLIGHT : color}
              strokeOpacity={dim ? 0.3 : 1}
              strokeWidth={hot ? 2 : 1}
            />
          );
        })}
        {stacks.map((stack, index) => (
          <text
            key={stack.x}
            className={`chart-count-link${hoverCluster === index ? " hovered" : ""}${
              selectedId === `cluster-${stack.at}` ? " active" : ""
            }`}
            x={stack.x}
            y={stack.top - 9}
            textAnchor="middle"
          >
            {stack.keys.length}
          </text>
        ))}
        {ruleLabels.map(({ rule, at }) => (
          <text
            key={rule.name}
            className="chart-marker-label"
            x={width - PADDING.right + 6}
            y={at + 4}
            style={{ fill: rule.color }}
          >
            {shortDays(rule.value)}
          </text>
        ))}
        <TimeCursor span={span} x={x} top={plotTop} bottom={bottom} />
        {pointer && !active && (
          <Crosshair
            x={pointer[0]}
            y={pointer[1]}
            left={PADDING.left}
            right={width - PADDING.right}
            top={plotTop}
            bottom={bottom}
          />
        )}
        <rect
          className={`chart-hit${pointed ? " chart-hit-pointer" : ""}`}
          x={PADDING.left}
          y={plotTop}
          width={plotWidth}
          height={plotHeight}
          onPointerMove={(event) => move(event.clientX, event.clientY, event.currentTarget)}
          onPointerLeave={() => {
            setActive(null);
            setHoverLine(null);
            setHoverCluster(null);
            setPointer(null);
            setTime(null);
          }}
          onClick={() => {
            const cluster = hoverCluster === null ? null : stacks[hoverCluster];
            if (active) {
              onPoint(active.point);
            } else if (cluster) {
              onCluster(cluster.keys, cluster.at);
            } else if (hoverLine) {
              onLine(hoverLine);
            }
          }}
        />
      </svg>
      {active ? (
        <div
          className="chart-tooltip line-tooltip"
          style={
            active.cx > width / 2
              ? { right: width - active.cx + 12, top: active.cy }
              : { left: active.cx + 12, top: active.cy }
          }
        >
          <strong>{active.point.title}</strong>
          {active.point.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      ) : (
        pointer && (
          <CrosshairTip
            x={pointer[0]}
            y={pointer[1] + 30}
            width={width}
            text={`${formatX(
              span.start + ((pointer[0] - PADDING.left) / plotWidth) * length,
            )} · ${shortDays(valueAt(pointer[1]))}${
              hoverLine
                ? ` · ${hoverLine}: click for the cards within it`
                : hoverCluster !== null
                  ? " · click for these cards"
                  : ""
            }`}
          />
        )
      )}
    </div>
  );
}
