import { useEffect, useState } from "react";

import {
  fetchColumns,
  setColumnType,
  setShowRemoved,
  type ColumnInfo,
  type ColumnType,
  type ItemType,
  type ItemTypeColumns,
} from "../api";
import { Toggle } from "../components/Toggle";
import { SectionHeader } from "../components/SectionHeader";

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: "queue", label: "Queue" },
  { value: "work", label: "Work" },
  { value: "rework", label: "Rework" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const ITEM_TYPE_TITLES: Record<ItemType, string> = {
  userstory: "User stories",
  task: "Tasks",
  issue: "Issues",
  epic: "Epics",
};

function ColumnRow({
  column,
  onChange,
}: {
  column: ColumnInfo;
  onChange: (type: ColumnType) => void;
}) {
  return (
    <tr className={column.is_deleted ? "column-removed" : ""}>
      <td>
        <span className="column-name">
          <span className="column-color" style={{ background: column.color || "#a9aabc" }} />
          {column.name}
        </span>
        {column.is_closed && <span className="badge badge-muted">Closed in Taiga</span>}
        {column.is_archived && <span className="badge badge-muted">Archived</span>}
        {column.is_deleted && <span className="badge badge-accent">Removed from Taiga</span>}
      </td>
      <td className="num">{column.is_deleted ? "-" : column.cards}</td>
      <td>
        <div
          className="segmented column-type"
          role="radiogroup"
          aria-label={`Type of ${column.name}`}
        >
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={column.type === option.value}
              className={`${column.type === option.value ? "active" : ""} type-${
                option.value ?? "none"
              }`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}

export function ColumnsSection({ slug }: { slug: string }) {
  const [groups, setGroups] = useState<ItemTypeColumns[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchColumns(slug)
      .then((next) => {
        if (!cancelled) {
          setGroups(next);
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

  const update = (itemType: ItemType, statusId: number, patch: Partial<ColumnInfo>) =>
    setGroups(
      (current) =>
        current?.map((group) =>
          group.item_type !== itemType
            ? group
            : {
                ...group,
                columns: group.columns.map((column) =>
                  column.status_id === statusId ? { ...column, ...patch } : column,
                ),
              },
        ) ?? null,
    );

  const toggleRemoved = (itemType: ItemType, show: boolean) => {
    setGroups(
      (current) =>
        current?.map((group) =>
          group.item_type === itemType ? { ...group, show_removed: show } : group,
        ) ?? null,
    );
    setShowRemoved(slug, itemType, show).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  const change = (itemType: ItemType, statusId: number, type: ColumnType | null) => {
    update(itemType, statusId, { type });
    setColumnType(slug, itemType, statusId, type).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <>
      <SectionHeader
        title="General"
        subtitle="What each Taiga status means for flow metrics. Order and names come from Taiga."
      />
      <div className="banner banner-info">
        <dl className="type-legend">
          <div>
            <dt>Queue</dt>
            <dd>waiting, nobody works on it yet.</dd>
          </div>
          <div>
            <dt>Work</dt>
            <dd>someone works on it; cycle time starts at the first Work status. Required.</dd>
          </div>
          <div>
            <dt>Rework</dt>
            <dd>
              sent back to be redone, for example Redefine or Rework. Every move into it counts as
              going back.
            </dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>
              finished; lead and cycle time end here, and moving on to another Done status such as
              Archive keeps the card finished. Required.
            </dd>
          </div>
          <div>
            <dt>Cancelled</dt>
            <dd>
              put aside without being done: postponed, back to the backlog, or dropped. Kept out of
              throughput and stuck cards.
            </dd>
          </div>
        </dl>
      </div>
      {error && <div className="banner banner-fail">{error}</div>}
      {!groups && !error && <p className="muted">Loading...</p>}
      {groups?.map((group) => {
        const live = group.columns.filter((column) => !column.is_deleted);
        const removed = group.columns.length - live.length;
        const configured = live.filter((column) => column.type !== null).length;
        const hasWork = group.columns.some((column) => column.type === "work");
        const hasDone = group.columns.some((column) => column.type === "done");
        const problems = [
          !hasWork && "Mark at least one status as Work: cycle time starts there.",
          !hasDone && "Mark at least one status as Done: lead and cycle time end there.",
        ].filter((problem): problem is string => Boolean(problem));
        return (
          <section key={group.item_type} className="card section">
            <header className="card-header card-header-row">
              <div>
                <h2>{ITEM_TYPE_TITLES[group.item_type]}</h2>
                <p>
                  {configured} of {live.length} statuses set
                </p>
              </div>
              <span
                className={`badge ${problems.length > 0 ? "badge-accent" : ""}`}
                title={problems.join(" ")}
              >
                {problems.length > 0 ? "Not complete" : "Complete"}
              </span>
            </header>
            {removed > 0 && (
              <label className="check-line removed-toggle">
                <Toggle
                  checked={group.show_removed}
                  onChange={(checked) => toggleRemoved(group.item_type, checked)}
                  label="Show statuses removed from Taiga"
                />
                <span>
                  Show {removed} {removed === 1 ? "status" : "statuses"} removed from Taiga, here
                  and in the {ITEM_TYPE_TITLES[group.item_type].toLowerCase()} reports. Hidden
                  statuses still count in lead and cycle time.
                </span>
              </label>
            )}
            {problems.length > 0 && (
              <ul className="setup-problems">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            <table className="table columns-table">
              <colgroup>
                <col className="col-name" />
                <col className="col-cards" />
                <col className="col-type" />
              </colgroup>
              <thead>
                <tr>
                  <th>Status</th>
                  <th className="num">Cards now</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {group.columns
                  .filter((column) => group.show_removed || !column.is_deleted)
                  .map((column) => (
                    <ColumnRow
                      key={column.status_id}
                      column={column}
                      onChange={(type) => change(group.item_type, column.status_id, type)}
                    />
                  ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
