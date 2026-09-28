import { useState } from "react";

import { ChartLegend } from "./ChartLegend";
import { ticks } from "./format";
import {
  Crosshair,
  CrosshairTip,
  minorTicks,
  TIME_PADDING,
  TimeCursor,
  TimeGaps,
  TimeTicks,
  useHoverTime,
  YTicks,
  type TimeSpan,
} from "./timeAxis";
import { useWidth } from "./useWidth";

interface CumulativeChartProps {
  moments: number[];
  span: TimeSpan;
  color: string;
  name: string;
  describe: (time: number, count: number) => string;
  count: string;
  selectedId: string | null;
  onAll: () => void;
  jumps: { at: number; count: number; label: string }[];
  height?: number;
}

const JUMP_LABEL_ROOM = 90;

export function CumulativeChart({
  moments,
  span,
  color,
  name,
  describe,
  count: countLabel,
  selectedId,
  onAll,
  jumps,
  height = 220,
}: CumulativeChartProps) {
  const { time, setTime } = useHoverTime();
  const [inside, setInside] = useState(false);
  const [container, width] = useWidth<HTMLDivElement>();
  const padding = TIME_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const bottom = padding.top + plotHeight;
  const sorted = [...moments].sort((a, b) => a - b);
  const axis = ticks(Math.max(1, sorted.length), 4);
  const top = axis[axis.length - 1] ?? 1;
  const length = Math.max(1, span.end - span.start);
  const x = (value: number) => padding.left + ((value - span.start) / length) * plotWidth;
  const y = (value: number) => bottom - (value / top) * plotHeight;
  const path = [
    `M${x(span.start)},${y(0)}`,
    ...sorted.flatMap((moment, index) => [`H${x(moment)}`, `V${y(index + 1)}`]),
    `H${x(span.end)}`,
  ].join(" ");
  const count = time === null ? 0 : sorted.filter((moment) => moment <= time).length;

  return (
    <div className="line-chart" ref={container}>
      <ChartLegend
        items={[
          {
            name: countLabel,
            color,
            kind: "line",
            onClick: onAll,
            active: selectedId === "all",
          },
        ]}
      />
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${name}: ${sorted.length}`}
      >
        <TimeGaps span={span} x={x} top={padding.top} bottom={bottom} />
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
              {tick}
            </text>
          </g>
        ))}
        <TimeTicks span={span} x={x} plotWidth={plotWidth} bottom={bottom} height={height} />
        <line
          className="chart-axis"
          x1={padding.left}
          x2={width - padding.right}
          y1={bottom}
          y2={bottom}
        />
        <path className="scatter-trend" stroke={color} d={path} />
        {jumps.map((jump) => {
          const after = sorted.filter((moment) => moment <= jump.at).length;
          return (
            <text
              key={jump.at}
              className="chart-stack-count"
              x={x(jump.at) - padding.left < JUMP_LABEL_ROOM ? x(jump.at) + 6 : x(jump.at) - 6}
              y={y(after - jump.count / 2) + 4}
              textAnchor={x(jump.at) - padding.left < JUMP_LABEL_ROOM ? "start" : "end"}
            >
              {jump.label}
            </text>
          );
        })}
        <YTicks
          axis={axis}
          minor={minorTicks(axis, true)}
          y={y}
          left={padding.left}
          top={padding.top}
          bottom={bottom}
        />
        <TimeCursor span={span} x={x} top={padding.top} bottom={bottom} />
        {inside && time !== null && (
          <Crosshair
            x={x(time)}
            y={y(count)}
            left={padding.left}
            right={width - padding.right}
            top={padding.top}
            bottom={bottom}
          />
        )}
        <rect
          className="chart-hit"
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          onPointerMove={(event) => {
            setInside(true);
            const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
            setTime(span.start + (px / plotWidth) * length);
          }}
          onPointerLeave={() => {
            setInside(false);
            setTime(null);
          }}
        />
      </svg>
      {inside && time !== null && (
        <CrosshairTip x={x(time)} y={y(count) + 30} width={width} text={describe(time, count)} />
      )}
    </div>
  );
}
