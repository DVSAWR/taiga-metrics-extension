import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchSyncRuns,
  fetchSyncSummary,
  startSync,
  type SyncRun,
  type SyncSummary,
} from "../api";
import { SectionHeader } from "../components/SectionHeader";
import { TextLink } from "../components/TextLink";
import { formatDateTime, formatDuration, formatNumber, ITEM_TYPE_LABELS } from "../format";
import { projectPath } from "../router";

const POLL_INTERVAL_MS = 2000;

const STATUS_LABELS: Record<SyncRun["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  interrupted: "Interrupted",
};

function RunStatus({ status }: { status: SyncRun["status"] }) {
  return <span className={`run-status run-status-${status}`}>{STATUS_LABELS[status]}</span>;
}

function LatestRun({ run }: { run: SyncRun | undefined }) {
  if (!run) {
    return (
      <div className="banner banner-fail">
        No sync has run yet. The worker syncs on start and then every hour.
      </div>
    );
  }
  if (run.status === "running") {
    return <div className="banner banner-info">Sync #{run.id} is running...</div>;
  }
  if (run.status !== "succeeded") {
    return (
      <div className="banner banner-fail">
        Last sync #{run.id} {run.status} at {formatDateTime(run.finished_at)}
        {run.error ? `: ${run.error}` : ""}
      </div>
    );
  }
  return (
    <div className={`banner ${run.mismatches ? "banner-fail" : "banner-ok"}`}>
      Last sync #{run.id} finished at {formatDateTime(run.finished_at)}.{" "}
      {run.mismatches
        ? `${formatNumber(run.mismatches)} of ${formatNumber(
            run.items_checked,
          )} cards do not match their history.`
        : `All ${formatNumber(run.items_checked)} cards match their history.`}
    </div>
  );
}

function Mismatches({ run }: { run: SyncRun | undefined }) {
  if (!run || run.mismatch_sample.length === 0) {
    return null;
  }
  return (
    <section className="card section">
      <header className="card-header">
        <h2>Consistency check</h2>
        <p>
          Cards whose current status in Taiga differs from the last status recorded in history.
          This happens when a change bypasses Taiga's history, for example a bulk operation.
        </p>
      </header>
      <table className="table">
        <thead>
          <tr>
            <th>Card</th>
            <th>In Taiga now</th>
            <th>From history</th>
          </tr>
        </thead>
        <tbody>
          {run.mismatch_sample.map((row) => (
            <tr key={`${row.item_type}-${row.item_id}`}>
              <td>
                {ITEM_TYPE_LABELS[row.item_type]} #{row.ref ?? row.item_id} {row.subject}
              </td>
              <td>{row.actual_status ?? "-"}</td>
              <td>{row.reason === "no_history" ? "No history" : row.history_status ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function SyncSection({ slug }: { slug: string }) {
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextRuns, nextSummary] = await Promise.all([
        fetchSyncRuns(slug),
        fetchSyncSummary(slug),
      ]);
      setRuns(nextRuns);
      setSummary(nextSummary);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = runs?.[0]?.status === "running";

  useEffect(() => {
    if (!running && !starting) {
      return;
    }
    timer.current = window.setTimeout(() => void load(), POLL_INTERVAL_MS);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, [running, starting, runs, load]);

  const syncNow = async () => {
    setStarting(true);
    try {
      await startSync(slug);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      window.setTimeout(() => setStarting(false), POLL_INTERVAL_MS);
    }
  };

  const latest = runs?.[0];

  return (
    <>
      <SectionHeader
        title="Data sync"
        subtitle={
          <>
            Newest history entry read: {formatDateTime(summary?.watermark ?? null)}. A sync reads
            Taiga's new history for every project at once; below is what it means for this one.
          </>
        }
        action={
          <button type="button" onClick={() => void syncNow()} disabled={running || starting}>
            {running || starting ? "Syncing..." : "Sync now"}
          </button>
        }
      />

      {error && <div className="banner banner-fail">{error}</div>}
      {runs && <LatestRun run={latest} />}

      {summary && (
        <section className="card section">
          <header className="card-header">
            <h2>Stored data</h2>
            <p>What the extension holds for this project</p>
          </header>
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th className="num">User stories</th>
                <th className="num">Tasks</th>
                <th className="num">Issues</th>
                <th className="num">Epics</th>
                <th className="num">Deleted</th>
                <th className="num">Transitions</th>
                <th className="num">Assignee changes</th>
                <th>Last event</th>
              </tr>
            </thead>
            <tbody>
              {summary.projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <TextLink to={projectPath(project.slug)}>{project.name}</TextLink>
                  </td>
                  <td className="num">{formatNumber(project.userstories)}</td>
                  <td className="num">{formatNumber(project.tasks)}</td>
                  <td className="num">{formatNumber(project.issues)}</td>
                  <td className="num">{formatNumber(project.epics)}</td>
                  <td className="num">{formatNumber(project.deleted_items)}</td>
                  <td className="num">{formatNumber(project.transitions)}</td>
                  <td className="num">{formatNumber(project.assignments)}</td>
                  <td>{formatDateTime(project.last_event_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Mismatches run={latest?.status === "succeeded" ? latest : undefined} />

      {runs && runs.length > 0 && (
        <section className="card section">
          <header className="card-header">
            <h2>Recent runs</h2>
            <p>Hourly runs by the worker, manual runs from this page</p>
          </header>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Started</th>
                <th>Trigger</th>
                <th>Status</th>
                <th className="num">Duration</th>
                <th className="num">History read</th>
                <th className="num">New transitions</th>
                <th className="num">New assignee changes</th>
                <th className="num">Mismatches</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.id}</td>
                  <td>{formatDateTime(run.started_at)}</td>
                  <td>{run.trigger}</td>
                  <td>
                    <RunStatus status={run.status} />
                  </td>
                  <td className="num">{formatDuration(run.started_at, run.finished_at)}</td>
                  <td className="num">{formatNumber(run.history_read)}</td>
                  <td className="num">{formatNumber(run.transitions_added)}</td>
                  <td className="num">{formatNumber(run.assignments_added)}</td>
                  <td className="num">{formatNumber(run.mismatches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
