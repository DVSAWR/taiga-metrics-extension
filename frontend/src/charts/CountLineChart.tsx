import { useState } from "react";

import { Crosshair, minorTicks, TIME_PADDING, trendColor, TREND_FLAT, YTicks } from "./timeAxis";
import { useWidth } from "./useWidth";

export interface CountPoint {
  key: string;
  label: string;
  detail: string;
  value: number;
  current: boolean;
}

const PADDING = TIME_PADDING;
const INSET = 8;
const MIN_LABEL_WIDTH = 64;
const MIN_DOT_BAND = 8;
const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
const MAX_TICKS = 5;

function countTicks(max: number): number[] {
  const step =
    COUNT_STEPS.find((candidate) => max / candidate <= MAX_TICKS) ??
    COUNT_STEPS[COUNT_STEPS.length - 1] ??
    1;
  const result: number[] = [];
  for (let value = 0; value < max + step; value += step) {
    result.push(value);
  }
  return result.length > 1 ? result : [0, step];
}

export function CountLineChart({
  points,
  unit,
  height = 220,
}: {
  points: CountPoint[];
  unit: (value: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [container, width] = useWidth<HTMLDivElement>();
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const bottom = PADDING.top + plotHeight;
  const band = points.length > 0 ? plotWidth / points.length : plotWidth;
  const axis = countTicks(Math.max(0, ...points.map((point) => point.value)));
  const top = axis[axis.length - 1] ?? 1;
  const x = (index: number) => PADDING.left + band * (index + 0.5);
  const y = (value: number) => bottom - INSET - (value / top) * (plotHeight - INSET);
  const every = Math.max(1, Math.ceil(MIN_LABEL_WIDTH / Math.max(1, band)));
  const hovered = active === null ? null : points[active] ?? null;
  const segments = points.slice(1).map((point, at) => {
    const start = points[at];
    const going = point.current;
    return {
      key: point.key,
      from: at,
      to: at + 1,
      color: going || !start ? TREND_FLAT : trendColor(start.value, point.value, true),
      going,
    };
  });

  return (
    <div className="line-chart" ref={container}>
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
              {value}
            </text>
          </g>
        ))}
        <YTicks
          axis={axis}
          minor={minorTicks(axis, true)}
          y={y}
          left={PADDING.left}
          top={PADDING.top}
          bottom={bottom}
        />
        <line
          className="chart-axis"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={bottom}
          y2={bottom}
        />
        {points.map((point, index) =>
          index % every === 0 ? (
            <g key={`label-${point.key}`}>
              <line
                className="chart-tick-mark"
                x1={x(index)}
                x2={x(index)}
                y1={bottom}
                y2={bottom + 4}
              />
              <text
                className="chart-tick"
                x={x(index)}
                y={height - PADDING.bottom + 18}
                textAnchor="middle"
              >
                {point.label}
              </text>
            </g>
          ) : null,
        )}
        {segments.map((segment) => (
          <line
            key={segment.key}
            className="total-segment"
            x1={x(segment.from)}
            y1={y(points[segment.from]?.value ?? 0)}
            x2={x(segment.to)}
            y2={y(points[segment.to]?.value ?? 0)}
            stroke={segment.color}
            strokeDasharray={segment.going ? "5 4" : undefined}
          />
        ))}
        {band >= MIN_DOT_BAND &&
          points.map((point, index) => (
            <circle
              key={point.key}
              className={point.current ? "total-point going" : "total-point"}
              cx={x(index)}
              cy={y(point.value)}
              r={3.5}
            />
          ))}
        {hovered && active !== null && (
          <Crosshair
            x={x(active)}
            y={y(hovered.value)}
            left={PADDING.left}
            right={width - PADDING.right}
            top={PADDING.top}
            bottom={bottom}
            vertical
          />
        )}
        <rect
          className="chart-hit"
          x={PADDING.left}
          y={PADDING.top}
          width={Math.max(0, plotWidth)}
          height={plotHeight}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setActive(
              Math.max(
                0,
                Math.min(points.length - 1, Math.floor((event.clientX - box.left) / band)),
              ),
            );
          }}
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      {hovered && active !== null && (
        <div
          className="chart-tooltip line-tooltip"
          style={
            x(active) > width / 2
              ? { right: width - x(active) + 12, top: 12 }
              : { left: x(active) + 12, top: 12 }
          }
        >
          <strong>
            {hovered.detail}
            {hovered.current ? ", going" : ""}
          </strong>
          <span>{unit(hovered.value)}</span>
        </div>
      )}
    </div>
  );
}
