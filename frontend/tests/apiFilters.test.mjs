import assert from "node:assert/strict";
import test from "node:test";

import * as api from "../src/api.ts";

const selection = {
  include: ["tag:ux", "tag:frontend", "swimlane:7", "created_by:5"],
  exclude: ["tag:blocked", "status:userstory.9"],
};
const period = { from: "2026-10-01", to: "2026-10-28", days: "working" };

const requests = [
  ["overview and status pages", () => api.fetchFlow("alpha", "userstory", selection, period, 2)],
  [
    "comparison with the rest",
    () => api.fetchFlow("alpha", "userstory", selection, period, null, true),
  ],
  [
    "analysis",
    () => api.fetchAnalysis("alpha", { kind: "role", id: 40 }, "userstory", selection, period),
  ],
  ["people list", () => api.fetchPeopleSummary("alpha", "userstory", period, selection)],
  ["roles list", () => api.fetchDirectionSummary("alpha", "userstory", period, selection)],
  ["role", () => api.fetchDirection("alpha", 40, "userstory", period, selection)],
  ["personal flow", () => api.fetchPersonFlow("alpha", 6, "userstory", period, selection)],
  [
    "personal status share",
    () => api.fetchPersonShare("alpha", 6, "userstory", period, selection),
  ],
  ["personal achievements", () => api.fetchPerson("alpha", 6, period, selection, "userstory")],
  ["personal activity", () => api.fetchPersonActivity("alpha", 6, period, selection, "userstory")],
  [
    "activity heatmap",
    () => api.fetchTeamActivity("alpha", period, 40, 6, selection, "userstory"),
  ],
  [
    "activity events",
    () => api.fetchTeamEvents("alpha", period, 40, 6, "move", selection, "userstory"),
  ],
  ["history pagination", () => api.fetchTransitions("alpha", "userstory", selection, period, 100)],
  [
    "trends",
    () =>
      api.fetchPeriodStatusTimes("alpha", "userstory", selection, {
        ...period,
        by: "week",
        pass: 5,
      }),
  ],
  [
    "trend stays",
    () =>
      api.fetchPeriodStays(
        "alpha",
        "userstory",
        selection,
        { ...period, by: "week", pass: 5 },
        "week-1",
        2,
      ),
  ],
  [
    "trend finishes",
    () =>
      api.fetchPeriodFinished(
        "alpha",
        "userstory",
        selection,
        { ...period, by: "week", pass: 5 },
        "week-1",
      ),
  ],
];

for (const [name, request] of requests) {
  test(`${name} sends all shared filters`, async () => {
    const original = globalThis.fetch;
    let requested;
    globalThis.fetch = async (url) => {
      requested = new URL(url, "http://localhost");
      return Response.json({});
    };
    try {
      await request();
      const params = requested.searchParams;
      assert.deepEqual(params.getAll("include"), selection.include);
      assert.deepEqual(params.getAll("exclude"), selection.exclude);
      assert.equal(params.get("item_type"), "userstory");
      assert.equal(params.get("from"), period.from);
      assert.equal(params.get("to"), period.to);
    } finally {
      globalThis.fetch = original;
    }
  });
}

test("search and facet counts retain the same include and exclude values", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const params = new URL(url, "http://localhost").searchParams;
    assert.deepEqual(params.getAll("include"), selection.include);
    assert.deepEqual(params.getAll("exclude"), selection.exclude);
    return Response.json([]);
  };
  try {
    await api.searchCards("alpha", "login", "userstory", selection, 50);
    await api.fetchFilterPanel("alpha", "userstory", selection);
  } finally {
    globalThis.fetch = original;
  }
});
