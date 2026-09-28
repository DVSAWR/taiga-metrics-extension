import type { StayLevel } from "../api";

interface Badge {
  label: string;
  className: string;
  title: string;
}

const STAY_BADGES: Record<StayLevel, Badge> = {
  very_fast: {
    label: "Much faster",
    className: "badge-ok-strong",
    title: "Shorter than 95% of past stays in this status: rare",
  },
  fast: {
    label: "Faster",
    className: "badge-ok",
    title: "Shorter than 85% of past stays in this status",
  },
  long: {
    label: "Slower",
    className: "badge-accent",
    title: "Longer than 85% of past stays in this status",
  },
  very_long: {
    label: "Much slower",
    className: "badge-accent-strong",
    title: "Longer than 95% of past stays in this status: rare",
  },
  passed_through: {
    label: "Passed through",
    className: "badge-muted",
    title: "Left the status within 5 minutes: not counted as time spent there",
  },
};

export function StayBadge({ level, title }: { level: StayLevel | null; title?: string }) {
  if (!level) {
    return null;
  }
  const badge = STAY_BADGES[level];
  return (
    <span className={`badge ${badge.className}`} title={title ?? badge.title}>
      {badge.label}
    </span>
  );
}

export function StuckBadge({ level }: { level: "red" | "yellow" | null }) {
  if (level === null) {
    return null;
  }
  return level === "red" ? (
    <span
      className="badge badge-accent-strong"
      title="Longer than 95% of past stays in this status: rare"
    >
      Much slower
    </span>
  ) : (
    <span className="badge badge-accent" title="Longer than 85% of past stays in this status">
      Slower
    </span>
  );
}
