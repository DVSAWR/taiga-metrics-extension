import { useState } from "react";

import { ChartLegend, type LegendItem } from "./ChartLegend";
import { ticks } from "./format";
import {
  Crosshair,
  CrosshairTip,
  dayMarks,
  HIGHLIGHT,
  minorTicks,
  TIME_PADDING,
  TimeCursor,
  TimeGaps,
  TimeTicks,
  TrendPath,
  useHoverTime,
  YTicks,
  type TimeGap,
  type TimeSpan,
} from "./timeAxis";
import { useWidth } from "./useWidth";

export interface Bar {
  key: string;
  label: string;
  title: string;
  value: number;
  from?: number;
  to?: number;
}

export interface BarLine {
  name: string;
  values: (number | null)[];
  risingIsGood: boolean;
}

export interface BarMarker {
  name: string;
  color: string;
  at: number;
  label: string;
  dashed?: boolean;
}

interface BarChartProps {
  bars: Bar[];
  color: string;
  barName: string;
  count: string;
  span?: TimeSpan;
  line?: BarLine;
  markers?: BarMarker[];
  legend: LegendItem[];
  format: (value: number) => string;
  lineFormat?: (value: number) => string;
  crossX: (position: number) => string;
  selectedId: string | null;
  selectedBars: ReadonlySet<string> | null;
  focusBar?: string | null;
  dayWidth?: number;
  markerPreview?: (name: string) => ReadonlySet<string>;
  onBar: (bar: Bar) => void;
  onMarker?: (name: string) => void;
  onAll: () => void;
  gap?: number;
  clipOutlier?: boolean;
  height?: number;
}

const MIN_LABEL_GAP = 48;
const RADIUS = 3;
const MARKER_HIT = 5;
const MARKER_ROW = 13;
const OUTLIER_RATIO = 3;
const CLIP_HEADROOM = 1.2;
const CLIP_ROOM = 14;
const LEGEND_ROOM = 30;

function topRounded(x: number, y: number, width: number, height: number): string {
  if (height <= 0 || width <= 0) {
    return "";
  }
  const radius = Math.min(RADIUS, width / 2, height);
  return [
    `M${x},${y + height}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${x + width - radius}`,
    `Q${x + width},${y} ${x + width},${y + radius}`,
    `V${y + height}`,
    "Z",
  ].join("");
}

function barGaps(span: TimeSpan, bars: Bar[]): TimeGap[] {
  const holding = (moment: number) =>
    bars.find(
      (bar) =>
        bar.from !== undefined && bar.to !== undefined && bar.from <= moment && moment < bar.to,
    );
  return span.gaps.flatMap((gap) => {
    const from = holding(gap.from)?.to ?? gap.from;
    const to = holding(gap.to)?.from ?? gap.to;
    return to > from ? [{ ...gap, from, to }] : [];
  });
}

export function BarChart({
  bars,
  color,
  barName,
  count,
  span,
  line,
  markers = [],
  legend,
  format,
  lineFormat = format,
  crossX,
  selectedId,
  selectedBars,
  focusBar = null,
  dayWidth,
  markerPreview,
  onBar,
  onMarker,
  onAll,
  gap = 1,
  clipOutlier = false,
  height = 220,
}: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [hoverMarker, setHoverMarker] = useState<string | null>(null);
  const [hoverAll, setHoverAll] = useState(false);
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const { setTime } = useHoverTime();
  const [container, width] = useWidth<HTMLDivElement>();
  const filled = bars
    .map((bar) => bar.value)
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
  const highest = filled[0] ?? 0;
  const second = filled[1] ?? 0;
  const clipped = clipOutlier && second > 0 && highest >= second * OUTLIER_RATIO;
  const padding = {
    ...TIME_PADDING,
    top: TIME_PADDING.top + markers.length * MARKER_ROW + (clipped ? CLIP_ROOM : 0),
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const bottom = padding.top + plotHeight;
  const lineValues = line?.values.filter((value): value is number => value !== null) ?? [];
  const ceiling = clipped
    ? Math.max(second, ...lineValues.filter((value) => value < highest)) * CLIP_HEADROOM
    : Math.max(1, highest, ...lineValues);
  const axis = ticks(Math.max(1, ceiling), 4);
  const top = axis[axis.length - 1] ?? 1;
  const scale = (value: number) => (Math.min(value, top) / top) * plotHeight;
  const y = (value: number) => bottom - scale(value);
  const length = span ? Math.max(1, span.end - span.start) : 1;
  const timeX = (value: number) =>
    padding.left + ((value - (span?.start ?? 0)) / length) * plotWidth;
  const band = bars.length > 0 ? plotWidth / bars.length : plotWidth;
  const extent = (index: number): [number, number] => {
    const bar = bars[index];
    if (span && bar?.from !== undefined && bar.to !== undefined) {
      return [timeX(Math.max(span.start, bar.from)), timeX(Math.min(span.end, bar.to))];
    }
    return [padding.left + band * index, padding.left + band * (index + 1)];
  };
  const center = (index: number) => {
    const [left, right] = extent(index);
    return (left + right) / 2;
  };
  const every = Math.max(1, Math.ceil(MIN_LABEL_GAP / Math.max(1, band)));
  const hovered = active === null ? null : bars[active] ?? null;
  const markerX = (marker: BarMarker) => padding.left + band * marker.at;
  const preview: ReadonlySet<string> | null =
    hovered && hovered.value > 0
      ? new Set([hovered.key])
      : hoverMarker && markerPreview
        ? markerPreview(hoverMarker)
        : hoverAll
          ? new Set(bars.filter((bar) => bar.value > 0).map((bar) => bar.key))
          : null;
  const position = (px: number) =>
    span ? span.start + ((px - padding.left) / plotWidth) * length : (px - padding.left) / band;

  const move = (clientX: number, clientY: number, element: SVGRectElement) => {
    const box = element.getBoundingClientRect();
    const px = clientX - box.left + padding.left;
    const py = clientY - box.top + padding.top;
    setPointer([px, py]);
    if (span) {
      setTime(position(px));
    }
    const marker = markers.find((candidate) => Math.abs(markerX(candidate) - px) <= MARKER_HIT);
    if (marker) {
      setHoverMarker(marker.name);
      setActive(null);
      return;
    }
    setHoverMarker(null);
    const index = bars.findIndex((_, at) => {
      const [left, right] = extent(at);
      return px >= left && px < right;
    });
    setActive(index < 0 ? null : index);
  };

  const linePoints = line
    ? line.values.map((value, index): [number, number] | null =>
        value === null ? null : [center(index), y(value)],
      )
    : [];

  return (
    <div className="line-chart" ref={container}>
      <ChartLegend
        items={[
          {
            ...(legend[0] ?? { color, kind: "bar" as const }),
            name: count,
            onClick: onAll,
            onHover: setHoverAll,
            active: selectedId === "all",
          },
          ...legend.slice(1),
        ]}
      />
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={bars.map((bar) => `${bar.title}: ${format(bar.value)}`).join(", ")}
      >
        {span && (
          <TimeGaps
            span={{ ...span, gaps: barGaps(span, bars) }}
            x={timeX}
            top={padding.top}
            bottom={bottom}
          />
        )}
        {axis.map((tick) => (
          <g key={tick}>
            <line
              className="chart-grid"
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="chart-tick" x={padding.left - 8} y={y(tick) + 3} textAnchor="end">
              {format(tick)}
            </text>
          </g>
        ))}
        <YTicks
          axis={axis}
          minor={minorTicks(axis, true)}
          y={y}
          left={padding.left}
          top={padding.top}
          bottom={bottom}
        />
        {bars.map((bar, index) => {
          const [left, right] = extent(index);
          const barWidth = Math.max(1, right - left - gap * 2);
          const tall = scale(bar.value);
          const hot = Boolean(preview?.has(bar.key) || selectedBars?.has(bar.key));
          const dim = selectedBars !== null && !hot;
          return (
            <g key={bar.key}>
              <path
                d={
                  gap === 0
                    ? `M${left},${bottom}V${bottom - tall}H${right}V${bottom}Z`
                    : topRounded(left + gap, bottom - tall, barWidth, tall)
                }
                fill={focusBar === bar.key ? HIGHLIGHT : color}
                opacity={focusBar === bar.key ? 1 : dim ? 0.3 : 1}
                stroke={hot && bar.value > 0 ? HIGHLIGHT : "none"}
                strokeWidth={hot ? 2 : 0}
              />
              {bar.value > top && (
                <text
                  className="chart-stack-count"
                  x={(left + right) / 2}
                  y={bottom - tall - 4}
                  textAnchor="middle"
                >
                  {`${format(bar.value)} ↑`}
                </text>
              )}
              {!span && (
                <line
                  className="chart-tick-mark"
                  x1={left}
                  x2={left}
                  y1={bottom}
                  y2={bottom + 4}
                />
              )}
              {!span && index % every === 0 && (
                <text
                  className="chart-tick"
                  x={left}
                  y={height - padding.bottom + 18}
                  textAnchor="middle"
                >
                  {bar.label}
                </text>
              )}
            </g>
          );
        })}
        {!span &&
          dayWidth !== undefined &&
          dayMarks(band / dayWidth, bars.length * dayWidth).map((day) => (
            <line
              key={`day-${day}`}
              className="chart-tick-mark"
              x1={padding.left + (day / dayWidth) * band}
              x2={padding.left + (day / dayWidth) * band}
              y1={bottom}
              y2={bottom + 3}
            />
          ))}
        {span && (
          <TimeTicks span={span} x={timeX} plotWidth={plotWidth} bottom={bottom} height={height} />
        )}
        <line
          className="chart-axis"
          x1={padding.left}
          x2={width - padding.right}
          y1={bottom}
          y2={bottom}
        />
        {line && <TrendPath points={linePoints} risingIsGood={line.risingIsGood} />}
        {markers.map((marker, index) => {
          const mx = markerX(marker);
          const right = mx > width - 140;
          return (
            <g
              key={marker.name}
              className={`scatter-line${selectedId === marker.name ? " selected" : ""}${
                hoverMarker === marker.name ? " hovered" : ""
              }`}
            >
              <text
                className="chart-marker-label"
                x={right ? mx - 4 : mx + 4}
                y={TIME_PADDING.top + index * MARKER_ROW}
                textAnchor={right ? "end" : "start"}
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
        {span && <TimeCursor span={span} x={timeX} top={padding.top} bottom={bottom} />}
        {pointer && (
          <Crosshair
            x={pointer[0]}
            y={pointer[1]}
            left={padding.left}
            right={width - padding.right}
            top={padding.top}
            bottom={bottom}
            vertical={!span}
          />
        )}
        <rect
          className={`chart-hit${
            hoverMarker || (hovered && hovered.value > 0) ? " chart-hit-pointer" : ""
          }`}
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          onPointerMove={(event) => move(event.clientX, event.clientY, event.currentTarget)}
          onPointerLeave={() => {
            setActive(null);
            setHoverMarker(null);
            setPointer(null);
            setTime(null);
          }}
          onClick={() => {
            if (hoverMarker) {
              onMarker?.(hoverMarker);
            } else if (hovered && hovered.value > 0) {
              onBar(hovered);
            }
          }}
        />
      </svg>
      {hovered && active !== null && (
        <div
          className="chart-tooltip line-tooltip"
          style={
            center(active) > width / 2
              ? { right: width - center(active) + 12, top: LEGEND_ROOM }
              : { left: center(active) + 12, top: LEGEND_ROOM }
          }
        >
          <strong>{hovered.title}</strong>
          <span className="line-tooltip-row">
            <span className="bar-swatch" style={{ background: color }} />
            {barName}: {format(hovered.value)}
          </span>
          {line && line.values[active] != null && (
            <span className="line-tooltip-row">
              {line.name}: {lineFormat(line.values[active] ?? 0)}
            </span>
          )}
        </div>
      )}
      {pointer && (
        <CrosshairTip
          x={pointer[0]}
          y={pointer[1] + LEGEND_ROOM}
          width={width}
          text={`${crossX(position(pointer[0]))} · ${lineFormat(
            Math.max(0, ((bottom - pointer[1]) / plotHeight) * top),
          )}`}
        />
      )}
    </div>
  );
}
