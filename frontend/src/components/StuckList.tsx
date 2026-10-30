import type { ColumnTime, ItemType, StuckCard } from "../api";
import { formatDuration } from "../charts/format";
import { CardLink } from "./CardLink";
import { CardRef } from "./CardRef";
import { PeopleRefs, PersonRef, type Directory } from "./PersonLink";
import { AgingBadges } from "./AgingBadges";
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
  showCreatedBy = false,
}: {
  slug: string;
  itemType: ItemType;
  cards: StuckCard[];
  columns: ColumnTime[];
  directory: Directory;
  taigaUrl: string | null;
  showIdle?: boolean;
  showCreatedBy?: boolean;
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
            <th
              className="num"
              title="Time since creation, compared with completed card ages across the whole project history"
            >
              <SortTitle label="Age" sortKey="age" sort={sort} onSort={onSort} />
            </th>
            <th
              className="num"
              title="All visits to this status added together, compared with completed per-card totals across the whole project history"
            >
              <SortTitle label="Total in status" sortKey="days" sort={sort} onSort={onSort} />
            </th>
            <th className="num" title="Time since the latest entry into this status">
              <SortTitle label="Current stay" sortKey="stay" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortTitle label="Overdue by" sortKey="level" sort={sort} onSort={onSort} />
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
            {showCreatedBy && <th>Created by</th>}
          </tr>
        </thead>
        <tbody>
          {sortRows(cards, sort, (card, key) =>
            key === "card"
              ? card.ref ?? card.item_id
              : key === "status"
                ? columns.get(card.status_id)?.name ?? ""
                : key === "days"
                  ? card.days_in_status
                  : key === "age"
                    ? card.age_days
                    : key === "stay"
                      ? card.days_in_column
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
                <td className="num">
                  {formatDuration(card.calendar_age_days)}
                  {card.age_days !== card.calendar_age_days && (
                    <span className="aging-baseline">{formatDuration(card.age_days)} working</span>
                  )}
                  <span className="aging-baseline">
                    Usually {formatDuration(card.age_p85)}
                    {card.age_days !== card.calendar_age_days ? " working" : ""}
                  </span>
                </td>
                <td className="num">
                  {formatDuration(card.days_in_status)}
                  <span className="aging-baseline">Usually {formatDuration(card.p85)}</span>
                </td>
                <td className="num">{formatDuration(card.days_in_column)}</td>
                <td className="stuck-level-cell">
                  <AgingBadges card={card} />
                </td>
                {showIdle && <td className="num">{formatDuration(card.days_idle)}</td>}
                <td className="stuck-assigned-cell">
                  <PeopleRefs directory={directory} ids={card.assignees} nobody="Unassigned" />
                </td>
                {showCreatedBy && (
                  <td>
                    <PersonRef directory={directory} id={card.created_by} nobody="Unknown" />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
