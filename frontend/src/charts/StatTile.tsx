import type { ReactNode } from "react";

import { Link } from "../router";

export function StatTile({
  label,
  value,
  detail,
  to,
  title,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  to?: string;
  title?: string;
}) {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="stat-tile stat-tile-link" title={title}>
      {content}
    </Link>
  ) : (
    <div className="stat-tile" title={title}>
      {content}
    </div>
  );
}
