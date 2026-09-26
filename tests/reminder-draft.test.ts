import assert from "node:assert/strict";
import test from "node:test";
import { defaultReminderDueAt } from "../src/reminder-draft.ts";

test("Today and Scheduled drafts default to the current local date", () => {
  const now = new Date(2026, 8, 22, 14, 37, 45, 123).getTime();
  const expected = new Date(2026, 8, 22, 0, 0, 0, 0).getTime();

  assert.equal(
    defaultReminderDueAt({ type: "view", id: "today" }, now),
    expected,
  );
  assert.equal(
    defaultReminderDueAt({ type: "view", id: "scheduled" }, now),
    expected,
  );
});

test("Other reminder destinations keep drafts unscheduled", () => {
  const now = new Date(2026, 8, 22, 14, 37).getTime();

  assert.equal(defaultReminderDueAt({ type: "view", id: "all" }, now), null);
  assert.equal(
    defaultReminderDueAt({ type: "project", id: "project-1" }, now),
    null,
  );
});

