import { useCallback, useEffect, useState } from "react";

import { SectionHeader } from "../components/SectionHeader";
import { fetchHealth, type HealthReport, type MetricsDbStatus, type TaigaStatus } from "../api";

type State = "ok" | "fail" | "none";

interface Row {
  label: string;
  value: string;
  state: State;
  details?: string[];
}

const numberFormat = new Intl.NumberFormat("en-US");

function stateOf(ok: boolean | undefined): State {
  if (ok === undefined) {
    return "none";
  }
  return ok ? "ok" : "fail";
}

function taigaRows(taiga: TaigaStatus): Row[] {
  const rows: Row[] = [
    {
      label: "Connection",
      value: taiga.connected ? "Connected" : "Not connected",
      state: stateOf(taiga.connected),
      details: taiga.error ? [taiga.error] : undefined,
    },
  ];
  if (!taiga.connected) {
    return rows;
  }
  const schema = taiga.schema_status;
  rows.push(
    {
      label: "Read-only session",
      value: taiga.read_only ? "Enforced" : "Not enforced",
      state: stateOf(taiga.read_only),
    },
    { label: "PostgreSQL", value: taiga.server_version ?? "-", state: "none" },
    {
      label: "Schema",
      value: schema?.compatible ? "Compatible" : "Incompatible",
      state: stateOf(schema?.compatible),
      details: schema
        ? [
            ...schema.missing_tables.map((table) => `Missing table ${table}`),
            ...schema.missing_columns.map((column) => `Missing column ${column}`),
          ]
        : undefined,
    },
  );
  if (taiga.counts) {
    rows.push(
      {
        label: "Projects",
        value: numberFormat.format(taiga.counts.projects),
        state: "none",
      },
      {
        label: "Users",
        value: numberFormat.format(taiga.counts.users),
        state: "none",
      },
      {
        label: "History entries",
        value: numberFormat.format(taiga.counts.history_entries),
        state: "none",
      },
    );
  }
  return rows;
}

function metricsDbRows(db: MetricsDbStatus): Row[] {
  const rows: Row[] = [
    {
      label: "Connection",
      value: db.connected ? "Connected" : "Not connected",
      state: stateOf(db.connected),
      details: db.error ? [db.error] : undefined,
    },
  ];
  if (db.connected) {
    rows.push({
      label: "Migrations",
      value: db.up_to_date
        ? `Up to date (${db.revision ?? "-"})`
        : `At ${db.revision ?? "none"}, latest is ${db.head_revision ?? "-"}`,
      state: stateOf(db.up_to_date),
    });
  }
  return rows;
}

function isHealthy(report: HealthReport): boolean {
  const { taiga, metrics_db: db } = report;
  return (
    taiga.connected &&
    taiga.read_only &&
    Boolean(taiga.schema_status?.compatible) &&
    db.connected &&
    db.up_to_date
  );
}

function StatusCard({ title, subtitle, rows }: { title: string; subtitle: string; rows: Row[] }) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      <dl className="rows">
        {rows.map((row) => (
          <div className="row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              <span className={`value value-${row.state}`}>
                {row.state !== "none" && <span className="dot" aria-hidden="true" />}
                {row.value}
              </span>
              {row.details && row.details.length > 0 && (
                <ul className="details">
                  {row.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function StatusSection({ slug }: { slug: string }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchHealth(slug));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCheckedAt(new Date());
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const healthy = report ? isHealthy(report) : false;

  return (
    <>
      <SectionHeader
        title="System status"
        subtitle={
          <>
            {checkedAt ? `Checked at ${checkedAt.toLocaleTimeString()}` : "Checking..."}
            {report && ` · Taiga Metrics v${report.version}`}
          </>
        }
        action={
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Checking..." : "Check again"}
          </button>
        }
      />

      {error && <div className="banner banner-fail">{error}</div>}

      {report && (
        <>
          <div className={`banner ${healthy ? "banner-ok" : "banner-fail"}`}>
            {healthy
              ? "Everything is ready: Taiga is readable and the extension database is up to date."
              : "Attention needed: see the failing checks below."}
          </div>
          <div className="grid">
            <StatusCard
              title="Taiga database"
              subtitle="Read directly, never written"
              rows={taigaRows(report.taiga)}
            />
            <StatusCard
              title="Extension database"
              subtitle="Settings and computed data"
              rows={metricsDbRows(report.metrics_db)}
            />
          </div>
        </>
      )}
    </>
  );
}
