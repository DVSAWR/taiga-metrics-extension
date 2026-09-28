import { useEffect, useState } from "react";

import { ALL_TIME, fetchSprints, type Period, type Sprint } from "../api";
import { Dropdown } from "./Dropdown";

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const ALL = "all";
const OWN = "own";

function dates(sprint: Sprint): string {
  if (!sprint.start || !sprint.finish) {
    return "no dates";
  }
  return `${shortDate.format(new Date(sprint.start))} - ${shortDate.format(
    new Date(sprint.finish),
  )}`;
}

export function useSprints(slug: string): Sprint[] {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchSprints(slug)
      .then((next) => {
        if (!cancelled) {
          setSprints(next.filter((sprint) => sprint.start && sprint.finish));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSprints([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return sprints;
}

export function SprintSelect({
  slug,
  period,
  onChange,
  className,
}: {
  slug: string;
  period: Period;
  onChange: (period: Period) => void;
  className?: string;
}) {
  const sprints = useSprints(slug);
  if (sprints.length === 0) {
    return null;
  }
  const current = sprints.find(
    (sprint) => sprint.start === period.from && sprint.finish === period.to,
  );
  const custom = !current && Boolean(period.from || period.to);
  const options = [
    { value: ALL, label: "All time" },
    ...(custom ? [{ value: OWN, label: "Own dates" }] : []),
    ...sprints.map((sprint) => ({
      value: String(sprint.id),
      label: `${sprint.name} (${dates(sprint)})`,
    })),
  ];
  return (
    <Dropdown
      label="Sprint"
      className={className}
      value={current ? String(current.id) : custom ? OWN : ALL}
      options={options}
      onChange={(value) => {
        if (value === OWN) {
          return;
        }
        const sprint = sprints.find((candidate) => String(candidate.id) === value);
        onChange({
          ...(sprint ? { from: sprint.start, to: sprint.finish } : ALL_TIME),
          days: period.days,
        });
      }}
    />
  );
}
