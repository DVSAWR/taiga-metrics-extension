import assert from "node:assert/strict";
import test from "node:test";

import { repeatReturns, returnStats, rowCards, subjectCards } from "../src/cardLists.ts";

function event(card, day, status = 2, credited = [6]) {
  return {
    item_id: card,
    ref: card,
    subject: `Card ${card}`,
    happened_at: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`,
    from_status: 4,
    to_status: status,
    credited_status: status,
    credited,
  };
}

function report(events) {
  return { columns: [], first_passes: [], back_moves: { events }, credited_returns: null };
}

test("repeat summaries distinguish events and cards", () => {
  const events = [event(1, 5), event(2, 4), event(1, 3), event(1, 1)];
  assert.deepEqual(returnStats(events), {
    returns: 4,
    returned_cards: 2,
    repeat_returns: 2,
    repeated_cards: 1,
    repeat_rate: 0.5,
  });
  assert.deepEqual(repeatReturns(events), [events[0], events[2]]);
  assert.equal(events[0].happened_at, "2026-10-05T12:00:00Z");
});

test("no returns have no percentage and distinct returns have zero repeats", () => {
  assert.equal(returnStats([]).repeat_rate, null);
  assert.equal(returnStats([event(1, 1), event(2, 2)]).repeat_rate, 0);
  assert.deepEqual(repeatReturns([]), []);
});

test("repeat drilldowns filter the person before selecting repeated events", () => {
  const flow = report([event(1, 2, 2, [6]), event(1, 1, 2, [7])]);
  const row = { kind: "person", id: 6, name: "Person" };
  assert.deepEqual(rowCards(flow, [2], row, "repeat_returns").returns, []);
  assert.equal(subjectCards(flow, null, "repeat_returns", 6).returns.length, 0);
});

test("repeats across statuses are deduplicated for totals and scoped for rows", () => {
  const flow = report([event(1, 3, 3), event(1, 2, 2), event(1, 1, 2)]);
  assert.equal(subjectCards(flow, null, "repeat_returns").returns.length, 2);
  const row = { kind: "status", id: 3, name: "Review" };
  assert.equal(rowCards(flow, null, row, "repeat_returns", 6).returns.length, 0);
});

test("personal drilldowns use credited returns after reassignment", () => {
  const flow = report([]);
  flow.credited_returns = [event(1, 2), event(1, 1)];
  assert.equal(subjectCards(flow, null, "returns", 6).returns.length, 2);
  assert.equal(subjectCards(flow, null, "repeat_returns", 6).returns.length, 1);
});

test("distinct simultaneous return events preserve every event after the first", () => {
  const events = [event(1, 1, 2), event(1, 1, 3)];
  assert.deepEqual(repeatReturns(events), [events[1]]);
});

test("personal status drilldowns retain credited triage events while roles exclude them", () => {
  const flow = report([event(1, 2, 2), event(1, 1, 2)]);
  flow.columns = [{ status_id: 2, name: "REWORK" }];
  const row = { kind: "status", id: 2, name: "REWORK" };
  assert.equal(rowCards(flow, null, row, "repeat_returns", 6).returns.length, 1);
  assert.equal(subjectCards(flow, [2], "returns").returns.length, 0);
});

test("stuck drilldowns retain age reasons and cumulative time after a status reentry", () => {
  const flow = report([]);
  flow.stuck = [
    {
      item_id: 1,
      ref: 1,
      status_id: 2,
      level: "red",
      days_in_column: 1,
      days_in_status: 60,
      age_days: 77,
      assignees: [6],
    },
  ];
  const opened = subjectCards(flow, null, "stuck");
  assert.equal(opened.timeLabel, "Total in status");
  assert.equal(opened.cards[0].days, 60);
  assert.equal(opened.cards[0].aging.age_days, 77);
  assert.equal(
    rowCards(flow, [2], { kind: "person", id: 6, name: "Person" }, "stuck").cards.length,
    1,
  );
  assert.equal(subjectCards(flow, [3], "stuck").cards.length, 0);
});
