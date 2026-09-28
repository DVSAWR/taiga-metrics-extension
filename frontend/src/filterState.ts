import { useCallback, useEffect, useState } from "react";

import { ALL_TIME, type FilterSelection, type Period } from "./api";
import { readStored, writeStored } from "./storage";

export const EMPTY_SELECTION: FilterSelection = { include: [], exclude: [] };

export interface CustomFilter {
  name: string;
  include: string[];
  exclude: string[];
}

function readJson<T>(key: string, fallback: T): T {
  const raw = readStored(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function usePersisted<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readJson(key, fallback));
  useEffect(() => {
    setValue(readJson(key, fallback));
  }, [key]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeStored(key, JSON.stringify(next));
    },
    [key],
  );
  return [value, update];
}

export function useFilterSelection(slug: string) {
  return usePersisted<FilterSelection>(`filters:${slug}`, EMPTY_SELECTION);
}

export function useCustomFilters(slug: string) {
  return usePersisted<CustomFilter[]>(`custom-filters:${slug}`, []);
}

export function usePeriod(slug: string) {
  return usePersisted<Period>(`period:${slug}`, ALL_TIME);
}

export function useFiltersOpen() {
  return usePersisted<boolean>("filters-open", false);
}

export function selectionSize(selection: FilterSelection): number {
  return selection.include.length + selection.exclude.length;
}
