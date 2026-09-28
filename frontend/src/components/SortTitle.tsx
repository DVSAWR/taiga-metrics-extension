import { useState } from "react";

export interface Sort {
  key: string;
  direction: "asc" | "desc";
}

export type SortValue = string | number | null;

export function nextSort(current: Sort | null, key: string): Sort | null {
  if (current?.key !== key) {
    return { key, direction: "asc" };
  }
  return current.direction === "asc" ? { key, direction: "desc" } : null;
}

export function useSort(): [Sort | null, (key: string) => void] {
  const [sort, setSort] = useState<Sort | null>(null);
  return [sort, (key) => setSort((current) => nextSort(current, key))];
}

export function sortRows<T>(
  rows: T[],
  sort: Sort | null,
  value: (row: T, key: string) => SortValue,
): T[] {
  if (!sort) {
    return rows;
  }
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a, sort.key);
    const right = value(b, sort.key);
    if (left === right) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * sign;
    }
    return String(left).localeCompare(String(right)) * sign;
  });
}

export function SortTitle({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: string;
  sort: Sort | null;
  onSort: (key: string) => void;
  className?: string;
}) {
  const direction = sort?.key === sortKey ? sort.direction : null;
  return (
    <button
      type="button"
      className={`team-sort${direction ? " sorted" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => onSort(sortKey)}
      title={
        direction === null
          ? "Sort from lowest to highest"
          : direction === "asc"
            ? "Sort from highest to lowest"
            : "Back to the usual order"
      }
    >
      <span className="team-sort-label">
        {label}
        {direction && (
          <svg className="team-sort-mark" viewBox="0 0 12 8" aria-hidden="true">
            <path d={direction === "asc" ? "M2 6.5L6 1.5L10 6.5Z" : "M2 1.5L6 6.5L10 1.5Z"} />
          </svg>
        )}
      </span>
    </button>
  );
}
