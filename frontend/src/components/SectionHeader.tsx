import type { ReactNode } from "react";

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2 className="page-subtitle">{title}</h2>
        <p className="muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
