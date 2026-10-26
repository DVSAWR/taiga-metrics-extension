import { Fragment, type ReactNode } from "react";

import { CARD_BACKGROUND, FALLBACK_MARK, readable } from "../colors";

export interface GridStatus {
  id: number;
  name: string;
  color: string;
}

export interface GridColumn {
  key: string;
  title: ReactNode;
  hint?: string;
}

/**
 * A square per move from one status (a row) to another (a column), in the board's order.
 * Squares left of the diagonal are moves back, the diagonal stays empty. The caller draws
 * each square, extra columns before the statuses and after them, and a row opened under
 * a status, spanning the whole grid.
 */
export function TransitionGrid({
  statuses,
  cell,
  before = [],
  beforeCell,
  after,
  afterCell,
  opened = null,
  openedRow,
  corner = "From ↓ to →",
}: {
  statuses: GridStatus[];
  cell: (from: GridStatus, to: GridStatus) => ReactNode;
  before?: GridColumn[];
  beforeCell?: (status: GridStatus, column: GridColumn) => ReactNode;
  after?: GridColumn;
  afterCell?: (status: GridStatus) => ReactNode;
  opened?: number | null;
  openedRow?: (status: GridStatus) => ReactNode;
  corner?: string;
}) {
  const span = before.length + statuses.length + 1 + (after ? 1 : 0);
  return (
    <div className="tgrid-wrap">
      <table className="tgrid">
        <thead>
          <tr>
            {before.map((column) => (
              <th key={column.key} className="tgrid-extra" title={column.hint}>
                {column.title}
              </th>
            ))}
            <th className="tgrid-corner">{corner}</th>
            {statuses.map((status) => (
              <th key={status.id} className="tgrid-to" title={status.name}>
                <span className="tgrid-rot vertical-status-label">
                  <span
                    className="tgrid-dot"
                    style={{ background: readable(status.color, CARD_BACKGROUND, FALLBACK_MARK) }}
                  />
                  {status.name}
                </span>
              </th>
            ))}
            {after && (
              <th className="tgrid-extra" title={after.hint}>
                {after.title}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {statuses.map((from, row) => (
            <Fragment key={from.id}>
              <tr className={opened === from.id ? "tgrid-row-open" : undefined}>
                {before.map((column) => (
                  <td key={column.key} className="tgrid-extra">
                    {beforeCell?.(from, column)}
                  </td>
                ))}
                <th scope="row" className="tgrid-from">
                  <span
                    className="tgrid-dot"
                    style={{ background: readable(from.color, CARD_BACKGROUND, FALLBACK_MARK) }}
                  />
                  {from.name}
                </th>
                {statuses.map((to, column) => (
                  <td
                    key={to.id}
                    className={`tgrid-cell${
                      to.id === from.id ? " tgrid-self" : column < row ? " tgrid-back" : ""
                    }`}
                  >
                    {to.id === from.id ? null : cell(from, to)}
                  </td>
                ))}
                {after && <td className="tgrid-extra">{afterCell?.(from)}</td>}
              </tr>
              {opened === from.id && openedRow && (
                <tr className="expanded-row">
                  <td colSpan={span}>{openedRow(from)}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
