import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ALL_TIME,
  fetchFilterPanel,
  type FilterCategoryKey,
  type FilterPanelData,
  type FilterSelection,
  type ItemType,
  type Period,
} from "../api";
import {
  EMPTY_SELECTION,
  selectionSize,
  useCustomFilters,
  type CustomFilter,
} from "../filterState";
import { Icon } from "../icons";
import { UserPhoto } from "./UserPhoto";
import { hasPeriod, PeriodFilter } from "./PeriodFilter";

type Mode = "include" | "exclude";

const USER_CATEGORIES: FilterCategoryKey[] = ["assigned", "created_by"];

function valueKey(category: FilterCategoryKey, value: string): string {
  return `${category}:${value}`;
}

export function FilterButton({
  open,
  selection,
  period,
  onToggle,
}: {
  open: boolean;
  selection: FilterSelection;
  period?: Period;
  onToggle: () => void;
}) {
  const count = selectionSize(selection) + (hasPeriod(period) ? 1 : 0);
  return (
    <button type="button" className={`btn-filter${open ? " active" : ""}`} onClick={onToggle}>
      <Icon name="filters" />
      <span>{open ? "Hide filters" : "Filters"}</span>
      {count > 0 && <span className="selected-filters">{count}</span>}
    </button>
  );
}

function CustomFilters({
  slug,
  selection,
  onApply,
}: {
  slug: string;
  selection: FilterSelection;
  onApply: (selection: FilterSelection) => void;
}) {
  const [filters, setFilters] = useCustomFilters(slug);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const canAdd = selectionSize(selection) > 0;
  const activeName = filters.find(
    (filter) =>
      filter.include.join() === selection.include.join() &&
      filter.exclude.join() === selection.exclude.join(),
  )?.name;

  const save = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const next: CustomFilter = { name: trimmed, ...selection };
    setFilters([...filters.filter((filter) => filter.name !== trimmed), next]);
    setName("");
    setAdding(false);
  };

  return (
    <div className="custom-filters">
      <div className="custom-filters-header">
        <div className="custom-filters-title">
          <span className="name">Custom filters</span>
          <span className="number">({filters.length})</span>
        </div>
        {!adding && (
          <button
            type="button"
            className="add-custom-filter"
            disabled={!canAdd}
            onClick={() => setAdding(true)}
          >
            add
          </button>
        )}
      </div>
      {adding && (
        <form className="custom-filters-add-form" onSubmit={save}>
          <input
            className="add-filter-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setName("");
                setAdding(false);
              }
            }}
            placeholder="Write the filter name and press enter"
            aria-label="Write the filter name and press enter"
            autoFocus
          />
          <button type="submit" className="btn-small">
            Save filter
          </button>
        </form>
      )}
      {filters.length > 0 && (
        <div className="custom-filter-list">
          {filters.map((filter) => (
            <div
              key={filter.name}
              className={`single-filter single-filter-type-custom${
                filter.name === activeName ? " active" : ""
              }`}
            >
              <button
                type="button"
                className="name"
                onClick={() => onApply({ include: filter.include, exclude: filter.exclude })}
              >
                {filter.name}
              </button>
              <button
                type="button"
                className="remove-filter"
                aria-label={`Remove ${filter.name}`}
                title="Remove filter"
                onClick={() => setFilters(filters.filter((other) => other.name !== filter.name))}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AppliedFilters({
  selection,
  labels,
  onRemove,
}: {
  selection: FilterSelection;
  labels: Map<string, string>;
  onRemove: (mode: Mode, key: string) => void;
}) {
  if (selectionSize(selection) === 0) {
    return null;
  }
  const group = (mode: Mode, title: string, keys: string[]) =>
    keys.length > 0 && (
      <div className={mode === "include" ? "filters-included" : "filters-excluded"}>
        <div className="filters-title">{title}</div>
        <div className="filters-wrapper">
          {keys.map((key) => (
            <div key={key} className={`single-applied-filter ${mode}`}>
              <div className="name">{labels.get(key) ?? key.split(":")[1]}</div>
              <button
                type="button"
                className="remove-filter"
                aria-label="Remove filter"
                onClick={() => onRemove(mode, key)}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="filters-applied">
      {group("include", "Filtered by:", selection.include)}
      {group("exclude", "Excluded:", selection.exclude)}
    </div>
  );
}

export function FilterPanel({
  slug,
  itemType,
  selection,
  onChange,
  period,
  onPeriodChange,
}: {
  slug: string;
  itemType: ItemType | null;
  selection: FilterSelection;
  onChange: (selection: FilterSelection) => void;
  period?: Period;
  onPeriodChange?: (period: Period) => void;
}) {
  const [panel, setPanel] = useState<FilterPanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("include");
  const [openCategory, setOpenCategory] = useState<FilterCategoryKey | null>(null);
  const labels = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    fetchFilterPanel(slug, itemType, selection)
      .then((next) => {
        if (cancelled) {
          return;
        }
        next.categories.forEach((category) =>
          category.values.forEach((value) =>
            labels.current.set(valueKey(category.key, value.value), value.label),
          ),
        );
        setPanel(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType, selection]);

  const applied = new Set([...selection.include, ...selection.exclude]);

  const add = (key: string) => {
    if (applied.has(key)) {
      return;
    }
    onChange({
      include: mode === "include" ? [...selection.include, key] : selection.include,
      exclude: mode === "exclude" ? [...selection.exclude, key] : selection.exclude,
    });
  };

  const remove = (from: Mode, key: string) => {
    onChange({
      include: from === "include" ? selection.include.filter((k) => k !== key) : selection.include,
      exclude: from === "exclude" ? selection.exclude.filter((k) => k !== key) : selection.exclude,
    });
  };

  const canReset = selectionSize(selection) > 0 || hasPeriod(period) || mode !== "include";
  const reset = () => {
    onChange(EMPTY_SELECTION);
    onPeriodChange?.(ALL_TIME);
    setMode("include");
    setOpenCategory(null);
  };

  return (
    <aside className="filter-panel">
      <div className="filter-reset-row">
        <button
          type="button"
          className="link-button filter-reset"
          disabled={!canReset}
          title="Clear every filter and the period"
          onClick={reset}
        >
          Reset all filters
        </button>
      </div>
      <CustomFilters slug={slug} selection={selection} onApply={onChange} />
      {period && onPeriodChange && (
        <PeriodFilter slug={slug} period={period} onChange={onPeriodChange} />
      )}
      <div className="filters-step-cat">
        <AppliedFilters selection={selection} labels={labels.current} onRemove={remove} />
        <div className="filters-advanced">
          <div className="filters-advanced-form" role="radiogroup" aria-label="Filter mode">
            {(["include", "exclude"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                className={`filter-mode ${option}${mode === option ? " active" : ""}`}
                onClick={() => setMode(option)}
              >
                <span className="radio-mark">
                  <span className="radio-mark-inner" />
                </span>
                <span>{option === "include" ? "Include" : "Exclude"}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <p className="filter-error">{error}</p>}
        <div className="filters-cats">
          <ul>
            {panel?.categories.map((category) => {
              const isOpen = openCategory === category.key;
              return (
                <li key={category.key} className={isOpen ? "selected" : ""}>
                  <button
                    type="button"
                    className={`filters-cat-single${isOpen ? " selected" : ""}`}
                    onClick={() => setOpenCategory(isOpen ? null : category.key)}
                  >
                    <span className="title">{category.title}</span>
                    <Icon name={isOpen ? "arrowDown" : "arrowRight"} />
                  </button>
                  {isOpen && (
                    <div className="filter-list">
                      {category.values.length === 0 && (
                        <p className="filter-empty">Nothing to filter by</p>
                      )}
                      {category.values.map((value) => {
                        const key = valueKey(category.key, value.value);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`single-filter${applied.has(key) ? " applied" : ""}`}
                            style={value.color ? { borderLeftColor: value.color } : undefined}
                            disabled={applied.has(key)}
                            onClick={() => add(key)}
                          >
                            {USER_CATEGORIES.includes(category.key) && (
                              <span className="user-pic">
                                <UserPhoto
                                  userId={/^\d+$/.test(value.value) ? Number(value.value) : null}
                                />
                              </span>
                            )}
                            <span className="name">{value.label}</span>
                            {value.count > 0 && <span className="number">{value.count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {panel && selectionSize(selection) > 0 && (
          <p className="filter-summary">
            {panel.matching} of {panel.total} cards match
          </p>
        )}
      </div>
    </aside>
  );
}
