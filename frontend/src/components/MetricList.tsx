import type { FlowResponse, ItemType } from "../api";
import type { OpenedList } from "../cardLists";
import { CardsBreakdown, DonutSplit, statusColor, type Slice } from "../pages/FlowMetrics";
import { columnPath } from "../router";
import { FirstPassList, ReturnEventList } from "./QualityLists";

function EventSplit({
  flow,
  slug,
  itemType,
  statusIds,
  caption,
}: {
  flow: FlowResponse;
  slug: string;
  itemType: ItemType;
  statusIds: number[];
  caption: string;
}) {
  const counts = new Map<number, number>();
  for (const id of statusIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  if (counts.size === 0) return null;
  const columns = new Map(flow.report.columns.map((column) => [column.status_id, column]));
  const order = new Map(flow.report.columns.map((column, index) => [column.status_id, index]));
  const slices: Slice[] = [...counts.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
    .map(([id, count]) => ({
      key: String(id),
      label: null,
      name: columns.get(id)?.name ?? `Status ${id}`,
      to: columnPath(slug, itemType, id),
      color: statusColor(flow, id, false),
      count,
    }));
  return <DonutSplit slices={slices} total={statusIds.length} caption={caption} />;
}

export function MetricList({
  list,
  flow,
  slug,
  itemType,
  taigaUrl,
  showSplit = false,
}: {
  list: OpenedList;
  flow: FlowResponse;
  slug: string;
  itemType: ItemType;
  taigaUrl: string | null;
  showSplit?: boolean;
}) {
  const props = { flow, slug, itemType, taigaUrl, title: list.title };
  if (list.firstPasses)
    return (
      <FirstPassList
        {...props}
        events={list.firstPasses}
        split={
          showSplit && (
            <EventSplit
              flow={flow}
              slug={slug}
              itemType={itemType}
              statusIds={list.firstPasses.map((event) => event.status_id)}
              caption="passes"
            />
          )
        }
      />
    );
  if (list.returns)
    return (
      <ReturnEventList
        {...props}
        events={list.returns}
        split={
          showSplit && (
            <EventSplit
              flow={flow}
              slug={slug}
              itemType={itemType}
              statusIds={list.returns.map((event) => event.credited_status)}
              caption="returns"
            />
          )
        }
      />
    );
  return (
    <>
      <h3 className="metric-popup-title">
        {list.title} · {list.cards.length}
      </h3>
      <CardsBreakdown
        flow={flow}
        slug={slug}
        itemType={itemType}
        taigaUrl={taigaUrl}
        cards={list.cards}
        caption={list.cards.length === 1 ? "card" : "cards"}
        timeLabel={list.timeLabel}
        showSplit={showSplit}
      />
    </>
  );
}
