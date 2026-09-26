import type { Reminder } from "./api";

export function countRemindersDueByToday(
  reminders: readonly Reminder[],
  now = Date.now(),
): number {
  const tomorrow = new Date(now);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStart = tomorrow.getTime();

  return reminders.filter(
    (reminder) =>
      reminder.completedAt === null &&
      reminder.deletedAt === null &&
      reminder.dueAt !== null &&
      Number.isFinite(reminder.dueAt) &&
      reminder.dueAt < tomorrowStart,
  ).length;
}
