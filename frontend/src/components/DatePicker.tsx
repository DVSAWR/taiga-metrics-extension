import { useEffect, useRef, useState } from "react";

const MONTHS = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const SHOWN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parse(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function todayIso(): string {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth(), now.getDate());
}

export function DatePicker({
  label,
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  min?: string | null;
  max?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const base = parse(value ?? todayIso());
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const base = parse(value ?? todayIso());
    setMonth({ year: base.getFullYear(), month: base.getMonth() });
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
  const shift = (delta: number) =>
    setMonth(({ year, month: current }) => {
      const next = new Date(year, current + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  return (
    <div className="date-picker" ref={root}>
      <button
        type="button"
        className={`taiga-input date-picker-input${value ? "" : " empty"}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {value ? SHOWN.format(parse(value)) : placeholder}
      </button>
      {open && (
        <div className="pika-single" role="dialog" aria-label={label}>
          <div className="pika-title">
            <button
              type="button"
              className="pika-prev"
              aria-label="Previous month"
              onClick={() => shift(-1)}
            >
              ‹
            </button>
            <span className="pika-label">{MONTHS.format(first)}</span>
            <button
              type="button"
              className="pika-next"
              aria-label="Next month"
              onClick={() => shift(1)}
            >
              ›
            </button>
          </div>
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
                    const disabled = Boolean((min && date < min) || (max && date > max));
                    return (
                      <td
                        key={position}
                        className={[
                          date === value ? "is-selected" : "",
                          date === today ? "is-today" : "",
                          disabled ? "is-disabled" : "",
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          className="pika-button"
                          disabled={disabled}
                          onClick={() => {
                            onChange(date);
                            setOpen(false);
                          }}
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
          {value && (
            <button
              type="button"
              className="pika-clear"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
