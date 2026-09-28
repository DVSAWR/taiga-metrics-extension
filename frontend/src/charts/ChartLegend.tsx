import { TREND_BAD, TREND_FLAT, TREND_GOOD } from "./timeAxis";

export interface LegendItem {
  name: string;
  color: string;
  kind: "dot" | "hollow" | "bar" | "line" | "dashed" | "trend";
  risingIsGood?: boolean;
  onClick?: () => void;
  onHover?: (hovered: boolean) => void;
  active?: boolean;
}

function Swatch({ item }: { item: LegendItem }) {
  if (item.kind === "trend") {
    return (
      <svg width="30" height="10" aria-hidden="true">
        <line
          x1="1"
          x2="10"
          y1="8"
          y2="3"
          stroke={item.risingIsGood ? TREND_GOOD : TREND_BAD}
          strokeWidth="2"
        />
        <line x1="10" x2="20" y1="3" y2="3" stroke={TREND_FLAT} strokeWidth="2" />
        <line
          x1="20"
          x2="29"
          y1="3"
          y2="8"
          stroke={item.risingIsGood ? TREND_BAD : TREND_GOOD}
          strokeWidth="2"
        />
      </svg>
    );
  }
  if (item.kind === "dot" || item.kind === "hollow") {
    return (
      <svg width="12" height="12" aria-hidden="true">
        <circle
          cx="6"
          cy="6"
          r="4"
          fill={item.kind === "dot" ? item.color : "none"}
          fillOpacity={item.kind === "dot" ? 0.6 : undefined}
          stroke={item.color}
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (item.kind === "bar") {
    return (
      <svg width="12" height="12" aria-hidden="true">
        <rect x="1" y="1" width="10" height="10" rx="2" fill={item.color} />
      </svg>
    );
  }
  return (
    <svg width="22" height="10" aria-hidden="true">
      <line
        x1="1"
        x2="21"
        y1="5"
        y2="5"
        stroke={item.color}
        strokeWidth="2"
        strokeDasharray={item.kind === "dashed" ? "4 3" : undefined}
      />
    </svg>
  );
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="line-legend">
      {items.map((item) => (
        <li key={item.name}>
          <Swatch item={item} />
          {item.onClick ? (
            <button
              type="button"
              className={`legend-link${item.active ? " active" : ""}`}
              onClick={item.onClick}
              onPointerEnter={() => item.onHover?.(true)}
              onPointerLeave={() => item.onHover?.(false)}
            >
              {item.name}
            </button>
          ) : (
            item.name
          )}
        </li>
      ))}
    </ul>
  );
}
