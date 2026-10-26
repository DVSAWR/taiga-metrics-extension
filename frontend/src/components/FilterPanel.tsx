import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  fetchFilterPanel,
  fetchDirections,
  fetchPeopleSummary,
  type DirectionRef,
  type FilterCategoryKey,
  type FilterPanelData,
  type FilterSelection,
  type ItemType,
  type Period,
} from "../api";
import {
  EMPTY_SELECTION,
  selectionSize,
  refreshDefaultPeriod,
  useCustomFilters,
  type CustomFilter,
  useDefaultPeriod,
} from "../filterState";
import { Icon } from "../icons";
import { TYPE_LABELS } from "../modules";
import { Toggle } from "./Toggle";
import { UserPhoto } from "./UserPhoto";
import { PeriodFilter, samePeriod } from "./PeriodFilter";
import { ProjectPicker } from "./ProjectPicker";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { navigate, peoplePath, personPath, rolePath } from "../router";

type Mode = "include" | "exclude";

const USER_CATEGORIES: FilterCategoryKey[] = ["assigned", "created_by"];

function valueKey(category: FilterCategoryKey, value: string): string {
  return `${category}:${value}`;
}

export interface TypeChoice {
  types: ItemType[];
  value: ItemType;
  onChange: (type: ItemType) => void;
}

function TypePicker({ choice }: { choice: TypeChoice }) {
  if (choice.types.length < 2) {
    return null;
  }
  return (
    <div className="type-picker" role="radiogroup" aria-label="Card type">
      {choice.types.map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={type === choice.value}
          className={`type-pick${type === choice.value ? " active" : ""}`}
          onClick={() => choice.onChange(type)}
        >
          {TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}

function RolePicker({ slug, roleId }: { slug: string; roleId: number | null }) {
  const [roles, setRoles] = useState<DirectionRef[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchDirections(slug)
      .then((next) => {
        if (!cancelled) setRoles(next);
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return (
    <div className="filter-role-picker">
      <span className="filter-role-label">Role</span>
      <Dropdown
        label="Role"
        value={roleId === null ? "all" : String(roleId)}
        placeholder={roleId === null ? "All roles" : `Role ${roleId}`}
        options={[
          { value: "all", label: "All roles" },
          ...roles.map((role) => ({ value: String(role.role_id), label: role.name })),
        ]}
        onChange={(value) => navigate(rolePath(slug, value === "all" ? null : Number(value)))}
      />
    </div>
  );
}

function PersonPicker({
  slug,
  personId,
  itemType,
  period,
}: {
  slug: string;
  personId: number | null;
  itemType: ItemType;
  period: Period;
}) {
  const [people, setPeople] = useState<{ user_id: number; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchPeopleSummary(slug, itemType, period)
      .then((next) => {
        if (!cancelled) setPeople(next);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, itemType, period]);
  return (
    <div className="filter-person-picker">
      <span className="filter-role-label">Person</span>
      <Dropdown
        label="Person"
        value={personId === null ? "all" : String(personId)}
        placeholder={personId === null ? "All people" : `Person #${personId}`}
        options={[
          { value: "all", label: "All people" },
          ...[...people]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((person) => ({
              value: String(person.user_id),
              label: person.name,
            })),
        ]}
        onChange={(value) =>
          navigate(value === "all" ? peoplePath(slug) : personPath(slug, Number(value)))
        }
      />
    </div>
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
  compare,
  typeChoice,
  roleId,
  personId,
}: {
  slug: string;
  itemType: ItemType | null;
  selection: FilterSelection;
  onChange: (selection: FilterSelection) => void;
  period?: Period;
  onPeriodChange?: (period: Period) => void;
  compare?: { checked: boolean; onChange: (checked: boolean) => void };
  typeChoice?: TypeChoice;
  roleId?: number | null;
  personId?: number | null;
}) {
  const [panel, setPanel] = useState<FilterPanelData | null>(null);
  const defaults = useDefaultPeriod(slug);
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

  const canReset =
    selectionSize(selection) > 0 ||
    Boolean(period && defaults && !samePeriod(period, defaults)) ||
    (roleId !== undefined && roleId !== null) ||
    (personId !== undefined && personId !== null) ||
    mode !== "include";
  const reset = () => {
    onChange(EMPTY_SELECTION);
    if (period && onPeriodChange) {
      void refreshDefaultPeriod(slug).then((current) =>
        onPeriodChange({ ...current, days: period.days }),
      );
    }
    setMode("include");
    setOpenCategory(null);
    if (roleId !== undefined && roleId !== null) {
      navigate(rolePath(slug));
    }
    if (personId !== undefined && personId !== null) {
      navigate(peoplePath(slug));
    }
  };

  return (
    <aside className="filter-panel">
      <ProjectPicker slug={slug} />
      {typeChoice && <TypePicker choice={typeChoice} />}
      {roleId !== undefined && <RolePicker slug={slug} roleId={roleId} />}
      {personId !== undefined && itemType && period && (
        <PersonPicker slug={slug} personId={personId} itemType={itemType} period={period} />
      )}
      <div className="filter-reset-row">
        <button
          type="button"
          className="link-button filter-reset"
          disabled={!canReset}
          title="Clear every filter and go back to the current period"
          onClick={reset}
        >
          Reset all filters
        </button>
      </div>
      {compare && (
        <label
          className={`check-line filter-compare${selectionSize(selection) > 0 ? "" : " disabled"}`}
          title="Show what the filters leave out next to what they select. With people or roles: the time anyone else was assigned on the same cards; otherwise every other card."
        >
          <Toggle
            checked={compare.checked && selectionSize(selection) > 0}
            disabled={selectionSize(selection) === 0}
            onChange={compare.onChange}
            label="Compare with the rest"
          />
          <span>
            Compare with the rest
            {selectionSize(selection) === 0 && (
              <span className="filter-compare-hint">pick a filter first</span>
            )}
          </span>
        </label>
      )}
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

export function PeriodPanel({
  slug,
  period,
  onPeriodChange,
  typeChoice,
  roleId,
  personId,
  activityChoice,
}: {
  slug: string;
  period: Period;
  onPeriodChange: (period: Period) => void;
  typeChoice?: TypeChoice;
  roleId?: number | null;
  personId?: number | null;
  activityChoice?: {
    value: string;
    defaultValue: string;
    options: DropdownOption[];
    onChange: (value: string) => void;
  };
}) {
  const defaults = useDefaultPeriod(slug);
  return (
    <aside className="filter-panel">
      <ProjectPicker slug={slug} />
      {typeChoice && <TypePicker choice={typeChoice} />}
      {roleId !== undefined && <RolePicker slug={slug} roleId={roleId} />}
      {personId !== undefined && typeChoice && (
        <PersonPicker
          slug={slug}
          personId={personId}
          itemType={typeChoice.value}
          period={period}
        />
      )}
      {activityChoice && (
        <div className="filter-activity-picker">
          <span className="filter-role-label">Whose activity</span>
          <Dropdown
            label="Whose activity"
            value={activityChoice.value}
            options={activityChoice.options}
            onChange={activityChoice.onChange}
          />
        </div>
      )}
      <div className="filter-reset-row">
        <button
          type="button"
          className="link-button filter-reset"
          disabled={
            samePeriod(period, defaults) &&
            (roleId === null || roleId === undefined) &&
            (personId === null || personId === undefined) &&
            (!activityChoice || activityChoice.value === activityChoice.defaultValue)
          }
          title="Reset selection and go back to the current period"
          onClick={() => {
            void refreshDefaultPeriod(slug).then((current) =>
              onPeriodChange({ ...current, days: period.days }),
            );
            if (roleId !== undefined && roleId !== null) navigate(rolePath(slug));
            if (personId !== undefined && personId !== null) navigate(peoplePath(slug));
            if (activityChoice) activityChoice.onChange(activityChoice.defaultValue);
          }}
        >
          Reset all filters
        </button>
      </div>
      <PeriodFilter slug={slug} period={period} onChange={onPeriodChange} />
    </aside>
  );
}
