import { Fragment, type ReactNode } from "react";

import type { BreakdownRow, ItemType } from "../api";
import type { CountKind } from "../cardLists";
import { fillWidth, formatDuration } from "../charts/format";
import { CARD_BACKGROUND, FALLBACK_MARK, readable } from "../colors";
import { firstTime, formatNumber } from "../format";
import { MetricPopup } from "./MetricPopup";
import { rolePath } from "../router";
import { usePersonPath } from "./PersonLink";
import { StatusName } from "./StatusName";
import { TextLink } from "./TextLink";

const NEUTRAL = "#a9aabc";

const DONE_LABEL: Record<BreakdownRow["kind"], string> = {
  role: "Passed through",
  person: "Stays closed",
  status: "Stays closed",
};

const TIME_LABEL: Record<BreakdownRow["kind"], string> = {
  role: "Time in its statuses",
  person: "Median stay",
  status: "Median stay",
};

function Name({ slug, itemType, row }: { slug: string; itemType: ItemType; row: BreakdownRow }) {
  const personLink = usePersonPath(row.kind === "person" ? row.id : null);
  if (row.kind === "status") {
    return (
      <StatusName slug={slug} itemType={itemType} id={row.id} name={row.name} color={row.color} />
    );
  }
  if (row.kind === "role") {
    return <TextLink to={rolePath(slug, row.id)}>{row.name}</TextLink>;
  }
  return personLink ? <TextLink to={personLink}>{row.name}</TextLink> : <span>{row.name}</span>;
}

export function Breakdown({
  slug,
  itemType,
  rows,
  expand,
}: {
  slug: string;
  itemType: ItemType;
  rows: BreakdownRow[];
  expand?: (row: BreakdownRow, count: CountKind) => ReactNode;
}) {
  const count = (row: BreakdownRow, kind: CountKind, value: number) =>
    !value ? (
      "·"
    ) : expand ? (
      <MetricPopup label={`Show ${row.name}: ${kind}`} content={expand(row, kind)}>
        {formatNumber(value)}
      </MetricPopup>
    ) : (
      formatNumber(value)
    );
  const kind = rows[0]?.kind ?? "role";
  const shares = rows.some((row) => row.share !== null);
  return (
    <div className="wide-table-scroll">
      <table className="table breakdown-table">
        <thead>
          <tr>
            <th>{kind === "role" ? "Role" : kind === "person" ? "Person" : "Status"}</th>
            <th className="num">In progress</th>
            <th className="num">Stuck</th>
            <th className="num">{DONE_LABEL[kind]}</th>
            <th className="num">{TIME_LABEL[kind]}</th>
            {shares && <th className="bar-cell">Share of the time</th>}
            <th className="num">First time</th>
            <th className="num">Came back</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = `${row.kind}:${row.id}`;
            const color = readable(row.color || NEUTRAL, CARD_BACKGROUND, FALLBACK_MARK);
            return (
              <Fragment key={key}>
                <tr>
                  <td>
                    <Name slug={slug} itemType={itemType} row={row} />
                    {row.member === false && <span className="badge badge-muted">Other role</span>}
                  </td>
                  <td className="num">{count(row, "in_progress", row.in_now)}</td>
                  <td className={`num${row.stuck ? " over-limit" : ""}`}>
                    {count(row, "stuck", row.stuck)}
                  </td>
                  <td className="num">{count(row, "finished", row.done)}</td>
                  <td className="num">{formatDuration(row.p50)}</td>
                  {shares && (
                    <td className="bar-cell">
                      <span className="inline-track">
                        <span
                          className="inline-bar"
                          style={{ ...fillWidth((row.share ?? 0) * 100), background: color }}
                        />
                      </span>
                      <span className="bar-share">
                        {row.share === null ? "" : `${Math.round(row.share * 100)}%`}
                      </span>
                    </td>
                  )}
                  <td className="num">
                    {count(row, "first_time", row.clean_passes)}
                    <span className="quality-percent">
                      {firstTime(row.passes, row.clean_passes)}
                    </span>
                  </td>
                  <td className="num">{count(row, "returns", row.returns)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
