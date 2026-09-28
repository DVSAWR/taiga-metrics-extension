import { useEffect, useState } from "react";

import { fetchSwimlanes, type FilterSelection, type ItemType, type Swimlanes } from "../api";
import { Dropdown } from "./Dropdown";

const ALL = "all";
const PREFIX = "swimlane:";
const NONE = "none";
export const UNCLASSIFIED = "Unclassified user stories";

export function useSwimlanes(slug: string, itemType: ItemType | null): Swimlanes | null {
  const [swimlanes, setSwimlanes] = useState<Swimlanes | null>(null);
  useEffect(() => {
    if (itemType === null) {
      setSwimlanes(null);
      return;
    }
    let cancelled = false;
    fetchSwimlanes(slug, itemType)
      .then((next) => {
        if (!cancelled) {
          setSwimlanes(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSwimlanes(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType]);
  return swimlanes;
}

export function SwimlaneSelect({
  swimlanes,
  selection,
  onChange,
}: {
  swimlanes: Swimlanes | null;
  selection: FilterSelection;
  onChange: (selection: FilterSelection) => void;
}) {
  if (!swimlanes || swimlanes.lanes.length === 0) {
    return null;
  }
  const chosen = selection.include.filter((key) => key.startsWith(PREFIX));
  const excluded = selection.exclude.some((key) => key.startsWith(PREFIX));
  const value = chosen.length === 1 && !excluded ? chosen[0]?.slice(PREFIX.length) ?? ALL : ALL;
  const mixed = chosen.length > 1 || excluded;
  const options = [
    { value: ALL, label: mixed ? "Several swimlanes" : "All swimlanes" },
    { value: NONE, label: UNCLASSIFIED },
    ...swimlanes.lanes.map((lane) => ({ value: String(lane.id), label: lane.name })),
  ];
  return (
    <Dropdown
      label="Swimlane"
      value={value}
      options={options}
      onChange={(next) =>
        onChange({
          include: [
            ...selection.include.filter((key) => !key.startsWith(PREFIX)),
            ...(next === ALL ? [] : [`${PREFIX}${next}`]),
          ],
          exclude: selection.exclude.filter((key) => !key.startsWith(PREFIX)),
        })
      }
    />
  );
}
