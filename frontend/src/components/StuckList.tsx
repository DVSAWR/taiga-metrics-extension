import type { ColumnTime, ItemType, StuckCard } from "../api";
import { formatDuration } from "../charts/format";
import { CardLink } from "./CardLink";
import { CardRef } from "./CardRef";
import { PeopleRefs, type Directory } from "./PersonLink";
import { StatusName } from "./StatusName";
import { SortTitle, sortRows, useSort } from "./SortTitle";

export function StuckList({
  slug,
  itemType,
  cards,
  columns: statuses,
  directory,
  taigaUrl,
  showIdle = true,
}: {
  slug: string;
  itemType: ItemType;
  cards: StuckCard[];
  columns: ColumnTime[];
  directory: Directory;
  taigaUrl: string | null;
  showIdle?: boolean;
}) {
  const [sort, onSort] = useSort();
  const columns = new Map(statuses.map((column) => [column.status_id, column]));
  return (
    <div className="stuck-list-scroll">
      <table className="table stuck-list-table">
        <thead>
          <tr>
            <th>
              <SortTitle label="Card" sortKey="card" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Status" sortKey="status" sort={sort} onSort={onSort} />
            </th>
            <th className="num" title="How long the card has been in its status">
              <SortTitle label="In the status" sortKey="days" sort={sort} onSort={onSort} />
            </th>
            <th className="num" title="85% of the past stays in the status were shorter">
              <SortTitle label="Usually within" sortKey="usual" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Level" sortKey="level" sort={sort} onSort={onSort} />
            </th>
            {showIdle && (
              <th
                className="num"
                title="Time since the last change or comment; for a person, no earlier than their assignment"
              >
                <SortTitle label="Idle" sortKey="idle" sort={sort} onSort={onSort} />
              </th>
            )}
            <th>
              <SortTitle label="Assigned" sortKey="assigned" sort={sort} onSort={onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sortRows(cards, sort, (card, key) =>
            key === "card"
              ? card.ref ?? card.item_id
              : key === "status"
                ? columns.get(card.status_id)?.name ?? ""
                : key === "days"
                  ? card.days_in_column
                  : key === "usual"
                    ? card.p85
                    : key === "level"
                      ? card.level
                      : key === "idle"
                        ? card.days_idle
                        : card.assignees.length,
          ).map((card) => {
            const column = columns.get(card.status_id);
            return (
              <tr key={card.item_id}>
                <td className="stuck-card-cell">
                  <CardRef
                    itemType={itemType}
                    itemId={card.item_id}
                    cardRef={card.ref}
                    isDeleted={false}
                    slug={slug}
                    taigaUrl={taigaUrl}
                  />{" "}
                  <CardLink
                    slug={slug}
                    itemType={itemType}
                    itemId={card.item_id}
                    subject={card.subject}
                  />
                </td>
                <td className="stuck-status-cell">
                  <StatusName
                    slug={slug}
                    itemType={itemType}
                    id={card.status_id}
                    name={column?.name ?? `Status ${card.status_id}`}
                    color={column?.color ?? null}
                  />
                </td>
                <td className="num">{formatDuration(card.days_in_column)}</td>
                <td className="num">{formatDuration(card.p85)}</td>
                <td className="stuck-level-cell">
                  <span
                    className={`badge ${
                      card.level === "red" ? "badge-accent-strong" : "badge-accent"
                    }`}
                    title={`85% of past stays within ${formatDuration(
                      card.p85,
                    )}, 95% within ${formatDuration(card.p95)}`}
                  >
                    {card.level === "red" ? "Much slower" : "Slower"}
                  </span>
                </td>
                {showIdle && <td className="num">{formatDuration(card.days_idle)}</td>}
                <td className="stuck-assigned-cell">
                  <PeopleRefs directory={directory} ids={card.assignees} nobody="Unassigned" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
