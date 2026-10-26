import { useEffect, useState } from "react";

import {
  fetchColumns,
  fetchRoles,
  setColumnReturn,
  setColumnRoles,
  setColumnType,
  setReturnPairs,
  setReturnSettings,
  type ColumnInfo,
  type ColumnMode,
  type ColumnType,
  type Credit,
  type ItemType,
  type ItemTypeColumns,
  type ReturnPair,
  type ReturnSettings,
  type RoleRef,
} from "../api";
import { Dropdown } from "../components/Dropdown";
import { SectionHeader } from "../components/SectionHeader";
import { Toggle } from "../components/Toggle";
import { TransitionGrid, type GridStatus } from "../components/TransitionGrid";
import { Icon } from "../icons";
import { readStored, writeStored } from "../storage";

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: "queue", label: "Queue" },
  { value: "work", label: "Work" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const ITEM_TYPE_TITLES: Record<ItemType, string> = {
  userstory: "User stories",
  task: "Tasks",
  issue: "Issues",
  epic: "Epics",
};

const MODE_OPTIONS: { value: ColumnMode; label: string }[] = [
  { value: "normal", label: "Normal work" },
  { value: "pause", label: "Waiting for a decision" },
  { value: "triage", label: "Return triage" },
];

const CREDIT_OPTIONS: { value: Credit; label: string }[] = [
  { value: "author_reviewer", label: "Author + reviewer after code review" },
  { value: "assignees", label: "Assignees before the move" },
  { value: "author", label: "Who did the work it came back to" },
  { value: "everyone", label: "Everyone who moved it on since" },
];

const TAB_KEY = "settings-item-type";

type PairKey = `${number}>${number}`;

function pairKey(from: number, to: number): PairKey {
  return `${from}>${to}`;
}

/** Whether the rules alone make a move a return, for a square nobody marked. */
function ruleSays(from: ColumnInfo, to: ColumnInfo, rules: ReturnSettings): boolean {
  if (from.type === "cancelled" || to.type === "cancelled") {
    return false;
  }
  if (to.name.trim().toUpperCase() === "REWORK") {
    return ["EXPERTISE ACCEPTANCE", "PRODUCT ACCEPTANCE"].includes(from.name.trim().toUpperCase());
  }
  if (rules.out_of_done && from.type === "done" && to.type !== "done") {
    return true;
  }
  return rules.earlier && to.position < from.position;
}

function RolesCell({
  column,
  roles,
  onRoles,
}: {
  column: ColumnInfo;
  roles: RoleRef[];
  onRoles: (roleIds: number[]) => void;
}) {
  const name = new Map(roles.map((role) => [role.id, role.name]));
  const free = roles.filter((role) => !column.roles.includes(role.id));
  return (
    <span className="grid-roles">
      {column.roles.map((id) => (
        <span key={id} className="grid-role">
          {name.get(id) ?? `#${id}`}
          <button
            type="button"
            aria-label={`Remove ${name.get(id) ?? id} from ${column.name}`}
            onClick={() => onRoles(column.roles.filter((role) => role !== id))}
          >
            ×
          </button>
        </span>
      ))}
      {free.length > 0 && (
        <Dropdown
          className={`grid-add-dropdown${column.roles.length === 0 ? " grid-add-first" : ""}`}
          label={`Add a role responsible for ${column.name}`}
          value=""
          placeholder={column.roles.length ? "+" : "+ role"}
          options={free.map((role) => ({ value: String(role.id), label: role.name }))}
          onChange={(value) => onRoles([...column.roles, Number(value)].sort((a, b) => a - b))}
        />
      )}
    </span>
  );
}

function StatusSettings({
  shown,
  roles,
  onType,
  onRoles,
  onMode,
}: {
  shown: ColumnInfo[];
  roles: RoleRef[];
  onType: (statusId: number, type: ColumnType | null) => void;
  onRoles: (statusId: number, roleIds: number[]) => void;
  onMode: (statusId: number, mode: ColumnMode) => void;
}) {
  return (
    <div className="wide-table-scroll">
      <table className="table settings-status-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Type</th>
            <th>Responsible roles</th>
            <th>Return handling</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((column) => (
            <tr key={column.status_id}>
              <th scope="row">
                <span className="column-name">
                  <span className="column-color" style={{ background: column.color }} />
                  {column.name}
                  {column.is_deleted && " (removed)"}
                </span>
              </th>
              <td>
                <Dropdown
                  className={`grid-select type-select type-${column.type ?? "none"}`}
                  label={`Type of ${column.name}`}
                  value={column.type ?? ""}
                  options={[{ value: "", label: "Not set" }, ...TYPE_OPTIONS]}
                  onChange={(value) =>
                    onType(column.status_id, (value || null) as ColumnType | null)
                  }
                />
              </td>
              <td>
                <RolesCell
                  column={column}
                  roles={roles}
                  onRoles={(ids) => onRoles(column.status_id, ids)}
                />
              </td>
              <td>
                <Dropdown
                  className={`grid-select mode-${column.return_mode}`}
                  label={`${column.name} in returns`}
                  value={column.return_mode}
                  options={MODE_OPTIONS}
                  onChange={(value) => onMode(column.status_id, value as ColumnMode)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReturnsGrid({
  group,
  shown,
  onPairs,
}: {
  group: ItemTypeColumns;
  shown: ColumnInfo[];
  onPairs: (pairs: ReturnPair[]) => void;
}) {
  const byId = new Map(group.columns.map((column) => [column.status_id, column]));
  const marks = new Map(
    group.return_pairs.map((pair) => [pairKey(pair.from_status, pair.to_status), pair.is_return]),
  );
  const statuses: GridStatus[] = shown.map((column) => ({
    id: column.status_id,
    name: column.is_deleted ? `${column.name} (removed)` : column.name,
    color: column.color,
  }));
  const effective = (from: ColumnInfo, to: ColumnInfo) =>
    marks.get(pairKey(from.status_id, to.status_id)) ?? ruleSays(from, to, group.returns);
  const save = (next: Map<PairKey, boolean>) =>
    onPairs(
      [...next.entries()].map(([key, isReturn]) => {
        const [from, to] = key.split(">").map(Number);
        return { from_status: from ?? 0, to_status: to ?? 0, is_return: isReturn };
      }),
    );
  const mark = (from: ColumnInfo, to: ColumnInfo, value: boolean, next: Map<PairKey, boolean>) => {
    const key = pairKey(from.status_id, to.status_id);
    if (value === ruleSays(from, to, group.returns)) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  };
  const seenThrough = (column: ColumnInfo) => column.return_mode === "pause";
  return (
    <TransitionGrid
      statuses={statuses}
      cell={(fromStatus, toStatus) => {
        const from = byId.get(fromStatus.id);
        const to = byId.get(toStatus.id);
        if (!from || !to) {
          return null;
        }
        if (seenThrough(from) || seenThrough(to)) {
          return (
            <span
              className="tgrid-btn tgrid-pause"
              title={`${from.name} → ${to.name}: a decision pause is not a return by itself`}
            />
          );
        }
        const key = pairKey(from.status_id, to.status_id);
        const on = effective(from, to);
        const marked = marks.has(key);
        return (
          <button
            type="button"
            className={`tgrid-btn${on ? " on" : ""}${marked ? " marked" : ""}`}
            aria-pressed={on}
            title={`${from.name} → ${to.name}: ${on ? "a return" : "not a return"}${
              marked ? ", marked here" : ", by the rules below"
            }. Click to change.`}
            onClick={() => {
              const next = new Map(marks);
              mark(from, to, !on, next);
              save(next);
            }}
          >
            {on && <Icon name="arrowBackUp" />}
          </button>
        );
      }}
    />
  );
}

function ReturnExceptions({ group }: { group: ItemTypeColumns }) {
  const byId = new Map(group.columns.map((column) => [column.status_id, column]));
  const exceptions = group.return_pairs.filter((pair) => {
    const from = byId.get(pair.from_status);
    const to = byId.get(pair.to_status);
    return !from || !to || pair.is_return !== ruleSays(from, to, group.returns);
  });
  const matching = group.return_pairs.length - exceptions.length;
  return (
    <div className="returns-block">
      <h3>Explicit transition rules</h3>
      {exceptions.length === 0 ? (
        <p className="muted">No exceptions to the general rules.</p>
      ) : (
        <ul className="return-exceptions">
          {exceptions.map((pair) => (
            <li key={pairKey(pair.from_status, pair.to_status)}>
              {byId.get(pair.from_status)?.name ?? `#${pair.from_status}`} →{" "}
              {byId.get(pair.to_status)?.name ?? `#${pair.to_status}`}
              <strong>{pair.is_return ? "Return" : "Not a return"}</strong>
            </li>
          ))}
        </ul>
      )}
      {matching > 0 && (
        <p className="muted">
          {matching} saved {matching === 1 ? "mark matches" : "marks match"} the current general
          rule. They still apply if the status order or general rule changes.
        </p>
      )}
      <p className="muted">
        A decision in PROJECT MEETING does not automatically mean that earlier work failed. Moves
        across it count as returns only when the source and destination are explicitly marked in
        the matrix.
      </p>
    </div>
  );
}

function RulesBlock({
  settings,
  onChange,
}: {
  settings: ReturnSettings;
  onChange: (settings: ReturnSettings) => void;
}) {
  return (
    <div className="returns-block">
      <h3>General return rules</h3>
      <div className="form-rows returns-rows">
        <label className="form-row">
          <span className="form-label">Counts</span>
          <span className="returns-checks">
            <span className="check-line">
              <Toggle
                checked={settings.earlier}
                onChange={(earlier) => onChange({ ...settings, earlier })}
                label="A move to an earlier status in Taiga's order is a return"
              />
              <span>A move to an earlier status in Taiga's order (left of the diagonal)</span>
            </span>
            <span className="check-line">
              <Toggle
                checked={settings.out_of_done}
                onChange={(outOfDone) => onChange({ ...settings, out_of_done: outOfDone })}
                label="A move out of a Done status is a return"
              />
              <span>A move out of a Done status</span>
            </span>
          </span>
        </label>
        <p className="muted">
          Only EXPERTISE ACCEPTANCE and PRODUCT ACCEPTANCE send cards into REWORK. Those moves
          count as returns regardless of board order.
        </p>
        <label className="form-row">
          <span className="form-label">Misclick</span>
          <span>
            <input
              type="number"
              className="taiga-input returns-minutes"
              min={0}
              max={1440}
              value={settings.misclick_minutes}
              onChange={(event) =>
                onChange({
                  ...settings,
                  misclick_minutes: Math.max(0, Math.min(1440, Number(event.target.value) || 0)),
                })
              }
            />{" "}
            <span className="muted-inline">
              minutes: a move undone this quickly is a mistake, and a shorter stay only passed
              through. REWORK routing still counts when the decision is quick.
            </span>
          </span>
        </label>
        <div className="form-row">
          <span className="form-label">Credited to</span>
          <Dropdown
            className="select"
            label="Who a return is credited to"
            options={CREDIT_OPTIONS}
            value={settings.credit}
            onChange={(credit) => onChange({ ...settings, credit: credit as Credit })}
          />
          {settings.credit === "author_reviewer" && (
            <p className="muted">
              Inferred from who moved the card out of its work status. If a later check sends it
              through REWORK, the person who moved it out of the matching code review is also
              credited. An administrative move may need a manual correction; missing actors stay
              unattributed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <p className="tgrid-legend">
      <span className="tgrid-btn on">
        <Icon name="arrowBackUp" />
      </span>
      a return
      <span className="tgrid-btn" />
      not a return
      <span className="tgrid-btn on marked">
        <Icon name="arrowBackUp" />
      </span>
      saved mark
      <span className="tgrid-btn tgrid-pause" />
      decision pause
      <span className="muted-inline">
        · a row is where the card leaves, a column where it goes; the shaded half is moves back
      </span>
    </p>
  );
}

export function ColumnsSection({ slug }: { slug: string }) {
  const [groups, setGroups] = useState<ItemTypeColumns[] | null>(null);
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(() => readStored(TAB_KEY));

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchColumns(slug), fetchRoles(slug)])
      .then(([next, nextRoles]) => {
        if (!cancelled) {
          setGroups(next);
          setRoles(nextRoles);
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
  }, [slug]);

  const failed = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : String(reason));

  const patchGroup = (itemType: ItemType, patch: (group: ItemTypeColumns) => ItemTypeColumns) =>
    setGroups(
      (current) =>
        current?.map((group) => (group.item_type === itemType ? patch(group) : group)) ?? null,
    );

  const update = (itemType: ItemType, statusId: number, patch: Partial<ColumnInfo>) =>
    patchGroup(itemType, (group) => ({
      ...group,
      columns: group.columns.map((column) =>
        column.status_id === statusId ? { ...column, ...patch } : column,
      ),
    }));

  const group = groups?.find((candidate) => candidate.item_type === tab) ?? groups?.[0] ?? null;
  const pick = (itemType: ItemType) => {
    writeStored(TAB_KEY, itemType);
    setTab(itemType);
  };

  return (
    <>
      <SectionHeader
        title="General"
        subtitle="What each Taiga status means for flow metrics, who works in it, and which moves between statuses are returns. Order and names come from Taiga."
      />
      <div className="banner banner-info">
        <dl className="type-legend">
          <div>
            <dt>Queue</dt>
            <dd>waiting, nobody works on it yet.</dd>
          </div>
          <div>
            <dt>Work</dt>
            <dd>someone works on it; cycle time starts at the first Work status. Required.</dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>
              finished; lead and cycle time end here, and moving on to another Done status such as
              Archive keeps the card finished. Required.
            </dd>
          </div>
          <div>
            <dt>Cancelled</dt>
            <dd>
              put aside without being done: postponed, back to the backlog, or dropped. Kept out of
              throughput and stuck cards.
            </dd>
          </div>
          <div>
            <dt>Responsible roles</dt>
            <dd>
              the Taiga roles whose members do the work in a status: a direction is a role and the
              statuses it answers for.
            </dd>
          </div>
          <div>
            <dt>Returns</dt>
            <dd>
              moving to an earlier status normally counts as a return. A decision pause such as
              PROJECT MEETING does not prove a defect, even when the card then goes back; that
              route needs an explicit rule. REWORK receives failed acceptance and records the
              return to development and the subsequent direction separately. A status marked Return
              triage instead credits its incoming return to the status chosen next.
            </dd>
          </div>
        </dl>
      </div>
      {error && <div className="banner banner-fail">{error}</div>}
      {!groups && !error && <p className="muted">Loading...</p>}
      {groups && groups.length > 1 && (
        <nav className="tabs" aria-label="Card type">
          {groups.map((candidate) => (
            <button
              key={candidate.item_type}
              type="button"
              className={`tab tab-button${candidate === group ? " active" : ""}`}
              onClick={() => pick(candidate.item_type)}
            >
              {ITEM_TYPE_TITLES[candidate.item_type]}
            </button>
          ))}
        </nav>
      )}
      {group && (
        <TypeSection
          key={group.item_type}
          group={group}
          roles={roles}
          onType={(statusId, type) => {
            update(group.item_type, statusId, { type });
            setColumnType(slug, group.item_type, statusId, type).catch(failed);
          }}
          onRoles={(statusId, roleIds) => {
            update(group.item_type, statusId, { roles: roleIds });
            setColumnRoles(slug, group.item_type, statusId, roleIds).catch(failed);
          }}
          onMode={(statusId, mode) => {
            update(group.item_type, statusId, { return_mode: mode });
            setColumnReturn(slug, group.item_type, statusId, mode).catch(failed);
          }}
          onPairs={(pairs) => {
            patchGroup(group.item_type, (current) => ({ ...current, return_pairs: pairs }));
            setReturnPairs(slug, group.item_type, pairs).catch(failed);
          }}
          onRules={(settings) => {
            patchGroup(group.item_type, (current) => ({ ...current, returns: settings }));
            setReturnSettings(slug, group.item_type, settings).catch(failed);
          }}
        />
      )}
    </>
  );
}

function TypeSection({
  group,
  roles,
  onType,
  onRoles,
  onMode,
  onPairs,
  onRules,
}: {
  group: ItemTypeColumns;
  roles: RoleRef[];
  onType: (statusId: number, type: ColumnType | null) => void;
  onRoles: (statusId: number, roleIds: number[]) => void;
  onMode: (statusId: number, mode: ColumnMode) => void;
  onPairs: (pairs: ReturnPair[]) => void;
  onRules: (settings: ReturnSettings) => void;
}) {
  const live = group.columns.filter((column) => !column.is_deleted);
  const removed = group.columns.length - live.length;
  const configured = live.filter((column) => column.type !== null).length;
  const problems = [
    !group.columns.some((column) => column.type === "work") &&
      "Mark at least one status as Work: cycle time starts there.",
    !group.columns.some((column) => column.type === "done") &&
      "Mark at least one status as Done: lead and cycle time end there.",
  ].filter((problem): problem is string => Boolean(problem));
  const [withRemoved, setWithRemoved] = useState(false);
  const shown = withRemoved ? group.columns : live;
  return (
    <section className="card section">
      <header className="card-header card-header-row">
        <div>
          <h2>{ITEM_TYPE_TITLES[group.item_type]}</h2>
          <p>
            {configured} of {live.length} statuses set
            {group.return_pairs.length > 0 &&
              `, ${group.return_pairs.length} saved ${
                group.return_pairs.length === 1 ? "transition rule" : "transition rules"
              }`}
          </p>
        </div>
        <span
          className={`badge ${problems.length > 0 ? "badge-accent" : ""}`}
          title={problems.join(" ")}
        >
          {problems.length > 0 ? "Not complete" : "Complete"}
        </span>
      </header>
      {removed > 0 && (
        <p className="removed-note muted">
          {removed} {removed === 1 ? "status was" : "statuses were"} removed from Taiga. Their
          settings still matter: reports of the time they were in use show them, as the board was
          then.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => setWithRemoved(!withRemoved)}
          >
            {withRemoved ? "Hide them" : "Show them"}
          </button>
        </p>
      )}
      {problems.length > 0 && (
        <ul className="setup-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="metric-body">
        <StatusSettings
          shown={shown}
          roles={roles}
          onType={onType}
          onRoles={onRoles}
          onMode={onMode}
        />
        <RulesBlock settings={group.returns} onChange={onRules} />
        <ReturnExceptions group={group} />
        <details className="settings-advanced">
          <summary>Advanced transition matrix</summary>
          <p className="muted">
            Rows are the status a card leaves; columns are where it goes. Click a square to
            override the general rule for that transition.
          </p>
          <ReturnsGrid group={group} shown={shown} onPairs={onPairs} />
          <Legend />
        </details>
      </div>
    </section>
  );
}
