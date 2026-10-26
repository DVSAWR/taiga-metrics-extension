import { useEffect, useState } from "react";

import {
  fetchTransitions,
  type FilterSelection,
  type ItemType,
  type Period,
  type TransitionRow,
} from "../api";
import { CardTitle } from "../components/CardTitle";
import { PersonLink, PersonList } from "../components/PersonLink";
import { StayBadge } from "../components/StayBadge";
import { StatusName } from "../components/StatusName";
import { SortTitle, sortRows, useSort } from "../components/SortTitle";
import { formatDuration } from "../charts/format";
import { formatDateTime } from "../format";
import { Empty, MetricCard } from "./FlowMetrics";

const PAGE_SIZE = 100;

function Move({ row, slug }: { row: TransitionRow; slug: string }) {
  const from = (
    <StatusName
      slug={slug}
      itemType={row.item_type}
      id={row.from_status_id}
      name={row.from_status}
      color={row.from_color}
    />
  );
  const to = (
    <StatusName
      slug={slug}
      itemType={row.item_type}
      id={row.to_status_id}
      name={row.to_status}
      color={row.to_color}
    />
  );
  if (row.kind === "create") {
    return (
      <span className="move-line">
        <span className="move-kind">Created in</span> {to}
      </span>
    );
  }
  if (row.kind === "delete") {
    return (
      <span className="move-line">
        <span className="deleted-status">Deleted</span> <span className="move-kind">from</span>{" "}
        {from}
      </span>
    );
  }
  return (
    <span className="move-line">
      {from} <span className="move-arrow">→</span> {to}
    </span>
  );
}

function moveText(row: TransitionRow): string {
  if (row.kind === "create") {
    return `Created in ${row.to_status ?? "-"}`;
  }
  if (row.kind === "delete") {
    return `Deleted from ${row.from_status ?? "-"}`;
  }
  return `${row.from_status ?? "-"} → ${row.to_status ?? "-"}`;
}

function shortDuration(days: number | null): string {
  if (days === null) {
    return "-";
  }
  if (days >= 10) {
    return `${Math.round(days)} d`;
  }
  if (days >= 1) {
    const whole = Math.floor(days);
    const hours = Math.round((days - whole) * 24);
    return hours === 0 ? `${whole} d` : hours === 24 ? `${whole + 1} d` : `${whole} d ${hours} h`;
  }
  const hours = days * 24;
  return hours >= 1 ? `${Math.round(hours)} h` : `${Math.max(1, Math.round(hours * 60))} min`;
}

function usualText(row: TransitionRow): string | undefined {
  const usual = row.usual;
  if (!usual || row.days_in_status === null) {
    return undefined;
  }
  if (usual.stays < 3) {
    return `Only ${usual.stays} past stays in ${
      row.from_status ?? "this status"
    }: too few to compare.`;
  }
  return (
    `${formatDuration(row.days_in_status)} in ${row.from_status ?? "this status"}. ` +
    `Past stays there: median ${formatDuration(usual.p50)}; ` +
    `faster below ${formatDuration(usual.p15)} (much faster below ${formatDuration(usual.p5)}), ` +
    `slower above ${formatDuration(usual.p85)} (much slower above ${formatDuration(usual.p95)}).`
  );
}

export function TransitionsTable({
  rows,
  slug,
  taigaUrl,
  withCard = false,
}: {
  rows: TransitionRow[];
  slug: string;
  taigaUrl: string | null;
  withCard?: boolean;
}) {
  const [sort, onSort] = useSort();
  return (
    <div className="log-scroll">
      <table className={`table log-table${withCard ? "" : " log-table-card"}`}>
        <colgroup>
          <col className="col-when" />
          {withCard && <col />}
          <col className="col-change" />
          <col className="col-time" />
          <col className="col-usual" />
          <col className="col-level" />
          <col className="col-people" />
          <col className="col-by" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <SortTitle label="When" sortKey="when" sort={sort} onSort={onSort} />
            </th>
            {withCard && (
              <th>
                <SortTitle label="Card" sortKey="card" sort={sort} onSort={onSort} />
              </th>
            )}
            <th>
              <SortTitle label="Status change" sortKey="change" sort={sort} onSort={onSort} />
            </th>
            <th className="num" title="How long the card had been in the status it left">
              <SortTitle label="In previous status" sortKey="time" sort={sort} onSort={onSort} />
            </th>
            <th
              className="num"
              title="Median of past stays in the status it left, and the range 70% of them fell in"
            >
              <SortTitle label="Median" sortKey="median" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Compared" sortKey="level" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Assigned" sortKey="assigned" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Moved by" sortKey="person" sort={sort} onSort={onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sortRows(rows, sort, (row, key) =>
            key === "when"
              ? row.happened_at
              : key === "card"
                ? row.ref ?? row.item_id
                : key === "change"
                  ? moveText(row)
                  : key === "time"
                    ? row.days_in_status
                    : key === "median"
                      ? row.usual?.p50 ?? null
                      : key === "level"
                        ? row.level
                        : key === "assigned"
                          ? row.assignees.map((person) => person.name).join(", ")
                          : row.user?.name ?? row.user_name,
          ).map((row) => (
            <tr key={row.history_id}>
              <td className="nowrap">{formatDateTime(row.happened_at)}</td>
              {withCard && (
                <td className="truncate card-cell">
                  <CardTitle
                    slug={slug}
                    itemType={row.item_type}
                    itemId={row.item_id}
                    cardRef={row.ref}
                    subject={row.subject}
                    isDeleted={row.is_deleted}
                    taigaUrl={taigaUrl}
                  />
                </td>
              )}
              <td className="change-cell" title={moveText(row)}>
                <Move row={row} slug={slug} />
              </td>
              <td className="num nowrap">
                {row.days_in_status === null ? "" : formatDuration(row.days_in_status)}
              </td>
              <td className="num nowrap" title={usualText(row)}>
                {row.usual?.p50 == null ? "" : formatDuration(row.usual.p50)}
                {row.usual && row.usual.stays >= 3 && row.days_in_status !== null && (
                  <span className="usual-range">
                    {shortDuration(row.usual.p15)} - {shortDuration(row.usual.p85)}
                  </span>
                )}
              </td>
              <td className="nowrap">
                <StayBadge
                  level={row.level}
                  title={row.level === "passed_through" ? undefined : usualText(row)}
                />
              </td>
              <td
                className="truncate"
                title={row.assignees.map((person) => person.name).join(", ")}
              >
                <PersonList people={row.assignees} nobody="Unassigned" />
              </td>
              <td className="truncate" title={row.user?.name ?? row.user_name}>
                {row.user ? (
                  <PersonLink name={row.user.name} id={row.user.id} />
                ) : (
                  row.user_name || "-"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryTab({
  slug,
  itemType,
  selection,
  period,
  taigaUrl,
}: {
  slug: string;
  itemType: ItemType;
  selection: FilterSelection;
  period: Period;
  taigaUrl: string | null;
}) {
  const [rows, setRows] = useState<TransitionRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTransitions(slug, itemType, selection, period, 0, PAGE_SIZE)
      .then((page) => {
        if (!cancelled) {
          setRows(page.rows);
          setHasMore(page.has_more);
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
  }, [slug, itemType, selection, period]);

  const loadMore = () => {
    if (!rows) {
      return;
    }
    setLoadingMore(true);
    fetchTransitions(slug, itemType, selection, period, rows.length, PAGE_SIZE)
      .then((page) => {
        setRows([...rows, ...page.rows]);
        setHasMore(page.has_more);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="flow-metrics">
      {error && <div className="banner banner-fail">{error}</div>}
      <MetricCard
        title="Transitions"
        subtitle={
          <>
            Every status change in the period, newest first. In previous status is how long the
            card had been in the status it left. Median and the usual range under it describe past
            stays in that status: 70% of them fell within the range. A tag appears only outside it:{" "}
            <StayBadge level="fast" /> or <StayBadge level="long" /> means shorter or longer than
            85% of past stays, <StayBadge level="very_fast" /> or <StayBadge level="very_long" />{" "}
            than 95%, which is rare. The full history of one card is on its page.
          </>
        }
      >
        {rows && rows.length === 0 && <Empty>No transitions in this period.</Empty>}
        {rows && rows.length > 0 && (
          <TransitionsTable rows={rows} slug={slug} taigaUrl={taigaUrl} withCard />
        )}
        {hasMore && (
          <div className="load-more">
            <button type="button" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading..." : "Show more"}
            </button>
          </div>
        )}
      </MetricCard>
    </div>
  );
}
