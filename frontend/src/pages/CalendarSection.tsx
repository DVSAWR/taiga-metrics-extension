import { useEffect, useMemo, useState } from "react";

import {
  fetchCalendar,
  saveCalendar,
  saveMemberDays,
  type CalendarSettings,
  type MemberCalendar,
} from "../api";
import { Toggle } from "../components/Toggle";
import { SectionHeader } from "../components/SectionHeader";

const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 7, label: "Sun" },
];

function timeZones(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return Array.from(new Set(["UTC", current, ...supported])).sort();
}

function toggle(days: number[], day: number): number[] {
  return days.includes(day)
    ? days.filter((other) => other !== day)
    : [...days, day].sort((a, b) => a - b);
}

function DayPicker({
  days,
  onChange,
  label,
  disabled = false,
}: {
  days: number[];
  onChange: (days: number[]) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`segmented day-picker${disabled ? " day-picker-inherited" : ""}`}
      role="group"
      aria-label={label}
    >
      {WEEKDAYS.map(({ day, label: name }) => (
        <button
          key={day}
          type="button"
          disabled={disabled}
          aria-pressed={days.includes(day)}
          className={days.includes(day) ? "active" : ""}
          onClick={() => onChange(toggle(days, day))}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function CalendarSection({ slug }: { slug: string }) {
  const [calendar, setCalendar] = useState<CalendarSettings | null>(null);
  const [timezone, setTimezone] = useState("UTC");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCalendar(slug)
      .then((next) => {
        if (!cancelled) {
          setCalendar(next);
          setTimezone(next.timezone);
          setDays(next.working_days);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const zones = useMemo(() => timeZones(timezone), [timezone]);

  const persist = async (nextTimezone: string, nextDays: number[]) => {
    setTimezone(nextTimezone);
    setDays(nextDays);
    if (nextDays.length === 0) {
      return;
    }
    try {
      await saveCalendar(slug, nextTimezone, nextDays);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const setMember = (member: MemberCalendar, workingDays: number[] | null) => {
    setCalendar(
      (current) =>
        current && {
          ...current,
          members: current.members.map((other) =>
            other.user_id === member.user_id ? { ...other, working_days: workingDays } : other,
          ),
        },
    );
    if (workingDays !== null && workingDays.length === 0) {
      return;
    }
    saveMemberDays(slug, member.user_id, workingDays).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <>
      <SectionHeader
        title="Calendar"
        subtitle="Working days used for durations; the time zone sets where days and weeks start."
      />
      {error && <div className="banner banner-fail">{error}</div>}
      {!calendar && !error && <p className="muted">Loading...</p>}
      {calendar && (
        <>
          <section className="card">
            <header className="card-header">
              <h2>Project calendar</h2>
              <p>Applies to every card, and to members without their own days</p>
            </header>
            <div className="form-rows">
              <label className="form-row">
                <span className="form-label">Time zone</span>
                <select
                  className="select"
                  value={timezone}
                  onChange={(event) => void persist(event.target.value, days)}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <span className="form-label">Working days</span>
                <DayPicker
                  days={days}
                  onChange={(next) => void persist(timezone, next)}
                  label="Project working days"
                />
              </div>
              {days.length === 0 && <p className="form-error">Pick at least one working day.</p>}
            </div>
          </section>

          <section className="card section">
            <header className="card-header">
              <h2>Members</h2>
              <p>
                Give someone their own working days, for example a four-day week. Their time on a
                card follows their days.
              </p>
            </header>
            <table className="table calendar-members">
              <colgroup>
                <col />
                <col className="col-role" />
                <col className="col-own" />
                <col className="col-days" />
              </colgroup>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Own days</th>
                  <th>Working days</th>
                </tr>
              </thead>
              <tbody>
                {calendar.members.map((member) => {
                  const own = member.working_days !== null;
                  return (
                    <tr key={member.user_id}>
                      <td className="role-name">{member.name}</td>
                      <td>{member.role || "-"}</td>
                      <td>
                        <Toggle
                          checked={own}
                          onChange={(checked) => setMember(member, checked ? [...days] : null)}
                          label={
                            own
                              ? `${member.name} follows their own days; switch off to use the project calendar`
                              : `${member.name} follows the project calendar; switch on to give them their own days`
                          }
                        />
                      </td>
                      <td>
                        <DayPicker
                          days={own ? member.working_days ?? [] : days}
                          onChange={(next) => setMember(member, next)}
                          label={
                            own
                              ? `Working days of ${member.name}`
                              : `${member.name} follows the project calendar`
                          }
                          disabled={!own}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
