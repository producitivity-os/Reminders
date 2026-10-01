import assert from "node:assert/strict";
import test from "node:test";
import type { Reminder } from "../src/api.ts";
import {
  countRemindersDueByToday,
  countScheduledReminders,
} from "../src/reminder-badge-count.ts";

function reminder(
  id: string,
  dueAt: number | null,
  patch: Partial<Reminder> = {},
): Reminder {
  return {
    id,
    listId: "reminders-inbox",
    title: id,
    notes: "",
    dueAt,
    dueHasTime: dueAt !== null,
    priority: "none",
    projectId: null,
    subtasks: [],
    completedAt: null,
    deletedAt: null,
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

test("the application badge counts only overdue and today reminders", () => {
  const now = new Date(2026, 8, 22, 14, 30).getTime();
  const reminders = [
    reminder("overdue", new Date(2026, 8, 21, 23, 59).getTime()),
    reminder("today-date", new Date(2026, 8, 22, 0, 0).getTime()),
    reminder("today-time", new Date(2026, 8, 22, 23, 59).getTime()),
    reminder("tomorrow", new Date(2026, 8, 23, 0, 0).getTime()),
    reminder("future", new Date(2026, 9, 1, 9, 0).getTime()),
    reminder("unscheduled", null),
    reminder("completed", new Date(2026, 8, 22, 9, 0).getTime(), {
      completedAt: now,
    }),
    reminder("deleted", new Date(2026, 8, 22, 9, 0).getTime(), {
      deletedAt: now,
    }),
  ];

  assert.equal(countRemindersDueByToday(reminders, now), 3);
});

test("the badge uses local calendar boundaries", () => {
  const now = new Date(2026, 8, 22, 23, 59, 59).getTime();
  assert.equal(
    countRemindersDueByToday(
      [
        reminder("last-minute", new Date(2026, 8, 22, 23, 59, 59).getTime()),
        reminder("next-day", new Date(2026, 8, 23, 0, 0, 0).getTime()),
      ],
      now,
    ),
    1,
  );
});

test("the scheduled badge counts every active reminder with a date", () => {
  const now = new Date(2026, 8, 22, 12).getTime();
  assert.equal(
    countScheduledReminders([
      reminder("overdue", new Date(2026, 8, 20).getTime()),
      reminder("today", now),
      reminder("future", new Date(2026, 9, 1).getTime()),
      reminder("unscheduled", null),
      reminder("completed", now, { completedAt: now }),
      reminder("deleted", now, { deletedAt: now }),
    ]),
    3,
  );
});
