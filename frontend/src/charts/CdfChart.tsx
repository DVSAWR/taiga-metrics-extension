import { useState } from "react";

import { ChartLegend, type LegendItem } from "./ChartLegend";
import {
  axisDayLabel,
  dayMarks,
  Crosshair,
  CrosshairTip,
  dayTicks,
  shortDays,
  TIME_PADDING,
  YTicks,
} from "./timeAxis";
import { useWidth } from "./useWidth";

export interface CdfMarker {
  name: string;
  color: string;
  value: number;
  share: number;
  dashed?: boolean;
}

interface CdfChartProps {
  values: number[];
  color: string;
  markers: CdfMarker[];
  legend: LegendItem[];
  count: string;
  selectedId: string | null;
  onAll: () => void;
  onPick: (days: number) => void;
  height?: number;
}

const SHARES = [0, 0.25, 0.5, 0.75, 1];
const MINOR_SHARES = [
  0.05, 0.1, 0.15, 0.2, 0.3, 0.35, 0.4, 0.45, 0.55, 0.6, 0.65, 0.7, 0.8, 0.85, 0.9, 0.95,
];
const LEGEND_ROOM = 30;
const AXIS_TICKS = 12;

export function CdfChart({
  values,
  color,
  markers,
  legend,
  count,
  selectedId,
  onAll,
  onPick,
  height = 240,
}: CdfChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [container, width] = useWidth<HTMLDivElement>();
  const padding = TIME_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const bottom = padding.top + plotHeight;
  const sorted = [...values].sort((a, b) => a - b);
  const axis = dayTicks(Math.max(1e-9, ...sorted), AXIS_TICKS);
  const right = axis[axis.length - 1] ?? 1;
  const x = (days: number) => padding.left + (days / right) * plotWidth;
  const y = (share: number) => bottom - share * plotHeight;
  const within = (days: number) => sorted.filter((value) => value <= days + 1e-9).length;
  const steps = sorted.map((value, index) => ({ value, share: (index + 1) / sorted.length }));
  const path = [
    `M${x(0)},${y(0)}`,
    ...steps.flatMap((step) => [`H${x(step.value)}`, `V${y(step.share)}`]),
    `H${x(right)}`,
  ].join(" ");
  const hoverCount = hover === null ? 0 : within(hover);
  const hoverShare = sorted.length ? hoverCount / sorted.length : 0;

  const move = (clientX: number, element: SVGRectElement) => {
    const px = clientX - element.getBoundingClientRect().left;
    setHover(Math.max(0, Math.min(right, (px / plotWidth) * right)));
  };

  return (
    <div className="line-chart" ref={container}>
      <ChartLegend
        items={[
          {
            ...(legend[0] ?? { color, kind: "line" as const }),
            name: count,
            onClick: onAll,
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
        aria-label={markers.map((marker) => `${marker.name}`).join(", ")}
      >
        {SHARES.map((share) => (
          <g key={share}>
            <line
              className="chart-grid"
              x1={padding.left}
              x2={width - padding.right}
              y1={y(share)}
              y2={y(share)}
            />
            <text className="chart-tick" x={padding.left - 8} y={y(share) + 3} textAnchor="end">
              {`${Math.round(share * 100)}%`}
            </text>
          </g>
        ))}
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
              y={height - padding.bottom + 18}
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
        {markers.map((marker) => (
          <g key={marker.name}>
            <line
              className="scatter-rule"
              x1={padding.left}
              x2={x(marker.value)}
              y1={y(marker.share)}
              y2={y(marker.share)}
              stroke={marker.color}
              strokeDasharray={marker.dashed ? "5 4" : undefined}
            />
            <line
              className="scatter-rule"
              x1={x(marker.value)}
              x2={x(marker.value)}
              y1={y(marker.share)}
              y2={bottom}
              stroke={marker.color}
              strokeDasharray={marker.dashed ? "5 4" : undefined}
            />
            <text
              className="chart-marker-label"
              x={x(marker.value) + 5}
              y={bottom - 6}
              style={{ fill: marker.color }}
            >
              {shortDays(marker.value)}
            </text>
          </g>
        ))}
        <path className="scatter-trend" stroke={color} d={path} />
        <YTicks
          axis={SHARES}
          minor={MINOR_SHARES}
          y={y}
          left={padding.left}
          top={padding.top}
          bottom={bottom}
        />
        {hover !== null && (
          <Crosshair
            x={x(hover)}
            y={y(hoverShare)}
            left={padding.left}
            right={width - padding.right}
            top={padding.top}
            bottom={bottom}
            vertical
          />
        )}
        <rect
          className="chart-hit chart-hit-pointer"
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          onPointerMove={(event) => move(event.clientX, event.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover !== null && onPick(hover)}
        />
      </svg>
      {hover !== null && (
        <CrosshairTip
          x={x(hover)}
          y={y(hoverShare) + LEGEND_ROOM}
          width={width}
          text={`${shortDays(hover)} · ${Math.round(
            hoverShare * 100,
          )}% (${hoverCount}) · click for these cards`}
        />
      )}
    </div>
  );
}
