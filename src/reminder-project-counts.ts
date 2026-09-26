export function countRemindersByProject(
  reminders: readonly { projectId: string | null }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reminder of reminders) {
    if (!reminder.projectId) continue;
    counts[reminder.projectId] = (counts[reminder.projectId] ?? 0) + 1;
  }
  return counts;
}
