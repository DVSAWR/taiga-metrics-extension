import { useEffect, useState } from "react";

import type { ActivityEvent, ItemType, PersonPage as PersonData, ProjectSummary } from "../api";
import { CardLink } from "../components/CardLink";
import { CardRef } from "../components/CardRef";
import { StatusName } from "../components/StatusName";
import { TextLink } from "../components/TextLink";
import { UserPhoto } from "../components/UserPhoto";
import { formatNumber } from "../format";
import { Icon, type IconName } from "../icons";
import { TYPE_LABELS } from "../modules";
import { canOpenCard } from "../projectAccess";
import { rolePath } from "../router";

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

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useLoaded<T>(load: () => Promise<T>, keys: unknown[]): [T | null, string | null] {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setValue(null);
    load()
      .then((next) => {
        if (!cancelled) {
          setValue(next);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorText(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, keys);
  return [value, error];
}

export function Header({
  person,
  taigaUrl,
  isMe,
  slug,
  canOpenRole,
}: {
  person: PersonData;
  taigaUrl: string | null;
  isMe: boolean;
  slug: string;
  canOpenRole: boolean;
}) {
  const { profile } = person;
  return (
    <header className="person-header">
      <span className="person-photo">
        <UserPhoto userId={profile.id} />
      </span>
      <div className="person-info">
        <h1 className="person-name">
          {profile.name}
          {isMe && <span className="badge badge-muted">You</span>}
        </h1>
        <div className="person-meta">
          {profile.role && canOpenRole ? (
            <TextLink to={rolePath(slug, profile.role_id)}>{profile.role}</TextLink>
          ) : (
            <span>{profile.role ?? "No role"}</span>
          )}
          {profile.is_owner && <span className="badge badge-muted">Project owner</span>}
          {profile.is_admin && !profile.is_owner && (
            <span className="badge badge-muted">Admin</span>
          )}
          {!profile.is_member && <span className="badge badge-accent">Not in the project</span>}
          {!profile.is_active && <span className="badge badge-accent">Inactive in Taiga</span>}
          {taigaUrl && (
            <TextLink
              href={`${taigaUrl}/profile/${encodeURIComponent(profile.username)}`}
              title="Open the Taiga profile"
            >
              @{profile.username} in Taiga
            </TextLink>
          )}
        </div>
      </div>
    </header>
  );
}

export function Achievements({ person }: { person: PersonData }) {
  const metrics = person.metrics.filter(
    (metric) => metric.module === null || person.modules.includes(metric.module),
  );
  const total = person.metrics.reduce(
    (sum, metric) => sum + (person.values[metric.key] ?? 0) * metric.weight,
    0,
  );
  return (
    <div className="person-achievements">
      {metrics.map((metric) => {
        const count = person.values[metric.key] ?? 0;
        const highest = person.highest[metric.key] ?? 0;
        const opacity =
          count === 0 ? 0.1 : count >= highest ? 1 : Math.max(0.1, (0.5 * count) / highest);
        return (
          <div
            key={metric.key}
            className="person-achievement"
            title={`${metric.explanation}. Highest in the team: ${highest}`}
          >
            <Icon name={METRIC_ICONS[metric.icon] ?? "task"} style={{ opacity }} />
            <span className="person-achievement-count">
              {metric.weight < 0 && count > 0 ? "-" : ""}
              {formatNumber(count)}
            </span>
            <span className="person-achievement-title">{metric.title}</span>
            <span className="person-achievement-hint">{metric.explanation}</span>
          </div>
        );
      })}
      <div
        className="person-achievement person-achievement-total"
        title="Every count times its weight"
      >
        <span className="person-achievement-count">{formatNumber(total)}</span>
        <span className="person-achievement-title">Total Power</span>
      </div>
    </div>
  );
}

function CardCell({
  project,
  itemType,
  itemId,
  cardRef,
  subject,
  isDeleted,
  taigaUrl,
}: {
  project: ProjectSummary;
  itemType: ItemType;
  itemId: number;
  cardRef: number | null;
  subject: string;
  isDeleted: boolean;
  taigaUrl: string | null;
}) {
  return (
    <span className={isDeleted ? "is-deleted" : undefined}>
      <CardRef
        itemType={itemType}
        itemId={itemId}
        cardRef={cardRef}
        isDeleted={isDeleted}
        slug={project.slug}
        taigaUrl={taigaUrl}
      />{" "}
      {canOpenCard(project, itemType) ? (
        <CardLink slug={project.slug} itemType={itemType} itemId={itemId} subject={subject} />
      ) : (
        subject
      )}
    </span>
  );
}

export function EventTarget({
  event,
  project,
  taigaUrl,
}: {
  event: ActivityEvent;
  project: ProjectSummary;
  taigaUrl: string | null;
}) {
  if (event.item_type === null || event.item_id === null) {
    return <span className="muted-inline">{event.other ?? "Project"}</span>;
  }
  return (
    <CardCell
      project={project}
      itemType={event.item_type}
      itemId={event.item_id}
      cardRef={event.ref}
      subject={event.subject ?? `${TYPE_LABELS[event.item_type]} ${event.item_id}`}
      isDeleted={event.is_deleted || event.kind === "delete"}
      taigaUrl={taigaUrl}
    />
  );
}

export function EventDetail({ event, slug }: { event: ActivityEvent; slug: string }) {
  if (event.kind === "move" && event.item_type) {
    return (
      <span className="move-line">
        <StatusName
          slug={slug}
          itemType={event.item_type}
          id={event.from_status_id}
          name={
            event.from_status ?? (event.from_status_id ? `Status ${event.from_status_id}` : null)
          }
          color={event.from_color}
        />
        <span className="move-arrow">→</span>
        <StatusName
          slug={slug}
          itemType={event.item_type}
          id={event.to_status_id}
          name={event.to_status ?? (event.to_status_id ? `Status ${event.to_status_id}` : null)}
          color={event.to_color}
        />
      </span>
    );
  }
  if (event.kind === "create" && event.item_type && event.to_status) {
    return (
      <>
        in{" "}
        <StatusName
          slug={slug}
          itemType={event.item_type}
          id={event.to_status_id}
          name={event.to_status}
          color={event.to_color}
        />
      </>
    );
  }
  if (event.kind === "edit") {
    return <span className="muted-inline">{event.fields.join(", ").replaceAll("_", " ")}</span>;
  }
  if (event.kind === "comment" && event.comment) {
    return <span className="activity-comment">{event.comment}</span>;
  }
  return null;
}
