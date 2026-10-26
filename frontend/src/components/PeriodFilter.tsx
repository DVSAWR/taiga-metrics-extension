import type { Period } from "../api";
import { refreshDefaultPeriod, useDefaultPeriod } from "../filterState";
import { DateRangePicker } from "./DatePicker";
import { SprintSelect } from "./SprintSelect";

export function samePeriod(one: Period | null | undefined, other: Period | null): boolean {
  return Boolean(one && other && one.from === other.from && one.to === other.to);
}

export function hasPeriod(period: Period | undefined): boolean {
  return Boolean(period?.from || period?.to);
}

export function PeriodFilter({
  slug,
  period,
  onChange,
}: {
  slug: string;
  period: Period;
  onChange: (period: Period) => void;
}) {
  const defaults = useDefaultPeriod(slug);
  return (
    <div className="filter-period">
      <div className="filter-period-header">
        <span className="name">Period</span>
        {defaults && !samePeriod(period, defaults) && (
          <button
            type="button"
            className="add-custom-filter"
            title="Back to the current reporting period"
            onClick={() => {
              void refreshDefaultPeriod(slug).then((current) =>
                onChange({ ...current, days: period.days }),
              );
            }}
          >
            reset
          </button>
        )}
      </div>
      <div className="filter-period-fields">
        <SprintSelect slug={slug} period={period} onChange={onChange} />
        <DateRangePicker
          label="Period"
          placeholder="All time"
          value={{ from: period.from, to: period.to }}
          onChange={(range) => onChange({ ...period, from: range.from, to: range.to })}
        />
      </div>
    </div>
  );
}
