import { useEffect, useState } from "react";

import {
  ALL_TIME,
  fetchCardComments,
  fetchCardFlow,
  fetchTransitions,
  type CardComments,
  type CardFlow,
  type ColumnRef,
  type Module,
  type ProjectSummary,
  type TransitionRow,
} from "../api";
import { fillWidth, formatDuration } from "../charts/format";
import { StatTile } from "../charts/StatTile";
import { CardRef } from "../components/CardRef";
import { PersonLink, PersonRef } from "../components/PersonLink";
import { UserPhoto } from "../components/UserPhoto";
import { StatusName } from "../components/StatusName";
import { StayBadge } from "../components/StayBadge";
import { MetricPopup } from "../components/MetricPopup";
import { SortTitle, sortRows, useSort } from "../components/SortTitle";
import { TextLink } from "../components/TextLink";
import { CARD_BACKGROUND, FALLBACK_MARK, readable } from "../colors";
import { EMPTY_SELECTION, usePeriod } from "../filterState";
import { formatDateTime, formatNumber } from "../format";
import { MODULE_INFO } from "../modules";
import { cardsPath, columnPath, projectPath } from "../router";
import { DonutSplit, Empty, MetricCard, type Slice } from "./FlowMetrics";
import { TransitionsTable } from "./HistoryTab";
import { NotFoundPage } from "./HomePage";
import { AgingBadges } from "../components/AgingBadges";

const HISTORY_LIMIT = 1000;
const NEUTRAL = "#a9aabc";

function Status({
  slug,
  card,
  column,
  id,
}: {
  slug: string;
  card: CardFlow;
  column: ColumnRef | undefined;
  id: number;
}) {
  return (
    <StatusName
      slug={slug}
      itemType={card.item_type}
      id={column && !column.is_deleted ? id : null}
      name={column?.name ?? `Status ${id}`}
      color={column?.color ?? null}
    />
  );
}

function StaysList({ card, stays }: { card: CardFlow; stays: CardFlow["report"]["stays"] }) {
  const [sort, onSort] = useSort();
  return (
    <table className="table table-compact move-events">
      <thead>
        <tr>
          <th>
            <SortTitle label="Entered" sortKey="entered" sort={sort} onSort={onSort} />
          </th>
          <th className="num">
            <SortTitle label="Stayed" sortKey="stayed" sort={sort} onSort={onSort} />
          </th>
          <th>
            <SortTitle label="Compared" sortKey="level" sort={sort} onSort={onSort} />
          </th>
          <th>
            <SortTitle label="Moved on by" sortKey="person" sort={sort} onSort={onSort} />
          </th>
        </tr>
      </thead>
      <tbody>
        {sortRows(stays, sort, (stay, key) =>
          key === "entered"
            ? stay.start
            : key === "stayed"
              ? stay.days
              : key === "level"
                ? stay.level
                : stay.exited_by,
        ).map((stay) => (
          <tr key={stay.start}>
            <td className="nowrap">{formatDateTime(stay.start)}</td>
            <td className="num nowrap">
              {formatDuration(stay.days)}
              {stay.end === null && <span className="muted-inline"> so far</span>}
            </td>
            <td className="nowrap">
              <StayBadge level={stay.level} />
            </td>
            <td className="truncate">
              <PersonRef directory={card} id={stay.exited_by} nobody="-" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TimeInStatuses({ slug, card }: { slug: string; card: CardFlow }) {
  const columns = new Map(card.columns.map((column) => [column.status_id, column]));
  const order = new Map(card.columns.map((column, index) => [column.status_id, index]));
  const totals = [...card.report.columns].sort(
    (a, b) => (order.get(a.status_id) ?? 999) - (order.get(b.status_id) ?? 999),
  );
  const longest = Math.max(0, ...totals.map((total) => total.days));
  const days = totals.reduce((sum, total) => sum + total.days, 0);
  const visits = totals.reduce((sum, total) => sum + total.visits, 0);
  const visitSlices: Slice[] = totals
    .filter((total) => total.visits > 0)
    .map((total) => {
      const column = columns.get(total.status_id);
      return {
        key: String(total.status_id),
        label: null,
        name: column?.name ?? `Status ${total.status_id}`,
        to:
          column && !column.is_deleted
            ? columnPath(slug, card.item_type, total.status_id)
            : undefined,
        color: readable(column?.color || NEUTRAL, CARD_BACKGROUND, FALLBACK_MARK),
        count: total.visits,
      };
    });
  if (totals.length === 0) {
    return <Empty>No status history stored for this card.</Empty>;
  }
  return (
    <table className="table column-times card-times">
      <colgroup>
        <col className="col-status" />
        <col className="col-type" />
        <col />
        <col className="col-count" />
        <col className="col-num" />
      </colgroup>
      <thead>
        <tr>
          <th>Status</th>
          <th>Type</th>
          <th className="bar-cell">Share of the time</th>
          <th
            className="num"
            title="How many times the card entered the status; click for each stay"
          >
            Visits
          </th>
          <th className="num">Time</th>
        </tr>
      </thead>
      <tbody>
        {totals.map((total) => {
          const column = columns.get(total.status_id);
          const color = readable(column?.color || NEUTRAL, CARD_BACKGROUND, FALLBACK_MARK);
          const stays = card.report.stays.filter((stay) => stay.status_id === total.status_id);
          return (
            <tr key={total.status_id}>
              <td>
                <Status slug={slug} card={card} column={column} id={total.status_id} />
                {column?.is_deleted && <span className="badge badge-accent">Removed</span>}
              </td>
              <td>{column?.type && <span className="badge badge-muted">{column.type}</span>}</td>
              <td className="bar-cell">
                <span className="inline-track">
                  <span
                    className="inline-bar"
                    style={{
                      ...fillWidth(longest > 0 ? (total.days / longest) * 100 : 0),
                      background: color,
                    }}
                  />
                </span>
                <span className="bar-share">
                  {days > 0 ? `${Math.round((total.days / days) * 100)}%` : ""}
                </span>
              </td>
              <td className="num">
                <MetricPopup
                  label="Show each stay"
                  content={<StaysList card={card} stays={stays} />}
                >
                  {formatNumber(total.visits)}
                </MetricPopup>
              </td>
              <td className="num nowrap">{formatDuration(total.days)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="matrix-total-row">
          <th scope="row" colSpan={3}>
            Total
          </th>
          <td className="num">
            <MetricPopup
              label="Show all stays"
              content={
                <>
                  <DonutSplit slices={visitSlices} total={visits} caption="visits" />
                  <StaysList card={card} stays={card.report.stays} />
                </>
              }
            >
              {formatNumber(visits)}
            </MetricPopup>
          </td>
          <td className="num nowrap">{formatDuration(days)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function CommentList({ comments }: { comments: CardComments }) {
  return (
    <ol className="comment-list">
      {comments.comments.map((comment) => (
        <li key={comment.id} className="comment">
          <div className="comment-photo">
            <UserPhoto userId={comment.author_id} />
          </div>
          <div className="comment-main">
            <div className="comment-head">
              <span className="comment-author">
                <PersonLink name={comment.author_name || "Unknown"} id={comment.author_id} />
              </span>
              <span className="comment-date">{formatDateTime(comment.created_at)}</span>
              {comment.edited_at && (
                <span
                  className="comment-edited"
                  title={`Edited ${formatDateTime(comment.edited_at)}`}
                >
                  edited
                </span>
              )}
            </div>
            <p className="comment-text">{comment.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CardPage({
  slug,
  module,
  itemId,
  projects,
  taigaUrl,
}: {
  slug: string;
  module: Module;
  itemId: number;
  projects: ProjectSummary[] | null;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const info = MODULE_INFO[module];
  const [card, setCard] = useState<CardFlow | null>(null);
  const [history, setHistory] = useState<TransitionRow[] | null>(null);
  const [comments, setComments] = useState<CardComments | null>(null);
  const [period] = usePeriod(slug);
  const days = period.days;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCardFlow(slug, info.type, itemId, days),
      fetchTransitions(
        slug,
        info.type,
        EMPTY_SELECTION,
        { ...ALL_TIME, days },
        0,
        HISTORY_LIMIT,
        itemId,
      ),
      fetchCardComments(slug, info.type, itemId),
    ])
      .then(([nextCard, page, nextComments]) => {
        if (!cancelled) {
          setCard(nextCard);
          setHistory(page.rows);
          setComments(nextComments);
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
  }, [slug, info.type, itemId, days]);

  if (projects && !project) {
    return <NotFoundPage />;
  }

  const columns = new Map(card?.columns.map((column) => [column.status_id, column]));
  const report = card?.report;

  return (
    <>
      <div className="breadcrumb">
        <TextLink to={projectPath(slug)}>Overview</TextLink> ·{" "}
        <TextLink to={cardsPath(slug)}>Cards</TextLink> · {info.label}
      </div>
      <h1 className="card-title">
        {card ? (
          <span
            className={card.is_deleted ? "is-deleted" : undefined}
            title={card.is_deleted ? "Deleted in Taiga" : undefined}
          >
            <CardRef
              itemType={card.item_type}
              itemId={card.item_id}
              cardRef={card.ref}
              isDeleted={card.is_deleted}
              slug={slug}
              taigaUrl={taigaUrl}
            />{" "}
            {card.subject}
          </span>
        ) : (
          info.label
        )}
      </h1>
      {error && <div className="banner banner-fail">{error}</div>}
      {card && report && (
        <div className="flow-metrics">
          <div className="stat-row">
            <StatTile
              label="Now in"
              value={
                card.status_id === null ? (
                  "-"
                ) : (
                  <Status
                    slug={slug}
                    card={card}
                    column={columns.get(card.status_id)}
                    id={card.status_id}
                  />
                )
              }
              detail={card.created_at ? `created ${formatDateTime(card.created_at)}` : undefined}
            />
            <StatTile
              label="Lead time"
              value={report.finished_at ? formatDuration(report.lead_days) : "Not finished"}
              detail={
                report.finished_at ? `finished ${formatDateTime(report.finished_at)}` : undefined
              }
            />
            {card.aging && (
              <StatTile
                label="Age"
                value={formatDuration(card.aging.calendar_age_days)}
                detail={
                  <>
                    {card.aging.age_days !== card.aging.calendar_age_days && (
                      <span className="aging-baseline">
                        {formatDuration(card.aging.age_days)} working
                      </span>
                    )}
                    <AgingBadges card={card.aging} />
                  </>
                }
                title="Calendar age from creation to now. Working-day age follows the project calendar; status aging adds every visit to the current status."
              />
            )}
            <StatTile
              label="Cycle time"
              value={report.finished_at ? formatDuration(report.cycle_days) : "-"}
              detail="from the first Work status to Done"
            />
            <StatTile
              label="Went back"
              value={String(report.back_moves)}
              detail={report.back_moves === 1 ? "time" : "times"}
            />
          </div>

          <MetricCard
            title="Time in statuses"
            subtitle={`All the time the card spent in each status, visits added up, in Taiga's status order, in ${
              days === "calendar" ? "calendar" : "working"
            } days as set in the filters. Click Visits for each stay.`}
          >
            <TimeInStatuses slug={slug} card={card} />
          </MetricCard>

          <MetricCard
            title="History"
            subtitle="Every status change of the card, newest first, compared with past stays in the status it left"
          >
            {history && history.length === 0 && <Empty>No history stored for this card.</Empty>}
            {history && history.length > 0 && (
              <TransitionsTable rows={history} slug={slug} taigaUrl={taigaUrl} />
            )}
          </MetricCard>

          <MetricCard
            title="Comments"
            subtitle="The card's comments in Taiga, oldest first, as written in Taiga's editor. Deleted comments are left out."
          >
            {comments && comments.comments.length === 0 && (
              <Empty>No comments on this card.</Empty>
            )}
            {comments && comments.comments.length > 0 && <CommentList comments={comments} />}
          </MetricCard>
        </div>
      )}
    </>
  );
}
