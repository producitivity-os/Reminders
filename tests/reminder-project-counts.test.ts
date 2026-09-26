import assert from "node:assert/strict";
import test from "node:test";
import { countRemindersByProject } from "../src/reminder-project-counts.ts";

test("project badges count only reminders assigned to each project", () => {
  assert.deepEqual(countRemindersByProject([
    { projectId: "alpha" },
    { projectId: "alpha" },
    { projectId: "beta" },
    { projectId: null },
  ]), { alpha: 2, beta: 1 });
});
