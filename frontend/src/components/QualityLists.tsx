import type { ReactNode } from "react";
import type { FirstPassEvent, FlowResponse, ItemType, ReturnEvent } from "../api";
import { formatDateTime } from "../format";
import { CardTitle } from "./CardTitle";
import { PeopleRefs } from "./PersonLink";
import { SortTitle, sortRows, useSort } from "./SortTitle";
import { StatusName } from "./StatusName";

interface Props {
  flow: FlowResponse;
  slug: string;
  itemType: ItemType;
  taigaUrl: string | null;
  title: string;
}

function Status({
  flow,
  slug,
  itemType,
  id,
}: Pick<Props, "flow" | "slug" | "itemType"> & { id: number }) {
  const column = flow.report.columns.find((item) => item.status_id === id);
  return (
    <StatusName
      slug={slug}
      itemType={itemType}
      id={id}
      name={column?.name ?? `#${id}`}
      color={column?.color ?? "#9ca3af"}
    />
  );
}

export function FirstPassList({
  events,
  flow,
  slug,
  itemType,
  taigaUrl,
  title: heading,
  split,
}: Props & { events: FirstPassEvent[]; split?: ReactNode }) {
  const [sort, onSort] = useSort();
  const title = (label: string, key: string) => (
    <SortTitle label={label} sortKey={key} sort={sort} onSort={onSort} className="table-sort" />
  );
  return (
    <>
      <h3 className="metric-popup-title">
        {heading} · {events.length}
      </h3>
      {split}
      {events.length === 0 ? (
        <p className="muted">No cards.</p>
      ) : (
        <table className="table table-compact">
          <thead>
            <tr>
              <th>{title("Card", "card")}</th>
              <th>{title("Status passed", "status")}</th>
              <th>{title("Passed at", "when")}</th>
            </tr>
          </thead>
          <tbody>
            {sortRows(events, sort, (event, key) =>
              key === "card"
                ? event.ref ?? event.item_id
                : key === "status"
                  ? event.status_id
                  : event.passed_at,
            ).map((event, index) => (
              <tr key={`${event.item_id}:${event.status_id}:${index}`}>
                <td>
                  <CardTitle
                    slug={slug}
                    itemType={itemType}
                    itemId={event.item_id}
                    cardRef={event.ref}
                    subject={event.subject}
                    isDeleted={false}
                    taigaUrl={taigaUrl}
                  />
                </td>
                <td>
                  <Status flow={flow} slug={slug} itemType={itemType} id={event.status_id} />
                </td>
                <td className="nowrap">{formatDateTime(event.passed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function ReturnEventList({
  events,
  flow,
  slug,
  itemType,
  taigaUrl,
  title: heading,
  split,
}: Props & { events: ReturnEvent[]; split?: ReactNode }) {
  const [sort, onSort] = useSort();
  const title = (label: string, key: string) => (
    <SortTitle label={label} sortKey={key} sort={sort} onSort={onSort} className="table-sort" />
  );
  return (
    <>
      <h3 className="metric-popup-title">
        {heading} · {events.length}
      </h3>
      {split}
      {events.length === 0 ? (
        <p className="muted">No returns.</p>
      ) : (
        <table className="table table-compact">
          <thead>
            <tr>
              <th>{title("Card", "card")}</th>
              <th>{title("Return path", "path")}</th>
              <th>{title("Credited to", "credited")}</th>
              <th>{title("When", "when")}</th>
            </tr>
          </thead>
          <tbody>
            {sortRows(events, sort, (event, key) =>
              key === "card"
                ? event.ref ?? event.item_id
                : key === "path"
                  ? `${event.from_status}:${event.to_status}`
                  : key === "credited"
                    ? event.credited.map((id) => flow.people[String(id)] ?? `#${id}`).join(", ")
                    : event.happened_at,
            ).map((event, index) => (
              <tr key={`${event.item_id}:${event.happened_at}:${index}`}>
                <td>
                  <CardTitle
                    slug={slug}
                    itemType={itemType}
                    itemId={event.item_id}
                    cardRef={event.ref}
                    subject={event.subject}
                    isDeleted={false}
                    taigaUrl={taigaUrl}
                  />
                </td>
                <td>
                  <span className="move-line">
                    <Status flow={flow} slug={slug} itemType={itemType} id={event.from_status} />
                    <span className="move-arrow">→</span>
                    <Status flow={flow} slug={slug} itemType={itemType} id={event.to_status} />
                  </span>
                </td>
                <td>
                  <PeopleRefs directory={flow} ids={event.credited} nobody="Not determined" />
                </td>
                <td className="nowrap">{formatDateTime(event.happened_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
