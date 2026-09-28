const WIDTH = 96;
const HEIGHT = 28;
const PAD = 4;
const FLAT = "#b4b6c6";

export function Sparkline({
  values,
  weak,
  segments,
  label,
}: {
  values: (number | null)[];
  weak: boolean[];
  segments: string[];
  label: string;
}) {
  const known = values.filter((value): value is number => value !== null && value > 0);
  if (known.length === 0) {
    return null;
  }
  const floor = Math.min(...known);
  const low = Math.log(floor);
  const high = Math.log(Math.max(...known));
  const x = (index: number) =>
    values.length > 1 ? PAD + (index / (values.length - 1)) * (WIDTH - PAD * 2) : WIDTH / 2;
  const y = (value: number) =>
    high === low
      ? HEIGHT / 2
      : HEIGHT -
        PAD -
        ((Math.log(Math.max(value, floor)) - low) / (high - low)) * (HEIGHT - PAD * 2);
  const sorted = [...known].sort((a, b) => a - b);
  const median = sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)] ?? floor;
  const lastIndex = values.reduce<number>(
    (found, value, index) => (value === null ? found : index),
    -1,
  );
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <line className="sparkline-median" x1={PAD} x2={WIDTH - PAD} y1={y(median)} y2={y(median)} />
      {values.map((value, index) => {
        const previous = index > 0 ? values[index - 1] : null;
        return value === null || previous === null || previous === undefined ? null : (
          <line
            key={`segment-${index}`}
            className="sparkline-segment"
            x1={x(index - 1)}
            y1={y(previous)}
            x2={x(index)}
            y2={y(value)}
            stroke={segments[index] ?? FLAT}
          />
        );
      })}
      {values.map((value, index) =>
        value === null ? null : (
          <circle
            key={index}
            className={`sparkline-dot${weak[index] ? " weak" : ""}${
              index === lastIndex ? " last" : ""
            }`}
            cx={x(index)}
            cy={y(value)}
            r={index === lastIndex ? 3 : 1.6}
          />
        ),
      )}
    </svg>
  );
}
