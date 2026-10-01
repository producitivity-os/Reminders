import assert from "node:assert/strict";
import test from "node:test";
import {
  isDueWithinWindow,
  isReminderOverdue,
} from "../src/reminder-due-state.ts";

test("Today includes overdue reminders and reminders due today", () => {
  const tomorrow = new Date(2026, 8, 23, 0, 0, 0, 0).getTime();
  const yesterday = new Date(2026, 8, 21, 9, 0, 0, 0).getTime();
  const today = new Date(2026, 8, 22, 18, 0, 0, 0).getTime();
  const future = new Date(2026, 8, 23, 9, 0, 0, 0).getTime();

  assert.equal(isDueWithinWindow(yesterday, null, tomorrow), true);
  assert.equal(isDueWithinWindow(today, null, tomorrow), true);
  assert.equal(isDueWithinWindow(future, null, tomorrow), false);
});

test("only genuinely overdue reminder dates are red", () => {
  const now = new Date(2026, 8, 22, 14, 0, 0, 0).getTime();
  const yesterday = new Date(2026, 8, 21, 0, 0, 0, 0).getTime();
  const todayWithoutTime = new Date(2026, 8, 22, 0, 0, 0, 0).getTime();
  const earlierToday = new Date(2026, 8, 22, 9, 0, 0, 0).getTime();
  const laterToday = new Date(2026, 8, 22, 18, 0, 0, 0).getTime();

  assert.equal(
    isReminderOverdue({ dueAt: yesterday, dueHasTime: false }, now),
    true,
  );
  assert.equal(
    isReminderOverdue({ dueAt: todayWithoutTime, dueHasTime: false }, now),
    false,
  );
  assert.equal(
    isReminderOverdue({ dueAt: earlierToday, dueHasTime: true }, now),
    true,
  );
  assert.equal(
    isReminderOverdue({ dueAt: laterToday, dueHasTime: true }, now),
    false,
  );
});
