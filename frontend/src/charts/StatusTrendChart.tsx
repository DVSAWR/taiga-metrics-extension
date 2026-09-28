import { useState } from "react";

import { axisDayLabel, Crosshair, dayTicks, minorTicks, TIME_PADDING, YTicks } from "./timeAxis";
import { formatAdaptive } from "./format";
import { useWidth } from "./useWidth";

export interface TrendPoint {
  label: string;
  p25: number;
  p50: number;
  p75: number;
  n: number;
}

const PADDING = TIME_PADDING;
const INSET = 8;
const MIN_RADIUS = 3;
const MAX_RADIUS = 9;
const MIN_LABEL_WIDTH = 64;

export function StatusTrendChart({
  labels,
  points,
  few,
  height = 280,
}: {
  labels: string[];
  points: (TrendPoint | null)[];
  few: number;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [container, width] = useWidth<HTMLDivElement>();
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const bottom = PADDING.top + plotHeight;
  const band = labels.length > 0 ? plotWidth / labels.length : plotWidth;
  const known = points.filter((point): point is TrendPoint => point !== null);
  const axis = dayTicks(Math.max(1e-9, ...known.map((point) => point.p75)));
  const top = axis[axis.length - 1] ?? 1;
  const most = Math.max(1, ...known.map((point) => point.n));
  const x = (index: number) => PADDING.left + band * (index + 0.5);
  const y = (value: number) => bottom - INSET - (value / top) * (plotHeight - INSET);
  const radius = (n: number) => MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(n / most);
  const every = Math.max(1, Math.ceil(MIN_LABEL_WIDTH / Math.max(1, band)));
  const runs: number[][] = [];
  points.forEach((point, index) => {
    if (point === null) {
      return;
    }
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === index - 1) {
      run.push(index);
    } else {
      runs.push([index]);
    }
  });
  const hovered = active === null ? null : points[active] ?? null;

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
        {labels.map((label, index) => (
          <g key={`${label}-${index}`}>
            {index % every === 0 && (
              <line
                className="sprint-boundary"
                x1={x(index)}
                x2={x(index)}
                y1={PADDING.top}
                y2={bottom + 6}
              />
            )}
            {index % every === 0 && (
              <text
                className="chart-tick"
                x={x(index)}
                y={height - PADDING.bottom + 18}
                textAnchor="middle"
              >
                {label}
              </text>
            )}
          </g>
        ))}
        <line
          className="chart-axis"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={bottom}
          y2={bottom}
        />
        {runs.map((run) => {
          const upper = run.map((index) => `${x(index)},${y(points[index]?.p75 ?? 0)}`);
          const lower = [...run]
            .reverse()
            .map((index) => `${x(index)},${y(points[index]?.p25 ?? 0)}`);
          return (
            <g key={run[0]}>
              {run.length > 1 && (
                <polygon className="trend-band" points={[...upper, ...lower].join(" ")} />
              )}
              <polyline
                className="trend-median"
                points={run.map((index) => `${x(index)},${y(points[index]?.p50 ?? 0)}`).join(" ")}
              />
            </g>
          );
        })}
        {points.map((point, index) =>
          point === null ? null : (
            <circle
              key={index}
              className={point.n < few ? "trend-point weak" : "trend-point"}
              cx={x(index)}
              cy={y(point.p50)}
              r={radius(point.n)}
            />
          ),
        )}
        {hovered && active !== null && (
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
          className="chart-hit"
          x={PADDING.left}
          y={PADDING.top}
          width={plotWidth}
          height={plotHeight}
          onPointerMove={(event) => {
            const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
            const index = Math.max(0, Math.min(labels.length - 1, Math.floor(px / band)));
            setActive(points[index] ? index : null);
          }}
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      {hovered && active !== null && (
        <div
          className="chart-tooltip line-tooltip"
          style={
            x(active) > width / 2
              ? { right: width - x(active) + 12, top: y(hovered.p50) }
              : { left: x(active) + 12, top: y(hovered.p50) }
          }
        >
          <strong>{labels[active]}</strong>
          <span>Median {formatAdaptive(hovered.p50)}</span>
          <span>
            Middle half {formatAdaptive(hovered.p25)} to {formatAdaptive(hovered.p75)}
          </span>
          <span>
            {hovered.n} {hovered.n === 1 ? "stay" : "stays"}
            {hovered.n < few ? ", too few to judge" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
