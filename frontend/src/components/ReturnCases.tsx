import type { FlowResponse, ReturnCase } from "../api";
import { formatDateTime, formatNumber } from "../format";
import { MetricCard } from "../pages/FlowMetrics";
import { CardTitle } from "./CardTitle";
import { StatusName } from "./StatusName";
import { SortTitle, sortRows, useSort } from "./SortTitle";

function ReturnPath({
  caseItem,
  slug,
  flow,
}: {
  caseItem: ReturnCase;
  slug: string;
  flow: FlowResponse;
}) {
  const status = (id: number) => {
    const column = flow.report.columns.find((item) => item.status_id === id);
    return (
      <StatusName
        slug={slug}
        itemType="userstory"
        id={id}
        name={column?.name ?? `#${id}`}
        color={column?.color ?? null}
      />
    );
  };
  return (
    <span className="move-line">
      {status(caseItem.from_status)}
      <span className="move-arrow">→</span>
      {status(caseItem.to_status)}
      {caseItem.kind === "unlinked_route" && <span className="muted-inline">(entry missing)</span>}
    </span>
  );
}

export function ReturnCases({
  flow,
  slug,
  taigaUrl,
}: {
  flow: FlowResponse;
  slug: string;
  taigaUrl: string | null;
}) {
  const [sort, onSort] = useSort();
  const title = (label: string, key: string) => (
    <SortTitle label={label} sortKey={key} sort={sort} onSort={onSort} className="table-sort" />
  );
  const returns = flow.report.back_moves;
  const names = new Map(flow.report.columns.map((column) => [column.status_id, column.name]));
  const name = (id: number) => names.get(id) ?? `#${id}`;
  const unresolved = returns.cases.filter(
    (caseItem) => caseItem.kind === "rework" && caseItem.routed_to === null,
  ).length;
  return (
    <MetricCard
      title="Returns and routing"
      subtitle="An entry to REWORK records a return to development. Its exit records the chosen direction. Both belong to one linked case. These are returns under the project rules, not verified defects. Counts use the selected period and filters."
      tableLabel={`Show ${returns.cases.length} return cases observed in the period`}
      table={
        returns.cases.length > 0 ? (
          <table className="table table-compact move-events">
            <thead>
              <tr>
                <th>{title("Card", "card")}</th>
                <th>{title("First recorded", "when")}</th>
                <th>{title("Return path", "path")}</th>
                <th>{title("Routed by period end", "route")}</th>
              </tr>
            </thead>
            <tbody>
              {sortRows(returns.cases, sort, (item, key) =>
                key === "card"
                  ? item.ref ?? item.item_id
                  : key === "path"
                    ? `${item.from_status}:${item.to_status}`
                    : key === "route"
                      ? item.routed_to
                      : item.detected_at,
              ).map((caseItem, index) => (
                <tr key={`${caseItem.item_id}:${caseItem.detected_at}:${index}`}>
                  <td>
                    <CardTitle
                      slug={slug}
                      itemType="userstory"
                      itemId={caseItem.item_id}
                      cardRef={caseItem.ref}
                      subject={caseItem.subject}
                      isDeleted={false}
                      taigaUrl={taigaUrl}
                    />
                  </td>
                  <td className="nowrap">{formatDateTime(caseItem.detected_at)}</td>
                  <td>
                    <ReturnPath caseItem={caseItem} slug={slug} flow={flow} />
                  </td>
                  <td>
                    {caseItem.kind === "rework" ? (
                      caseItem.routed_to === null ? (
                        "No decision yet in this period"
                      ) : (
                        <>
                          {
                            <StatusName
                              slug={slug}
                              itemType="userstory"
                              id={caseItem.routed_to}
                              name={name(caseItem.routed_to)}
                              color={
                                flow.report.columns.find(
                                  (column) => column.status_id === caseItem.routed_to,
                                )?.color ?? null
                              }
                            />
                          }{" "}
                          · {formatDateTime(caseItem.routed_at)}
                        </>
                      )
                    ) : (
                      "At detection"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : undefined
      }
    >
      <div className="return-case-summary">
        <div>
          <strong>{formatNumber(returns.cases.length)}</strong>
          <span>return cases observed</span>
        </div>
        <div>
          <strong>{formatNumber(returns.rework_entries)}</strong>
          <span>returned to development</span>
        </div>
        <div>
          <strong>{formatNumber(returns.rework_routes)}</strong>
          <span>routed from REWORK</span>
        </div>
        <div>
          <strong>{formatNumber(unresolved)}</strong>
          <span>without route by period end</span>
        </div>
      </div>
    </MetricCard>
  );
}
