function unit(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatDuration(days: number | null): string {
  if (days === null) {
    return "-";
  }
  const minutes = Math.round(days * 1440);
  if (minutes === 0 && days > 0) {
    return "< 1 min";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const whole = Math.floor(minutes / 1440);
  const hours = Math.round((minutes % 1440) / 60);
  if (whole >= 10 || hours === 0) {
    return unit(Math.round(days), "day", "days");
  }
  if (hours === 24) {
    return unit(whole + 1, "day", "days");
  }
  return `${unit(whole, "day", "days")} ${hours} h`;
}

export function niceStep(max: number, targetTicks = 4): number {
  if (max <= 0) {
    return 1;
  }
  const raw = max / targetTicks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

export function ticks(max: number, targetTicks = 4): number[] {
  const step = niceStep(max, targetTicks);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const result: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    result.push(Number(value.toPrecision(12)));
  }
  return result;
}

const MINUTE = 1 / 1440;

export interface Bin {
  from: number;
  to: number;
  count: number;
  label: string;
}

export function histogram(values: number[], maxBins = 10): Bin[] {
  if (values.length === 0) {
    return [];
  }
  const max = Math.max(...values);
  const step = Math.max(MINUTE, niceStep(max, Math.min(maxBins, Math.max(3, values.length))));
  const count = Math.max(1, Math.ceil(max / step + 1e-9));
  const bins: Bin[] = Array.from({ length: count }, (_, index) => ({
    from: index * step,
    to: (index + 1) * step,
    count: 0,
    label: `${formatDuration(index * step)} to ${formatDuration((index + 1) * step)}`,
  }));
  for (const value of values) {
    const index = Math.min(count - 1, Math.floor(value / step));
    const bin = bins[index];
    if (bin) {
      bin.count += 1;
    }
  }
  return bins;
}

const ADAPTIVE_UNITS: [string, number][] = [
  ["w", 10080],
  ["d", 1440],
  ["h", 60],
  ["min", 1],
];

export function formatAdaptive(days: number | null): string {
  if (days === null) {
    return "-";
  }
  const minutes = Math.round(days * 1440);
  if (minutes === 0) {
    return days > 0 ? "< 1 min" : "0 min";
  }
  const at = ADAPTIVE_UNITS.findIndex(([, size]) => minutes >= size);
  const [name, size] = ADAPTIVE_UNITS[at] ?? ["min", 1];
  const big = Math.floor(minutes / size);
  const next = ADAPTIVE_UNITS[at + 1];
  const small = next ? Math.floor((minutes - big * size) / next[1]) : 0;
  return next && small > 0 ? `${big} ${name} ${small} ${next[0]}` : `${big} ${name}`;
}

export function fillWidth(percent: number): { width: string; minWidth?: number } {
  return percent > 0 ? { width: `${percent}%` } : { width: "0%", minWidth: 0 };
}
