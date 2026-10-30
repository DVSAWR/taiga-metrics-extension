import type { StuckCard } from "../api";
import { formatDuration } from "../charts/format";

export function AgingBadges({ card }: { card: StuckCard }) {
  return (
    <span className="aging-badges">
      {[
        { label: "Status time", level: card.status_level, p85: card.p85, p95: card.p95 },
        { label: "Age", level: card.age_level, p85: card.age_p85, p95: card.age_p95 },
      ].map(({ label, level, p85, p95 }) =>
        level ? (
          <span
            key={label}
            className={`badge ${level === "red" ? "badge-accent-strong" : "badge-accent"}`}
            title={`${label}: exceeds ${
              level === "red" ? "95%" : "85%"
            } of completed card observations. 85% within ${formatDuration(
              p85,
            )}, 95% within ${formatDuration(p95)}. At least 3 cards are required.`}
          >
            {label}: {level === "red" ? "much slower" : "slower"}
          </span>
        ) : null,
      )}
    </span>
  );
}
