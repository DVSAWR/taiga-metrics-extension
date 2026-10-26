import { useEffect, useState } from "react";

import { fetchReporting, saveReporting, type Cadence, type ReportingSettings } from "../api";
import { Segmented } from "../components/Segmented";

const LENGTHS: { value: string; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "1", label: "1 week" },
  { value: "2", label: "2 weeks" },
  { value: "3", label: "3 weeks" },
  { value: "4", label: "4 weeks" },
];

function thisMonday(): string {
  const day = new Date();
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(
    day.getDate(),
  ).padStart(2, "0")}`;
}

export function ReportingSection({ slug }: { slug: string }) {
  const [settings, setSettings] = useState<ReportingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReporting(slug)
      .then((next) => !cancelled && setSettings(next))
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const save = (cadence: Cadence) => {
    setSettings((current) => current && { ...current, cadence });
    saveReporting(slug, cadence).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  if (!settings) {
    return error ? <div className="banner banner-fail">{error}</div> : null;
  }
  const { cadence } = settings;
  return (
    <section className="card section">
      <header className="card-header">
        <h2>Reporting periods</h2>
        <p>
          The equal stretches the sprint views cut time into: the Sprint choice of the period,
          Sprint in the period switches, and Period by period.
        </p>
      </header>
      {error && <div className="banner banner-fail">{error}</div>}
      {settings.scrum ? (
        <p className="form-rows muted">
          Taiga's Scrum is on in this project, so its {settings.taiga_sprints}{" "}
          {settings.taiga_sprints === 1 ? "sprint is" : "sprints are"} used.
          {settings.taiga_sprints === 0 ? " Create sprints in Taiga to see them here." : ""}
        </p>
      ) : (
        <div className="form-rows">
          <div className="form-row">
            <span className="form-label">Every</span>
            <Segmented
              label="Length of a reporting period"
              options={LENGTHS}
              value={cadence.weeks === null ? "off" : String(cadence.weeks)}
              onChange={(choice) =>
                save(
                  choice === "off"
                    ? { weeks: null, start: null }
                    : { weeks: Number(choice), start: cadence.start ?? thisMonday() },
                )
              }
            />
          </div>
          {cadence.weeks !== null && (
            <label className="form-row">
              <span className="form-label">First day</span>
              <input
                type="date"
                className="taiga-input reporting-start"
                value={cadence.start ?? ""}
                onChange={(event) =>
                  event.target.value && save({ ...cadence, start: event.target.value })
                }
              />
            </label>
          )}
          <p className="muted">
            {cadence.weeks === null
              ? "Taiga's Scrum is off, so there are no sprints. Pick a length to cut time into equal sprints anyway."
              : `Time is cut into sprints of ${cadence.weeks} ${
                  cadence.weeks === 1 ? "week" : "weeks"
                } from the first day up to the one running today, named Sprint 1, Sprint 2, and so on.`}
          </p>
        </div>
      )}
    </section>
  );
}
