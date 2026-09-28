import { ALL_TIME, type DayKind, type Period } from "../api";
import { DatePicker } from "./DatePicker";
import { Segmented } from "./Segmented";
import { SprintSelect } from "./SprintSelect";

export function hasPeriod(period: Period | undefined): boolean {
  return Boolean(period?.from || period?.to);
}

const DAY_KINDS: { value: DayKind; label: string }[] = [
  { value: "working", label: "Working" },
  { value: "calendar", label: "Calendar" },
];

export function PeriodFilter({
  slug,
  period,
  onChange,
  withDays = true,
}: {
  slug: string;
  period: Period;
  onChange: (period: Period) => void;
  withDays?: boolean;
}) {
  const update = (side: "from" | "to", value: string) =>
    onChange({ ...period, [side]: value || null });
  return (
    <div className="filter-period">
      <div className="filter-period-header">
        <span className="name">Period</span>
        {hasPeriod(period) && (
          <button
            type="button"
            className="add-custom-filter"
            onClick={() => onChange({ ...ALL_TIME, days: period.days })}
          >
            reset
          </button>
        )}
      </div>
      <div className="filter-period-fields">
        <SprintSelect slug={slug} period={period} onChange={onChange} />
        <div className="filter-period-row">
          <span>From</span>
          <DatePicker
            label="Period start"
            placeholder="Start date"
            value={period.from}
            max={period.to}
            onChange={(value) => update("from", value ?? "")}
          />
        </div>
        <div className="filter-period-row">
          <span>To</span>
          <DatePicker
            label="Period end"
            placeholder="End date"
            value={period.to}
            min={period.from}
            onChange={(value) => update("to", value ?? "")}
          />
        </div>
        {withDays && (
          <div
            className="filter-period-row filter-period-days"
            title="Working days skip the days off set in the project calendar; calendar days count every day"
          >
            <span>Days</span>
            <Segmented
              label="Count durations in"
              options={DAY_KINDS}
              value={period.days ?? "working"}
              onChange={(days) => onChange({ ...period, days })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
