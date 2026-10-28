import type {
  BreakdownRow,
  ColumnCard,
  FirstPassEvent,
  FlowReport,
  ReturnEvent,
  ReturnStats,
  StuckCard,
} from "./api";
import type { ListedCard } from "./pages/FlowMetrics";

export type CountKind =
  | "in_progress"
  | "stuck"
  | "finished"
  | "first_time"
  | "returns"
  | "repeat_returns";

export interface OpenedList {
  title: string;
  timeLabel: string;
  cards: ListedCard[];
  firstPasses?: FirstPassEvent[];
  returns?: ReturnEvent[];
}

const DAY = 24 * 60 * 60 * 1000;

function fromStuck(card: StuckCard): ListedCard {
  return {
    item_id: card.item_id,
    ref: card.ref,
    subject: card.subject,
    status_id: card.status_id,
    days: card.days_in_column,
    assignees: card.assignees,
  };
}

function fromColumn(card: ColumnCard): ListedCard {
  return {
    item_id: card.item_id,
    ref: card.ref,
    subject: card.subject,
    status_id: card.status_id,
    days: card.days,
    assignees: card.assignees,
    is_deleted: card.is_deleted,
  };
}

function unique(cards: ListedCard[]): ListedCard[] {
  const seen = new Map<number, ListedCard>();
  for (const card of cards) {
    const known = seen.get(card.item_id);
    seen.set(
      card.item_id,
      known ? { ...known, days: (known.days ?? 0) + (card.days ?? 0) } : card,
    );
  }
  return [...seen.values()];
}

function inside(statuses: number[] | null, status: number | null): boolean {
  return statuses === null || (status !== null && statuses.includes(status));
}

export function repeatReturns(events: ReturnEvent[]): ReturnEvent[] {
  const first = new Map<number, ReturnEvent>();
  for (const event of events) {
    const known = first.get(event.item_id);
    if (!known || event.happened_at < known.happened_at) first.set(event.item_id, event);
  }
  return events.filter((event) => first.get(event.item_id) !== event);
}

export function returnStats(events: ReturnEvent[]): ReturnStats {
  const counts = new Map<number, number>();
  for (const event of events) counts.set(event.item_id, (counts.get(event.item_id) ?? 0) + 1);
  const repeated = [...counts.values()].filter((count) => count > 1).length;
  return {
    returns: events.length,
    returned_cards: counts.size,
    repeat_returns: events.length - counts.size,
    repeated_cards: repeated,
    repeat_rate: counts.size > 0 ? repeated / counts.size : null,
  };
}

/** The cards behind one of the key numbers of a subject. */
export function subjectCards(
  report: FlowReport,
  statuses: number[] | null,
  kind: CountKind,
  personId: number | null = null,
): OpenedList {
  const work = new Set(
    report.columns.filter((column) => column.type === "work").map((column) => column.status_id),
  );
  if (kind === "first_time") {
    return {
      title: "Clean first passes",
      timeLabel: "Passed at",
      cards: [],
      firstPasses: report.first_passes.filter(
        (event) => event.clean && inside(statuses, event.status_id),
      ),
    };
  }
  if (kind === "returns" || kind === "repeat_returns") {
    const rework = new Set(
      report.columns
        .filter((column) => column.name.trim().toUpperCase() === "REWORK")
        .map((column) => column.status_id),
    );
    const events = (report.credited_returns ?? report.back_moves.events).filter(
      (event) =>
        inside(statuses, event.credited_status) &&
        (personId === null || event.credited.includes(personId)) &&
        (statuses === null || personId !== null || !rework.has(event.to_status)),
    );
    return {
      title: kind === "repeat_returns" ? "Repeat return events" : "Return events",
      timeLabel: "Returned at",
      cards: [],
      returns: kind === "repeat_returns" ? repeatReturns(events) : events,
    };
  }
  if (kind === "stuck") {
    return {
      title: "Stuck now",
      timeLabel: "In the status",
      cards: report.stuck
        .filter((card) => card.level && inside(statuses, card.status_id))
        .map(fromStuck),
    };
  }
  if (kind === "in_progress") {
    return {
      title: "In progress now",
      timeLabel: "In the status",
      cards: report.column_cards
        .filter(
          (card) =>
            card.now &&
            (statuses === null ? work.has(card.status_id) : statuses.includes(card.status_id)),
        )
        .map(fromColumn),
    };
  }
  if (statuses !== null) {
    return {
      title: "Passed through in the period",
      timeLabel: "Time in its statuses",
      cards: unique(
        report.column_cards
          .filter((card) => !card.now && statuses.includes(card.status_id))
          .map(fromColumn),
      ),
    };
  }
  const now = new Map(
    report.column_cards.filter((card) => card.now).map((card) => [card.item_id, card.status_id]),
  );
  return {
    title: "Finished in the period",
    timeLabel: "Lead time",
    cards: report.finishes.map((card) => ({
      item_id: card.item_id,
      ref: card.ref,
      subject: card.subject,
      status_id: now.get(card.item_id) ?? null,
      days:
        card.created_at === null
          ? null
          : (Date.parse(card.finished_at) - Date.parse(card.created_at)) / DAY,
      assignees: card.assignees,
      is_deleted: card.is_deleted,
    })),
  };
}

/** The cards behind a number in a breakdown row. */
export function rowCards(
  report: FlowReport,
  statuses: number[] | null,
  row: BreakdownRow,
  kind: CountKind,
  subjectPersonId: number | null = null,
): OpenedList {
  const own = row.kind === "person" ? statuses : row.kind === "status" ? [row.id] : row.statuses;
  const base = subjectCards(
    report,
    own,
    kind === "repeat_returns" ? "returns" : kind,
    row.kind === "status" ? subjectPersonId : null,
  );
  if (kind === "first_time" || kind === "returns" || kind === "repeat_returns") {
    const events = base.returns?.filter((event) =>
      row.kind === "person"
        ? event.credited.includes(row.id)
        : subjectPersonId === null || event.credited.includes(subjectPersonId),
    );
    return {
      ...base,
      title: `${row.name}: ${
        kind === "repeat_returns" ? "repeat return events" : base.title.toLowerCase()
      }`,
      firstPasses: base.firstPasses?.filter((event) =>
        row.kind === "person"
          ? event.author === row.id
          : subjectPersonId === null || event.author === subjectPersonId,
      ),
      returns: kind === "repeat_returns" && events ? repeatReturns(events) : events,
    };
  }
  const cards =
    row.kind !== "person"
      ? base.cards
      : kind === "finished"
        ? unique(
            report.column_cards
              .filter(
                (card) => !card.now && card.user_id === row.id && inside(own, card.status_id),
              )
              .map(fromColumn),
          )
        : base.cards.filter((card) => card.assignees.includes(row.id));
  const title =
    row.kind === "person" && kind === "finished" ? "Stays closed in the period" : base.title;
  return {
    title: `${row.name}: ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
    timeLabel: row.kind === "person" && kind === "finished" ? "Stay" : base.timeLabel,
    cards,
  };
}
