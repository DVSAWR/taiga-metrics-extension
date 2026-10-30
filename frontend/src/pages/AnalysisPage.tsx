import { useEffect, useState, type ReactNode } from "react";

import {
  fetchAnalysis,
  fetchPerson,
  subjectKey,
  type Analysis,
  type FlowReport,
  type FilterSelection,
  type ItemType,
  type Me,
  type ProjectSummary,
  type Subject,
} from "../api";
import { rowCards, subjectCards } from "../cardLists";
import { Breakdown } from "../components/Breakdown";
import { FilterPanel } from "../components/FilterPanel";
import { KeyNumbers } from "../components/KeyNumbers";
import { MetricList } from "../components/MetricList";
import { StatusName } from "../components/StatusName";
import { StuckList } from "../components/StuckList";
import { TextLink } from "../components/TextLink";
import { useFilterSelection, useItemType, usePeriod } from "../filterState";
import { peoplePath, rolePath } from "../router";
import { readStored, writeStored } from "../storage";
import {
  CardsBreakdown,
  Empty,
  MetricCard,
  MovesTab,
  SpeedCard,
  StatusTimesCard,
  ThroughputCard,
} from "./FlowMetrics";
import { NotFoundPage } from "./HomePage";
import { projectTypes } from "./KanbanPage";
import { Achievements, Header, useLoaded } from "./PersonPage";
import { canOpen } from "../projectAccess";

const BREAKDOWN_TITLES: Record<Exclude<Subject["kind"], "project">, [string, string]> = {
  role: [
    "By person",
    "Who closed the stays in its statuses (a stay belongs to whoever moved the card on): members first, then anyone else. A person opens their own screen.",
  ],
  person: [
    "By status",
    "The statuses the person worked in: their stays, their share of everyone's time there, and how much came back.",
  ],
};

type Tab = "now" | "period" | "flow";

const TABS: { key: Tab; label: string }[] = [
  { key: "flow", label: "Flow" },
  { key: "period", label: "Period results" },
  { key: "now", label: "Now" },
];

function useTab(): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => {
    const stored = readStored("analysis-tab");
    return TABS.find((candidate) => candidate.key === stored)?.key ?? "flow";
  });
  return [
    tab,
    (next) => {
      writeStored("analysis-tab", next);
      setTab(next);
    },
  ];
}

function TabBar({ tabs, tab, onChange }: { tabs: Tab[]; tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabs analysis-tabs" aria-label="Views">
      {TABS.filter((candidate) => tabs.includes(candidate.key)).map((candidate) => (
        <button
          key={candidate.key}
          type="button"
          className={`tab${candidate.key === tab ? " active" : ""}`}
          onClick={() => onChange(candidate.key)}
        >
          {candidate.label}
        </button>
      ))}
    </nav>
  );
}

function StuckAtEnd({
  report,
  statuses,
  list,
}: {
  report: FlowReport;
  statuses: number[] | null;
  list: (cards: FlowReport["stuck"], showIdle: boolean) => ReactNode;
}) {
  const own = (card: FlowReport["stuck"][number]) =>
    card.level && (statuses === null || statuses.includes(card.status_id));
  const atEnd = new Set(report.stuck_at_end.filter(own).map((card) => card.item_id));
  const still = report.stuck.filter((card) => own(card) && atEnd.has(card.item_id));
  return (
    <MetricCard
      title="Stuck at the end of the period"
      subtitle="Cards stuck at period end that are still stuck now. Their status, time in it and assignees reflect the current state."
    >
      <h3 className="stuck-subhead">Still stuck now ({still.length})</h3>
      {still.length === 0 ? <Empty>None.</Empty> : list(still, false)}
    </MetricCard>
  );
}

function Crumbs({ slug, subject }: { slug: string; subject: Subject }) {
  if (subject.kind === "project") {
    return null;
  }
  return (
    <div className="breadcrumb">
      {subject.kind === "role" ? (
        <TextLink to={rolePath(slug)}>Roles</TextLink>
      ) : (
        <TextLink to={peoplePath(slug)}>People</TextLink>
      )}
    </div>
  );
}

function PersonTop({
  slug,
  userId,
  me,
  taigaUrl,
  canOpenRole,
  selection,
  itemType,
}: {
  slug: string;
  userId: number;
  me: Me;
  taigaUrl: string | null;
  canOpenRole: boolean;
  selection: FilterSelection;
  itemType: ItemType;
}) {
  const [period] = usePeriod(slug);
  const [person] = useLoaded(
    () => fetchPerson(slug, userId, period, selection, itemType),
    [slug, userId, period, selection, itemType],
  );
  return person ? (
    <Header
      person={person}
      taigaUrl={taigaUrl}
      isMe={userId === me.id}
      slug={slug}
      canOpenRole={canOpenRole}
    />
  ) : null;
}

function PersonBottom({
  slug,
  userId,
  selection,
  itemType,
}: {
  slug: string;
  userId: number;
  selection: FilterSelection;
  itemType: ItemType;
}) {
  const [period] = usePeriod(slug);
  const [person] = useLoaded(
    () => fetchPerson(slug, userId, period, selection, itemType),
    [slug, userId, period, selection, itemType],
  );
  return person ? (
    <MetricCard
      title="Achievements"
      subtitle="Taiga's Team counts and the extension's, for the selected cards and period"
    >
      <div className="metric-chart">
        <Achievements person={person} />
      </div>
    </MetricCard>
  ) : null;
}

export function AnalysisPage({
  slug,
  subject: given,
  projects,
  me,
  taigaUrl,
}: {
  slug: string;
  subject: Subject;
  projects: ProjectSummary[] | null;
  me: Me;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const subject: Subject =
    given.kind === "person" && given.id === null ? { kind: "person", id: me.id } : given;
  const types = projectTypes(project);
  const [itemType, setItemType] = useItemType(slug, types);
  const [period, setPeriod] = usePeriod(slug);
  const [selection, setSelection] = useFilterSelection(slug);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useTab();
  const key = subjectKey(subject);

  useEffect(() => {
    let cancelled = false;
    setAnalysis(null);
    setError(null);
    fetchAnalysis(slug, subject, itemType, selection, period)
      .then((next) => {
        if (!cancelled) {
          setAnalysis(next);
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
  }, [slug, key, itemType, selection, period]);

  if (projects && !project) {
    return <NotFoundPage />;
  }
  const current = analysis && subjectKey(analysis.subject) === key ? analysis : null;
  const flow = current?.flow ?? null;
  const statuses = current?.statuses ?? null;
  const responsibleIds = new Set(current?.compared ?? []);
  const responsibleColumns =
    flow?.report.columns.filter((column) => responsibleIds.has(column.status_id)) ?? [];
  const canOpenColumn = Boolean(
    project &&
      (canOpen(project, "overview") ||
        canOpen(project, "directions") ||
        canOpen(project, "trends")),
  );
  const stuck = flow
    ? flow.report.stuck.filter(
        (card) => card.level && (statuses === null || statuses.includes(card.status_id)),
      )
    : [];
  const tabProps = flow ? { flow, slug, itemType, taigaUrl } : null;
  const tabs: Tab[] = ["flow", "period", "now"];
  const shown = tabs.includes(tab) ? tab : "flow";
  const stuckList = (cards: FlowReport["stuck"], showIdle = true) =>
    flow ? (
      <StuckList
        slug={slug}
        itemType={itemType}
        cards={cards}
        columns={flow.report.columns}
        directory={flow}
        taigaUrl={taigaUrl}
        showIdle={showIdle}
      />
    ) : null;
  const breakdownInfo = subject.kind === "project" ? null : BREAKDOWN_TITLES[subject.kind];
  const breakdown =
    breakdownInfo && flow && tabProps ? (
      <MetricCard title={breakdownInfo[0]} subtitle={breakdownInfo[1]}>
        {current?.breakdown.length === 0 ? (
          <Empty>Nothing in the period.</Empty>
        ) : (
          <Breakdown
            slug={slug}
            itemType={itemType}
            rows={current?.breakdown ?? []}
            expand={(row, count) => (
              <MetricList
                {...tabProps}
                list={rowCards(
                  flow.report,
                  statuses,
                  row,
                  count,
                  subject.kind === "person" ? subject.id : null,
                )}
              />
            )}
          />
        )}
      </MetricCard>
    ) : null;

  return (
    <>
      <Crumbs slug={slug} subject={subject} />
      {subject.kind === "person" && subject.id !== null ? (
        <PersonTop
          slug={slug}
          userId={subject.id}
          me={me}
          taigaUrl={taigaUrl}
          canOpenRole={Boolean(project && canOpen(project, "directions"))}
          selection={selection}
          itemType={itemType}
        />
      ) : (
        <h1>{current?.name ?? (subject.kind === "project" ? project?.name ?? slug : "Role")}</h1>
      )}
      <div className="with-filters">
        <FilterPanel
          slug={slug}
          itemType={itemType}
          selection={selection}
          onChange={setSelection}
          period={period}
          onPeriodChange={setPeriod}
          typeChoice={{ types, value: itemType, onChange: setItemType }}
          roleId={subject.kind === "role" ? subject.id : undefined}
          personId={
            subject.kind === "person" && project && canOpen(project, "people")
              ? subject.id
              : undefined
          }
        />
        <div className={`filtered-content${current === null && !error ? " loading" : ""}`}>
          {error && <div className="banner banner-fail">{error}</div>}
          {current && flow && tabProps && project && (
            <div className="flow-metrics">
              <KeyNumbers
                items={[
                  { label: current.name, color: "", kind: subject.kind, tiles: current.tiles },
                ]}
                expand={(count) => (
                  <MetricList
                    {...tabProps}
                    showSplit
                    list={subjectCards(
                      flow.report,
                      statuses,
                      count,
                      subject.kind === "person" ? subject.id : null,
                    )}
                  />
                )}
              />
              {subject.kind !== "project" && (
                <MetricCard
                  title="Responsible columns"
                  subtitle={
                    subject.kind === "role"
                      ? "Columns assigned to this role in project settings."
                      : "Columns assigned to this person's roles in project settings. Work in other columns remains in their activity metrics."
                  }
                >
                  {responsibleColumns.length ? (
                    <div className="responsible-columns">
                      {responsibleColumns.map((column) => (
                        <StatusName
                          key={column.status_id}
                          slug={slug}
                          itemType={itemType}
                          id={canOpenColumn ? column.status_id : null}
                          name={column.name}
                          color={column.color}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty>No columns assigned in settings for this card type.</Empty>
                  )}
                </MetricCard>
              )}
              {subject.kind === "role" && breakdown}
              <TabBar tabs={tabs} tab={shown} onChange={setTab} />
              {shown === "now" && (
                <>
                  <MetricCard
                    title="Stuck now"
                    subtitle="Cards in Work overdue by age since creation or total time in their current status, including earlier visits. Each measure uses the project's whole history and at least 3 completed card observations."
                  >
                    {stuck.length === 0 ? <Empty>Nothing is stuck.</Empty> : stuckList(stuck)}
                  </MetricCard>
                  <MetricCard
                    title="In progress now"
                    subtitle={
                      subject.kind === "role"
                        ? "The cards in its statuses now: where they stand and each of them, the longest in its status first."
                        : "The unfinished cards in Work statuses now: where they stand and each of them, the longest in its status first."
                    }
                  >
                    <CardsBreakdown
                      {...tabProps}
                      cards={subjectCards(flow.report, statuses, "in_progress").cards}
                      caption="in progress"
                      timeLabel="In the status"
                    />
                  </MetricCard>
                  {subject.kind === "person" && breakdown}
                </>
              )}
              {shown === "period" && (
                <>
                  {subject.kind !== "role" && <ThroughputCard {...tabProps} />}
                  {subject.kind !== "role" && <SpeedCard {...tabProps} />}
                  <StuckAtEnd report={flow.report} statuses={statuses} list={stuckList} />
                  {subject.kind === "person" && subject.id !== null && (
                    <PersonBottom
                      slug={slug}
                      userId={subject.id}
                      selection={selection}
                      itemType={itemType}
                    />
                  )}
                </>
              )}
              {shown === "flow" && (
                <>
                  <StatusTimesCard {...tabProps} statuses={statuses} />
                  <MovesTab {...tabProps} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
