type ReminderDueFields = {
  dueAt: number | null;
  dueHasTime: boolean;
};

function isSameLocalDay(left: number, right: number): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

export function isReminderOverdue(
  reminder: ReminderDueFields,
  now = Date.now(),
): boolean {
  if (reminder.dueAt === null || reminder.dueAt >= now) return false;
  if (!reminder.dueHasTime && isSameLocalDay(reminder.dueAt, now)) return false;
  return true;
}

export function isDueWithinWindow(
  dueAt: number | null,
  dayStart: number | null,
  dayEnd: number | null,
): boolean {
  return (
    dueAt !== null &&
    (dayStart === null || dueAt >= dayStart) &&
    (dayEnd === null || dueAt < dayEnd)
  );
}
