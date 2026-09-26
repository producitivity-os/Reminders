export type ReminderDraftSelection =
  | { type: "view"; id: string }
  | { type: "project"; id: string };

export function defaultReminderDueAt(
  selection: ReminderDraftSelection,
  now = Date.now(),
): number | null {
  if (
    selection.type !== "view" ||
    (selection.id !== "today" && selection.id !== "scheduled")
  )
    return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

