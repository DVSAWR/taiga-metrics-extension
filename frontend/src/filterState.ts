import { useCallback, useEffect, useMemo, useState } from "react";

import { ALL_TIME, fetchSprints, type FilterSelection, type ItemType, type Period } from "./api";
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

const STORED_EVENT = "taiga-metrics:stored";

function usePersisted<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [state, setState] = useState(() => ({ key, value: readJson(key, fallback) }));
  const value = useMemo(
    () => (state.key === key ? state.value : readJson(key, fallback)),
    [state, key],
  );
  useEffect(() => {
    const refresh = () => setState({ key, value: readJson(key, fallback) });
    refresh();
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) {
        refresh();
      }
    };
    window.addEventListener(STORED_EVENT, changed);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STORED_EVENT, changed);
      window.removeEventListener("storage", refresh);
    };
  }, [key]);
  const update = useCallback(
    (next: T) => {
      setState({ key, value: next });
      writeStored(key, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(STORED_EVENT, { detail: key }));
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

const DEFAULT_DAYS = 28;
const defaults = new Map<string, Promise<Period>>();
const defaultDays = new Map<string, string>();
const defaultListeners = new Map<string, Set<(period: Period) => void>>();

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function lastDays(): Period {
  const start = new Date();
  start.setDate(start.getDate() - (DEFAULT_DAYS - 1));
  return { from: isoDay(start), to: isoDay(new Date()) };
}

export function defaultPeriod(slug: string): Promise<Period> {
  const known = defaults.get(slug);
  if (known && defaultDays.get(slug) === isoDay(new Date())) {
    return known;
  }
  return refreshDefaultPeriod(slug);
}

export function refreshDefaultPeriod(slug: string): Promise<Period> {
  const today = isoDay(new Date());
  const found = fetchSprints(slug)
    .then((sprints) => {
      const running = sprints.find(
        (sprint) =>
          sprint.start && sprint.finish && sprint.start <= today && today <= sprint.finish,
      );
      return running?.start && running.finish
        ? { from: running.start, to: running.finish }
        : lastDays();
    })
    .catch(() => lastDays());
  defaultDays.set(slug, today);
  defaults.set(slug, found);
  void found.then((period) => defaultListeners.get(slug)?.forEach((listener) => listener(period)));
  return found;
}

export function useDefaultPeriod(slug: string): Period | null {
  const [found, setFound] = useState<Period | null>(null);
  useEffect(() => {
    let cancelled = false;
    const listener = (period: Period) => {
      if (!cancelled) setFound(period);
    };
    const listeners = defaultListeners.get(slug) ?? new Set<(period: Period) => void>();
    listeners.add(listener);
    defaultListeners.set(slug, listeners);
    void defaultPeriod(slug).then((period) => !cancelled && setFound(period));
    const onFocus = () => {
      void defaultPeriod(slug);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      listeners.delete(listener);
      window.removeEventListener("focus", onFocus);
    };
  }, [slug]);
  return found;
}

export function usePeriod(slug: string) {
  const key = `period:${slug}`;
  const [period, setPeriod] = usePersisted<Period>(key, ALL_TIME);
  const current = useMemo(
    () => (period.days === "calendar" ? { ...period, days: "working" as const } : period),
    [period],
  );
  useEffect(() => {
    if (period.days === "calendar") setPeriod(current);
  }, [period, current, setPeriod]);
  useEffect(() => {
    if (readStored(key) !== null) {
      return;
    }
    let cancelled = false;
    void defaultPeriod(slug).then((found) => {
      if (!cancelled && readStored(key) === null) {
        setPeriod(found);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return [current, setPeriod] as const;
}

export function useItemType(slug: string, available: ItemType[]) {
  const [stored, setStored] = usePersisted<ItemType | null>(`item-type:${slug}`, null);
  const chosen =
    stored && available.includes(stored)
      ? stored
      : available.includes("userstory")
        ? "userstory"
        : available[0] ?? "userstory";
  return [chosen, setStored] as const;
}

export function selectionSize(selection: FilterSelection): number {
  return selection.include.length + selection.exclude.length;
}
