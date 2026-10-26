import { useEffect, useRef, useState } from "react";

const MONTHS = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const SHOWN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Month {
  year: number;
  month: number;
}

export interface DateRange {
  from: string | null;
  to: string | null;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parse(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoOf(date: Date): string {
  return iso(date.getFullYear(), date.getMonth(), date.getDate());
}

function todayIso(): string {
  return isoOf(new Date());
}

function monthOf(value: string): Month {
  const date = parse(value);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function shifted(base: Month, delta: number): Month {
  const next = new Date(base.year, base.month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoOf(date);
}

function presets(): { label: string; range: DateRange }[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return [
    { label: "Last 7 days", range: { from: daysAgo(6), to: todayIso() } },
    { label: "Last 30 days", range: { from: daysAgo(29), to: todayIso() } },
    { label: "Last 90 days", range: { from: daysAgo(89), to: todayIso() } },
    { label: "This month", range: { from: iso(year, month, 1), to: todayIso() } },
    {
      label: "Last month",
      range: { from: isoOf(new Date(year, month - 1, 1)), to: isoOf(new Date(year, month, 0)) },
    },
    { label: "This year", range: { from: iso(year, 0, 1), to: todayIso() } },
    { label: "All time", range: { from: null, to: null } },
  ];
}

function shownRange(range: DateRange): string | null {
  if (!range.from && !range.to) {
    return null;
  }
  const from = range.from ? SHOWN.format(parse(range.from)) : "the start";
  const to = range.to ? SHOWN.format(parse(range.to)) : "today";
  return `${from} - ${to}`;
}

function MonthTable({
  month,
  start,
  end,
  pending,
  hovered,
  onPick,
  onHover,
}: {
  month: Month;
  start: string | null;
  end: string | null;
  pending: string | null;
  hovered: string | null;
  onPick: (date: string) => void;
  onHover: (date: string | null) => void;
}) {
  const first = new Date(month.year, month.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(month.year, month.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );
  const today = todayIso();
  const [low, high] =
    pending !== null
      ? [pending, hovered ?? pending].sort()
      : [start ?? (end ? "0000-00-00" : null), end ?? (start ? today : null)];
  return (
    <table className="pika-table">
      <thead>
        <tr>
          {WEEKDAYS.map((day) => (
            <th key={day} scope="col">
              {day}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, index) => (
          <tr key={index}>
            {week.map((day, position) => {
              if (day === null) {
                return <td key={position} className="is-empty" />;
              }
              const date = iso(month.year, month.month, day);
              const inside = low !== null && high !== null && date >= low && date <= high;
              const edge = date === low || date === high;
              return (
                <td
                  key={position}
                  className={[
                    inside ? "is-in-range" : "",
                    inside && edge ? "is-selected" : "",
                    date === today ? "is-today" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className="pika-button"
                    onClick={() => onPick(date)}
                    onMouseEnter={() => onHover(date)}
                  >
                    {day}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DateRangePicker({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState<Month>(() =>
    shifted(monthOf(value.to ?? value.from ?? todayIso()), -1),
  );
  const [pending, setPending] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setPending(null);
      setHovered(null);
      return;
    }
    setLeft(shifted(monthOf(value.to ?? value.from ?? todayIso()), -1));
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const pick = (date: string) => {
    if (pending === null) {
      setPending(date);
      return;
    }
    const [from, to] = [pending, date].sort();
    onChange({ from: from ?? null, to: to ?? null });
    setOpen(false);
  };
  const choose = (range: DateRange) => {
    onChange(range);
    setOpen(false);
  };
  const months = [left, shifted(left, 1)];
  const shown = shownRange(value);

  return (
    <div className="date-picker" ref={root}>
      <button
        type="button"
        className={`taiga-input date-picker-input${shown ? "" : " empty"}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {shown ?? placeholder}
      </button>
      {open && (
        <div className="pika-single pika-range" role="dialog" aria-label={label}>
          <ul className="pika-presets">
            {presets().map((preset) => (
              <li key={preset.label}>
                <button type="button" onClick={() => choose(preset.range)}>
                  {preset.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="pika-months">
            <p className="pika-hint">
              {pending === null
                ? "Click the first day, then the last one."
                : `From ${SHOWN.format(parse(pending))}: now click the last day.`}
            </p>
            <div className="pika-pair" onMouseLeave={() => setHovered(null)}>
              {months.map((month, index) => (
                <div key={`${month.year}-${month.month}`} className="pika-month">
                  <div className="pika-title">
                    {index === 0 ? (
                      <button
                        type="button"
                        className="pika-prev"
                        aria-label="Previous month"
                        onClick={() => setLeft(shifted(left, -1))}
                      >
                        ‹
                      </button>
                    ) : (
                      <span className="pika-arrow-space" />
                    )}
                    <span className="pika-label">
                      {MONTHS.format(new Date(month.year, month.month, 1))}
                    </span>
                    {index === months.length - 1 ? (
                      <button
                        type="button"
                        className="pika-next"
                        aria-label="Next month"
                        onClick={() => setLeft(shifted(left, 1))}
                      >
                        ›
                      </button>
                    ) : (
                      <span className="pika-arrow-space" />
                    )}
                  </div>
                  <MonthTable
                    month={month}
                    start={value.from}
                    end={value.to}
                    pending={pending}
                    hovered={hovered}
                    onPick={pick}
                    onHover={setHovered}
                  />
                </div>
              ))}
            </div>
            {(value.from || value.to) && (
              <button
                type="button"
                className="pika-clear"
                onClick={() => choose({ from: null, to: null })}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
