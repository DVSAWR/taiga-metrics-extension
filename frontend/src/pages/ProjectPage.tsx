import { useEffect, useMemo, useState } from "react";

import {
  fetchFlow,
  fetchSprints,
  type FlowResponse,
  type ItemType,
  type Module,
  type ProjectSummary,
  type Sprint,
} from "../api";
import { CountLineChart, type CountPoint } from "../charts/CountLineChart";
import { formatDuration } from "../charts/format";
import { FilterButton, FilterPanel } from "../components/FilterPanel";
import { Segmented } from "../components/Segmented";
import { SprintSelect } from "../components/SprintSelect";
import { TextLink } from "../components/TextLink";
import { useFilterSelection, useFiltersOpen, usePeriod } from "../filterState";
import { formatNumber } from "../format";
import { MODULE_INFO, TYPE_LABELS } from "../modules";
import { Link, modulePath, projectSettingsPath } from "../router";
import {
  type Bucket,
  Empty,
  localDay,
  MetricCard,
  OPEN_FINISHED,
  OPEN_IN_PROGRESS,
  OPEN_NOW,
  OPEN_STUCK,
  trendOf,
} from "./FlowMetrics";
import { NotFoundPage } from "./HomePage";

const SUMMARY_ORDER: Module[] = ["epics", "userstories", "tasks", "issues"];

type Per = Bucket | "sprint";

const PER_OPTIONS: { value: Per; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "sprint", label: "Sprint" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const PER_WORD: Record<Per, string> = {
  day: "working day",
  week: "week",
  sprint: "sprint",
  month: "month",
  year: "year",
};

const PER_KEY = "per";

function readPer(): Per | null {
  const value = new URLSearchParams(window.location.search).get(PER_KEY);
  return PER_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

function writePer(per: Per | null): void {
  const query = new URLSearchParams(window.location.search);
  if (per === null) {
    query.delete(PER_KEY);
  } else {
    query.set(PER_KEY, per);
  }
  const search = query.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
  );
}

function bucketPoints(flow: FlowResponse, bucket: Bucket): CountPoint[] {
  const trend = trendOf(
    flow,
    bucket,
    flow.report.finishes.map((finish, index) => ({ moment: finish.finished_at, value: index })),
  );
  const running =
    !flow.period_end || flow.period_end >= flow.generated_at
      ? trend.points[trend.points.length - 1]?.key
      : undefined;
  return trend.points.map((point, index) => ({
    key: point.key,
    label: point.label,
    detail: `${bucket === "week" ? "Week of " : ""}${point.label}`,
    value: trend.values[index]?.length ?? 0,
    current: point.key === running,
  }));
}

function sprintPoints(flow: FlowResponse, sprints: Sprint[]): CountPoint[] {
  const zone = flow.timezone;
  const today = localDay(flow.generated_at, zone);
  const from = flow.period_start ? localDay(flow.period_start, zone) : null;
  const to = flow.period_end ? localDay(flow.period_end, zone) : null;
  const dated = sprints
    .filter(
      (sprint): sprint is Sprint & { start: string; finish: string } =>
        sprint.start !== null && sprint.finish !== null,
    )
    .filter((sprint) => (!from || sprint.finish >= from) && (!to || sprint.start <= to))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const days = flow.report.finishes.map((finish) => localDay(finish.finished_at, zone));
  return dated.map((sprint) => ({
    key: String(sprint.id),
    label: sprint.name,
    detail: sprint.name,
    value: days.filter((day) => day >= sprint.start && day <= sprint.finish).length,
    current: !sprint.closed && sprint.start <= today && today <= sprint.finish,
  }));
}

function average(points: CountPoint[]): string {
  const done = points.filter((point) => !point.current);
  if (done.length === 0) {
    return "-";
  }
  return (done.reduce((sum, point) => sum + point.value, 0) / done.length).toFixed(1);
}

interface TypeFlow {
  type: ItemType;
  module: Module;
  flow: FlowResponse;
}

function wentBack(flow: FlowResponse): string {
  const moves = flow.report.back_moves;
  return moves.cards_moved > 0
    ? `${Math.round((moves.cards_with_back_moves / moves.cards_moved) * 100)}%`
    : "-";
}

export function ProjectPage({
  slug,
  projects,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const [selection, setSelection] = useFilterSelection(slug);
  const [period, setPeriod] = usePeriod(slug);
  const [filtersOpen, setFiltersOpen] = useFiltersOpen();
  const [flows, setFlows] = useState<TypeFlow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [per, setPer] = useState<Per | null>(readPer);
  const [sprints, setSprints] = useState<Sprint[] | null>(null);
  const hasSprints = Boolean(project?.has_scrum && project.has_sprints);
  const fallback: Per = hasSprints ? "sprint" : "week";
  const shownPer: Per = per === null || (per === "sprint" && !hasSprints) ? fallback : per;
  const homes = SUMMARY_ORDER.filter((module) => project?.modules.includes(module)).map(
    (module) => ({ type: MODULE_INFO[module].type, module }),
  );
  const homesKey = homes.map((home) => `${home.type}:${home.module}`).join();

  useEffect(() => {
    if (homes.length === 0) {
      setFlows([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      homes.map(async (home) => ({
        ...home,
        flow: await fetchFlow(slug, home.type, selection, period),
      })),
    )
      .then((next) => {
        if (!cancelled) {
          setFlows(next);
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
  }, [slug, homesKey, selection, period]);

  useEffect(() => writePer(per), [per]);

  useEffect(() => {
    if (!hasSprints) {
      setSprints([]);
      return;
    }
    let cancelled = false;
    fetchSprints(slug)
      .then((next) => !cancelled && setSprints(next))
      .catch(() => !cancelled && setSprints([]));
    return () => {
      cancelled = true;
    };
  }, [slug, hasSprints]);

  const series = useMemo(
    () =>
      (flows ?? []).map(({ type, flow }) => ({
        type,
        flow,
        points:
          shownPer === "sprint" ? sprintPoints(flow, sprints ?? []) : bucketPoints(flow, shownPer),
      })),
    [flows, shownPer, sprints],
  );
  const averages = new Map(series.map((item) => [item.type, average(item.points)]));

  if (projects && !project) {
    return <NotFoundPage />;
  }

  return (
    <>
      <h1>{project?.name ?? slug}</h1>
      <div className="toolbar">
        <FilterButton
          open={filtersOpen}
          selection={selection}
          period={period}
          onToggle={() => setFiltersOpen(!filtersOpen)}
        />
        <SprintSelect slug={slug} period={period} onChange={setPeriod} />
      </div>
      <div className="with-filters">
        {filtersOpen && (
          <FilterPanel
            slug={slug}
            itemType={null}
            selection={selection}
            onChange={setSelection}
            period={period}
            onPeriodChange={setPeriod}
          />
        )}
        <div className={`filtered-content${flows === null && !error ? " loading" : ""}`}>
          {error && <div className="banner banner-fail">{error}</div>}
          <div className="flow-metrics">
            <MetricCard
              title="Flow metrics"
              subtitle="Every kind of card of the project side by side. Open a row for its statuses, moves and history."
            >
              {flows && flows.length === 0 && (
                <Empty>No Taiga module with cards is switched on in this project.</Empty>
              )}
              {flows && flows.length > 0 && (
                <table className="table summary-table">
                  <thead>
                    <tr>
                      <th>Cards</th>
                      <th className="num" title="Cards that are not deleted">
                        Total
                      </th>
                      <th className="num" title="Cards in a Work status right now">
                        In progress
                      </th>
                      <th className="num" title="Cards that reached Done in the period">
                        Finished
                      </th>
                      <th
                        className="num"
                        title="Cards finished per period on average, the running one left out"
                      >
                        Per {PER_WORD[shownPer]}
                      </th>
                      <th className="num" title="From creation to Done, median">
                        Lead time
                      </th>
                      <th className="num" title="From the first Work status to Done, median">
                        Cycle time
                      </th>
                      <th className="num" title="Longer than 85% of past stays in their status">
                        Stuck
                      </th>
                      <th className="num" title="Share of moved cards that went back">
                        Went back
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {flows.map(({ type, module, flow }) => {
                      const report = flow.report;
                      const stuck = report.stuck.filter((card) => card.level).length;
                      return (
                        <tr key={type}>
                          <td>
                            <TextLink to={modulePath(slug, module)} className="summary-link">
                              {TYPE_LABELS[type]}
                            </TextLink>
                            {!report.configured && project?.access.can_manage && (
                              <Link
                                to={projectSettingsPath(slug, "general")}
                                className="badge badge-accent"
                              >
                                Statuses not set up
                              </Link>
                            )}
                          </td>
                          <td className="num">
                            {report.cards > 0 ? (
                              <TextLink
                                to={`${modulePath(slug, module)}?open=${OPEN_NOW}`}
                                title="Open these cards in Time in statuses"
                              >
                                {formatNumber(report.cards)}
                              </TextLink>
                            ) : (
                              formatNumber(report.cards)
                            )}
                          </td>
                          <td className="num">
                            {report.in_progress > 0 ? (
                              <TextLink
                                to={`${modulePath(slug, module)}?open=${OPEN_IN_PROGRESS}`}
                                title="Open these cards in Time in statuses"
                              >
                                {formatNumber(report.in_progress)}
                              </TextLink>
                            ) : (
                              formatNumber(report.in_progress)
                            )}
                          </td>
                          <td className="num">
                            {report.finished > 0 ? (
                              <TextLink
                                to={`${modulePath(slug, module)}?open=${OPEN_FINISHED}`}
                                title="Open the finished cards in Throughput"
                              >
                                {formatNumber(report.finished)}
                              </TextLink>
                            ) : (
                              formatNumber(report.finished)
                            )}
                          </td>
                          <td className="num">{averages.get(type) ?? "-"}</td>
                          <td className="num">{formatDuration(report.lead_time.p50)}</td>
                          <td className="num">{formatDuration(report.cycle_time.p50)}</td>
                          <td className="num">
                            {stuck > 0 ? (
                              <TextLink
                                to={`${modulePath(slug, module)}?open=${OPEN_STUCK}`}
                                title="Open these cards in Time in statuses"
                              >
                                {formatNumber(stuck)}
                              </TextLink>
                            ) : (
                              formatNumber(stuck)
                            )}
                          </td>
                          <td className="num">{wentBack(flow)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </MetricCard>
            {flows && flows.length > 0 && (
              <>
                <div className="toolbar">
                  <Segmented
                    label="Finished per"
                    options={PER_OPTIONS.filter(
                      (option) => option.value !== "sprint" || hasSprints,
                    )}
                    value={shownPer}
                    onChange={(next) => setPer(next === fallback ? null : next)}
                  />
                </div>
                <div className="metric-stack">
                  {series.map(({ type, flow, points }) => (
                    <MetricCard
                      key={type}
                      title={`${TYPE_LABELS[type]} finished per ${PER_WORD[shownPer]}`}
                      subtitle={
                        shownPer === "sprint"
                          ? "A card counts in the sprint whose dates hold its finish. Green where more were finished than in the period before, red where fewer; the running one is dashed."
                          : `Days and weeks follow the project calendar in ${flow.timezone}; weeks start on Monday. Green where more were finished than in the period before, red where fewer; the running one is dashed.`
                      }
                    >
                      {points.length === 0 || points.every((point) => point.value === 0) ? (
                        <Empty>No finished cards yet.</Empty>
                      ) : (
                        <CountLineChart
                          points={points}
                          unit={(value) =>
                            `${formatNumber(value)} ${value === 1 ? "card" : "cards"} finished`
                          }
                        />
                      )}
                    </MetricCard>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
