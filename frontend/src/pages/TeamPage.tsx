import { useEffect, useState, type CSSProperties } from "react";

import {
  fetchMembers,
  fetchTeamStats,
  type Me,
  type Member,
  type PowerMetric,
  type ProjectSummary,
  type TeamStats,
} from "../api";
import { PeriodFilter } from "../components/PeriodFilter";
import { nextSort, SortTitle, type Sort } from "../components/SortTitle";
import { Toggle } from "../components/Toggle";
import { usePeriod } from "../filterState";
import { PersonLink } from "../components/PersonLink";
import { UserPhoto } from "../components/UserPhoto";
import { Icon, type IconName } from "../icons";
import { NotFoundPage } from "./HomePage";

type View = "taiga" | "extension";
type SortKey = string;

const TOTAL = "total";

const METRIC_ICONS: Record<string, IconName> = {
  briefcase: "briefcase",
  iocaine: "iocaine",
  edit: "edit",
  bug: "bug",
  task: "task",
  bulb: "bulb",
  horse: "horse",
  traveler: "backpack",
  message: "message",
  reload: "reload",
};

function displayName(member: Member): string {
  return member.full_name.trim() || member.username;
}

function opacities(values: number[]): (value: number) => number {
  const max = Math.max(0, ...values);
  const min = Math.min(...values);
  return (value) => {
    if (value === min) {
      return 0.1;
    }
    if (value === max) {
      return 1;
    }
    return (0.5 * value) / max;
  };
}

function padded(metrics: PowerMetric[], slots: number): (PowerMetric | null)[] {
  return [...metrics, ...Array.from({ length: slots - metrics.length }, () => null)];
}

function slotStyle(slots: number): CSSProperties {
  return { "--slots": slots } as CSSProperties;
}

interface Scores {
  value: (member: Member, metric: PowerMetric) => number;
  total: (member: Member) => number;
  opacity: (metric: PowerMetric, value: number) => number;
}

function MemberRow({
  member,
  columns,
  slots,
  scores,
  isOwner,
  hero,
}: {
  member: Member;
  columns: PowerMetric[];
  slots: number;
  scores: Scores;
  isOwner: boolean;
  hero?: boolean;
}) {
  const name = displayName(member);
  return (
    <div className={`team-row${hero ? " team-hero" : ""}`}>
      <div className="team-username">
        <span className="team-avatar">
          <UserPhoto userId={member.user_id} />
        </span>
        <div className="team-avatar-data">
          <span className="team-name">
            <PersonLink name={name} username={member.username} />
            {isOwner && (
              <span title="Project Owner" className="team-owner">
                <Icon name="badge" />
              </span>
            )}
          </span>
          <span className="team-position">{member.role}</span>
        </div>
      </div>
      <div className="team-stats" style={slotStyle(slots)}>
        <div className="team-switch-cell" />
        {padded(columns, slots).map((metric, index) => {
          if (!metric) {
            return <div key={`empty-${index}`} className="team-attribute" />;
          }
          const count = scores.value(member, metric);
          const opacity = scores.opacity(metric, count);
          return (
            <div key={metric.key} className="team-attribute">
              <span className={`team-attribute-value${opacity === 1 && count > 0 ? " top" : ""}`}>
                <Icon name={METRIC_ICONS[metric.icon] ?? "task"} style={{ opacity }} />
                <span className="team-value-tip">
                  {metric.explanation}: {metric.weight < 0 && count > 0 ? "-" : ""}
                  {count}
                </span>
              </span>
            </div>
          );
        })}
        <div className="team-attribute">
          <span className="team-points">{scores.total(member)}</span>
        </div>
      </div>
    </div>
  );
}

export function TeamPage({
  slug,
  projects,
  me,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
  me: Me;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [view, setView] = useState<View>("taiga");
  const [sort, setSort] = useState<Sort | null>(null);
  const [period, setPeriod] = usePeriod(slug);

  useEffect(() => {
    let cancelled = false;
    setMembers(null);
    Promise.all([fetchMembers(slug), fetchTeamStats(slug, period)])
      .then(([nextMembers, nextStats]) => {
        if (!cancelled) {
          setMembers(nextMembers);
          setStats(nextStats);
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
  }, [slug, period]);

  if (projects && !project) {
    return <NotFoundPage />;
  }

  const visible = (metric: PowerMetric) =>
    metric.module === null || Boolean(stats?.modules.includes(metric.module));
  const hasExtension = stats?.metrics.some((metric) => metric.source === "extension") ?? false;
  const shown: View = hasExtension ? view : "taiga";
  const groups = {
    taiga: stats?.metrics.filter((metric) => metric.source === "taiga" && visible(metric)) ?? [],
    extension:
      stats?.metrics.filter((metric) => metric.source === "extension" && visible(metric)) ?? [],
  };
  const columns = groups[shown];
  const slots = Math.max(groups.taiga.length, groups.extension.length);

  const value = (member: Member, metric: PowerMetric) =>
    stats?.values[metric.key]?.[String(member.user_id)] ?? 0;
  const opacityOf = new Map<string, (count: number) => number>();
  for (const metric of stats?.metrics ?? []) {
    opacityOf.set(metric.key, opacities((members ?? []).map((member) => value(member, metric))));
  }
  const scores: Scores = {
    value,
    total: (member) =>
      (stats?.metrics ?? []).reduce(
        (sum, metric) => sum + value(member, metric) * metric.weight,
        0,
      ),
    opacity: (metric, count) => opacityOf.get(metric.key)?.(count) ?? 1,
  };

  const onSort = (key: SortKey) => setSort((current) => nextSort(current, key));
  const sortValue = (member: Member) => {
    if (!sort) {
      return 0;
    }
    if (sort.key === TOTAL) {
      return scores.total(member);
    }
    const metric = stats?.metrics.find((candidate) => candidate.key === sort.key);
    return metric ? value(member, metric) : 0;
  };

  const roles = [...new Set(members?.map((member) => member.role).filter(Boolean) ?? [])];
  const current = members?.find((member) => member.user_id === me.id) ?? null;
  const others = (members ?? []).filter(
    (member) =>
      member.user_id !== me.id &&
      (role === null || member.role === role) &&
      displayName(member).toLowerCase().includes(query.trim().toLowerCase()),
  );
  if (sort) {
    others.sort((a, b) =>
      sort.direction === "asc" ? sortValue(a) - sortValue(b) : sortValue(b) - sortValue(a),
    );
  }
  const owners = new Set(members?.filter((member) => member.is_owner).map((m) => m.user_id));

  return (
    <div className="team-page">
      <aside className="team-filters">
        <header>
          <h2 className="team-filters-title">Filters</h2>
        </header>
        <form className="team-search" onSubmit={(event) => event.preventDefault()}>
          <input
            type="text"
            className="taiga-input"
            placeholder="Search by full name..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Icon name="search" />
        </form>
        <div className="team-period">
          <PeriodFilter slug={slug} period={period} onChange={setPeriod} withDays={false} />
        </div>
        <ul className="team-roles">
          {[null, ...roles].map((option) => (
            <li key={option ?? "all"} className={role === option ? "active" : ""}>
              <button type="button" onClick={() => setRole(option)}>
                <span>{option ?? "All"}</span>
                <Icon name="arrowRight" />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="team-main">
        <h1>Team</h1>
        {error && <div className="banner banner-fail">{error}</div>}
        {!members && !error && <p className="muted">Loading...</p>}
        {members && stats && (
          <>
            <div className="team-table">
              <div className="team-row team-header">
                <div className="team-username" />
                <div className="team-stats" style={slotStyle(slots)}>
                  <div className="team-switch-cell">
                    {hasExtension && (
                      <Toggle
                        checked={shown === "extension"}
                        onChange={(checked) => setView(checked ? "extension" : "taiga")}
                        label={
                          shown === "taiga"
                            ? "Show the extension's metrics"
                            : "Show Taiga's metrics"
                        }
                      />
                    )}
                  </div>
                  {padded(columns, slots).map((metric, index) =>
                    metric ? (
                      <div key={metric.key} className="team-attribute">
                        <SortTitle
                          label={metric.title}
                          sortKey={metric.key}
                          sort={sort}
                          onSort={onSort}
                        />
                        <div className="team-tooltip">{metric.explanation}</div>
                      </div>
                    ) : (
                      <div key={`empty-${index}`} className="team-attribute" />
                    ),
                  )}
                  <div className="team-attribute">
                    <SortTitle label="Total Power" sortKey={TOTAL} sort={sort} onSort={onSort} />
                    <div className="team-tooltip">Total Points</div>
                  </div>
                </div>
              </div>
              {current && (
                <MemberRow
                  member={current}
                  columns={columns}
                  slots={slots}
                  scores={scores}
                  isOwner={owners.has(current.user_id)}
                  hero
                />
              )}
            </div>
            <h2 className="team-section">
              <span>Team &gt; </span>
              <span>{role ?? "All"}</span>
            </h2>
            <div className="team-table">
              {others.map((member) => (
                <MemberRow
                  key={member.user_id}
                  member={member}
                  columns={columns}
                  slots={slots}
                  scores={scores}
                  isOwner={owners.has(member.user_id)}
                />
              ))}
              {others.length === 0 && <p className="muted">Nobody matches.</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
