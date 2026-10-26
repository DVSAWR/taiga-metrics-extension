import type {
  BreakdownRow,
  ColumnCard,
  FirstPassEvent,
  FlowReport,
  ReturnEvent,
  StuckCard,
} from "./api";
import type { ListedCard } from "./pages/FlowMetrics";

export type CountKind = "in_progress" | "stuck" | "finished" | "first_time" | "returns";

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
  if (kind === "returns") {
    const rework = new Set(
      report.columns
        .filter((column) => column.name.trim().toUpperCase() === "REWORK")
        .map((column) => column.status_id),
    );
    return {
      title: "Return events",
      timeLabel: "Returned at",
      cards: [],
      returns: report.back_moves.events.filter(
        (event) =>
          inside(statuses, event.credited_status) &&
          (personId === null || event.credited.includes(personId)) &&
          (statuses === null || !rework.has(event.to_status)),
      ),
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
  const base = subjectCards(report, own, kind);
  if (kind === "first_time" || kind === "returns") {
    return {
      ...base,
      title: `${row.name}: ${base.title.toLowerCase()}`,
      firstPasses: base.firstPasses?.filter((event) =>
        row.kind === "person"
          ? event.author === row.id
          : subjectPersonId === null || event.author === subjectPersonId,
      ),
      returns: base.returns?.filter((event) =>
        row.kind === "person"
          ? event.credited.includes(row.id)
          : subjectPersonId === null || event.credited.includes(subjectPersonId),
      ),
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
