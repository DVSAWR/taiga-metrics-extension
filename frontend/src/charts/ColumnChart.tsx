import { useState } from "react";

import { ticks } from "./format";
import { useWidth } from "./useWidth";

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  detail: string;
}

interface ColumnChartProps {
  data: ColumnDatum[];
  height?: number;
  valueLabel: (value: number) => string;
  axisLabel: (datum: ColumnDatum, index: number) => string | null;
  highlight?: (datum: ColumnDatum) => boolean;
}

const PADDING = { top: 16, right: 8, bottom: 28, left: 36 };
const MAX_BAR = 24;
const RADIUS = 4;

function columnPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) {
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

export function ColumnChart({
  data,
  height = 180,
  valueLabel,
  axisLabel,
  highlight,
}: ColumnChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [container, width] = useWidth<HTMLDivElement>();
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const max = Math.max(1, ...data.map((datum) => datum.value));
  const axis = ticks(max, 4);
  const top = axis[axis.length - 1] ?? max;
  const band = data.length > 0 ? plotWidth / data.length : plotWidth;
  const barWidth = Math.min(MAX_BAR, Math.max(2, band - 4));
  const scale = (value: number) => (value / top) * plotHeight;
  const hovered = active === null ? null : data[active] ?? null;

  return (
    <div className="column-chart" ref={container}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={data.map((datum) => `${datum.label}: ${valueLabel(datum.value)}`).join(", ")}
      >
        {axis.map((tick) => {
          const y = PADDING.top + plotHeight - scale(tick);
          return (
            <g key={tick}>
              <line
                className="chart-grid"
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={y}
                y2={y}
              />
              <text className="chart-tick" x={PADDING.left - 6} y={y + 3} textAnchor="end">
                {valueLabel(tick)}
              </text>
            </g>
          );
        })}
        {data.map((datum, index) => {
          const x = PADDING.left + index * band + (band - barWidth) / 2;
          const barHeight = scale(datum.value);
          const y = PADDING.top + plotHeight - barHeight;
          const label = axisLabel(datum, index);
          return (
            <g key={datum.key}>
              <rect
                className="chart-hit"
                x={PADDING.left + index * band}
                y={PADDING.top}
                width={band}
                height={plotHeight}
                tabIndex={0}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
              <path
                className={`chart-bar${highlight?.(datum) ? " chart-bar-accent" : ""}${
                  active === index ? " chart-bar-active" : ""
                }`}
                d={columnPath(x, y, barWidth, barHeight)}
              />
              {label && (
                <text
                  className="chart-tick"
                  x={x + barWidth / 2}
                  y={height - PADDING.bottom + 16}
                  textAnchor="middle"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
        <line
          className="chart-axis"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={PADDING.top + plotHeight}
          y2={PADDING.top + plotHeight}
        />
      </svg>
      {hovered && active !== null && (
        <div className="chart-tooltip" style={{ left: PADDING.left + (active + 0.5) * band }}>
          <strong>{valueLabel(hovered.value)}</strong>
          <span>{hovered.detail}</span>
        </div>
      )}
    </div>
  );
}
