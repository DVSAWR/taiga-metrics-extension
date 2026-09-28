import { createContext, useContext, useState, type ReactNode } from "react";

export interface AxisDay {
  at: number;
  monday: boolean;
  label: string;
}

export interface TimeGap {
  from: number;
  to: number;
  label: string;
}

export interface TimeSpan {
  start: number;
  end: number;
  days: AxisDay[];
  gaps: TimeGap[];
}

export const TIME_PADDING = { top: 16, right: 56, bottom: 28, left: 64 };
export const TREND_BAD = "#d1435b";
export const TREND_GOOD = "#2f9e6e";
export const TREND_FLAT = "#b4b6c6";
export const HIGHLIGHT = "#e44057";

const MIN_TICK_GAP = 3;
const DAY_MARK_STEPS = [1, 7, 30];
const MIN_LABEL_GAP = 64;
const MIN_GAP_LABEL = 150;
const FLAT_SHARE = 0.05;
const DAY_STEPS = [1 / 24, 2 / 24, 3 / 24, 6 / 24, 12 / 24, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const MAX_Y_TICKS = 8;

interface HoverTimeValue {
  time: number | null;
  setTime: (time: number | null) => void;
}

const HoverTime = createContext<HoverTimeValue>({ time: null, setTime: () => undefined });

export function HoverTimeProvider({ children }: { children: ReactNode }) {
  const [time, setTime] = useState<number | null>(null);
  return <HoverTime.Provider value={{ time, setTime }}>{children}</HoverTime.Provider>;
}

export function useHoverTime(): HoverTimeValue {
  return useContext(HoverTime);
}

export function axisDays(
  days: AxisDay[],
  plotWidth: number,
): { tick: AxisDay[]; label: AxisDay[] } {
  const perDay = days.length > 0 ? plotWidth / days.length : plotWidth;
  const mondays = days.filter((day) => day.monday);
  const tick =
    perDay >= MIN_TICK_GAP
      ? days
      : perDay * 7 >= MIN_TICK_GAP
        ? mondays
        : mondays.filter((_, index) => index % 4 === 0);
  const every = Math.max(1, Math.ceil(MIN_LABEL_GAP / (perDay * 7)));
  return { tick, label: mondays.filter((_, index) => index % every === 0) };
}

export function dayTicks(max: number, most = MAX_Y_TICKS): number[] {
  const step =
    DAY_STEPS.find((candidate) => max / candidate <= most) ?? DAY_STEPS[DAY_STEPS.length - 1] ?? 1;
  const result: number[] = [];
  for (let value = 0; value <= Math.max(step, max) + step * 0.999; value += step) {
    result.push(Number(value.toPrecision(12)));
    if (value >= max) {
      break;
    }
  }
  return result;
}

export function shortDays(days: number): string {
  if (days === 0) {
    return "0 d";
  }
  if (days < 1) {
    return `${Number((days * 24).toPrecision(3))} h`;
  }
  return `${days >= 10 ? Math.round(days) : Number(days.toFixed(1))} d`;
}

export function axisDayLabel(value: number, ticks: number[]): string {
  const step = ticks[1] ?? 1;
  if (value === 0) {
    return step < 1 ? "0 h" : "0 d";
  }
  return step < 1 ? `${Math.round(value * 24)} h` : `${value} d`;
}

export function trendColor(from: number, to: number, risingIsGood: boolean): string {
  const scale = Math.max(Math.abs(from), Math.abs(to), 1e-9);
  if (Math.abs(to - from) <= scale * FLAT_SHARE) {
    return TREND_FLAT;
  }
  return to > from === risingIsGood ? TREND_GOOD : TREND_BAD;
}

export function TrendPath({
  points,
  risingIsGood,
}: {
  points: ([number, number] | null)[];
  risingIsGood: boolean;
}) {
  const segments: { from: [number, number]; to: [number, number] }[] = [];
  points.forEach((point, index) => {
    const previous = index > 0 ? points[index - 1] : null;
    if (point && previous) {
      segments.push({ from: previous, to: point });
    }
  });
  return (
    <>
      {segments.map(({ from, to }) => (
        <line
          key={`${from[0]}-${to[0]}`}
          className="trend-segment"
          x1={from[0]}
          y1={from[1]}
          x2={to[0]}
          y2={to[1]}
          stroke={trendColor(-from[1], -to[1], risingIsGood)}
        />
      ))}
    </>
  );
}

export function TimeGaps({
  span,
  x,
  top,
  bottom,
}: {
  span: TimeSpan;
  x: (value: number) => number;
  top: number;
  bottom: number;
}) {
  return (
    <>
      {span.gaps.map((gap) => {
        const left = x(gap.from);
        const width = x(gap.to) - left;
        return (
          <g key={gap.from}>
            <rect className="chart-gap" x={left} y={top} width={width} height={bottom - top} />
            {width >= MIN_GAP_LABEL && (
              <text
                className="chart-gap-label"
                x={left + width / 2}
                y={top + (bottom - top) / 2}
                textAnchor="middle"
              >
                {gap.label}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

export function TimeTicks({
  span,
  x,
  plotWidth,
  bottom,
  height,
}: {
  span: TimeSpan;
  x: (value: number) => number;
  plotWidth: number;
  bottom: number;
  height: number;
}) {
  const { tick, label } = axisDays(span.days, plotWidth);
  return (
    <>
      {tick.map((day) => (
        <line
          key={day.at}
          className={day.monday ? "chart-tick-mark monday" : "chart-tick-mark"}
          x1={x(day.at)}
          x2={x(day.at)}
          y1={bottom}
          y2={bottom + (day.monday ? 6 : 4)}
        />
      ))}
      {label.map((day) => (
        <text
          key={day.at}
          className="chart-tick"
          x={x(day.at)}
          y={height - TIME_PADDING.bottom + 18}
          textAnchor="middle"
        >
          {day.label}
        </text>
      ))}
    </>
  );
}

export function TimeCursor({
  span,
  x,
  top,
  bottom,
}: {
  span: TimeSpan;
  x: (value: number) => number;
  top: number;
  bottom: number;
}) {
  const { time } = useHoverTime();
  if (time === null || time < span.start || time > span.end) {
    return null;
  }
  return <line className="chart-cursor" x1={x(time)} x2={x(time)} y1={top} y2={bottom} />;
}

export function minorTicks(axis: number[], integer = false): number[] {
  const step = (axis[1] ?? 0) - (axis[0] ?? 0);
  const last = axis[axis.length - 1] ?? 0;
  if (step <= 0) {
    return [];
  }
  const lead = Math.round(step / 10 ** Math.floor(Math.log10(step)));
  let parts = lead === 2 ? 4 : 5;
  if (integer) {
    if (step < 2) {
      return [];
    }
    if (step / parts < 1) {
      parts = step;
    }
  }
  const minor = step / parts;
  const result: number[] = [];
  for (let index = 1; index * minor < last - 1e-9; index += 1) {
    if (index % parts !== 0) {
      result.push(index * minor);
    }
  }
  return result;
}

export function YTicks({
  axis,
  minor,
  y,
  left,
  top,
  bottom,
}: {
  axis: number[];
  minor: number[];
  y: (value: number) => number;
  left: number;
  top: number;
  bottom: number;
}) {
  return (
    <>
      <line className="chart-axis" x1={left} x2={left} y1={top} y2={bottom} />
      {axis.map((value) => (
        <line
          key={`major-${value}`}
          className="chart-tick-mark monday"
          x1={left - 5}
          x2={left}
          y1={y(value)}
          y2={y(value)}
        />
      ))}
      {minor.map((value) => (
        <line
          key={`minor-${value}`}
          className="chart-tick-mark"
          x1={left - 3}
          x2={left}
          y1={y(value)}
          y2={y(value)}
        />
      ))}
    </>
  );
}

export function Crosshair({
  x,
  y,
  left,
  right,
  top,
  bottom,
  vertical = false,
  horizontal = true,
}: {
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  vertical?: boolean;
  horizontal?: boolean;
}) {
  return (
    <g className="crosshair">
      {horizontal && <line className="chart-cursor" x1={left} x2={right} y1={y} y2={y} />}
      {vertical && <line className="chart-cursor" x1={x} x2={x} y1={top} y2={bottom} />}
      <circle className="crosshair-dot" cx={x} cy={y} r={3} />
    </g>
  );
}

export function CrosshairTip({
  x,
  y,
  width,
  text,
}: {
  x: number;
  y: number;
  width: number;
  text: string;
}) {
  return (
    <div
      className="crosshair-tip"
      style={x > width - 160 ? { right: width - x + 8, top: y + 8 } : { left: x + 8, top: y + 8 }}
    >
      {text}
    </div>
  );
}

export function dayMarks(pixelsPerDay: number, lastDay: number): number[] {
  const every = DAY_MARK_STEPS.find((step) => pixelsPerDay * step >= MIN_TICK_GAP);
  if (every === undefined) {
    return [];
  }
  const result: number[] = [];
  for (let day = every; day < lastDay; day += every) {
    result.push(day);
  }
  return result;
}
