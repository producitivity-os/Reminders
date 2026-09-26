export type ReminderSelection = {
  anchorId: string;
  focusId: string;
  selectedIds: Set<string>;
};

export type ReminderSelectionEdges = {
  selected: boolean;
  start: boolean;
  end: boolean;
};

export function reminderSelectionEdges(
  visibleIds: readonly string[],
  selectedIds: ReadonlySet<string>,
  id: string,
): ReminderSelectionEdges {
  const index = visibleIds.indexOf(id);
  const selected = index >= 0 && selectedIds.has(id);
  return {
    selected,
    start: selected && (index === 0 || !selectedIds.has(visibleIds[index - 1])),
    end: selected && (index === visibleIds.length - 1 || !selectedIds.has(visibleIds[index + 1])),
  };
}

export function reminderRangeSelection(
  visibleIds: readonly string[],
  anchorId: string,
  focusId: string,
): ReminderSelection {
  const anchorIndex = visibleIds.indexOf(anchorId);
  const focusIndex = visibleIds.indexOf(focusId);
  if (focusIndex < 0) {
    return { anchorId, focusId, selectedIds: new Set() };
  }
  const resolvedAnchorIndex = anchorIndex < 0 ? focusIndex : anchorIndex;
  const start = Math.min(resolvedAnchorIndex, focusIndex);
  const end = Math.max(resolvedAnchorIndex, focusIndex);
  return {
    anchorId: visibleIds[resolvedAnchorIndex],
    focusId,
    selectedIds: new Set(visibleIds.slice(start, end + 1)),
  };
}

export function extendReminderSelection(
  visibleIds: readonly string[],
  anchorId: string | null,
  focusId: string | null,
  direction: -1 | 1,
): ReminderSelection | null {
  if (visibleIds.length === 0) return null;
  const currentIndex = focusId ? visibleIds.indexOf(focusId) : -1;
  const startingIndex = currentIndex >= 0
    ? currentIndex
    : direction === 1 ? -1 : visibleIds.length;
  const nextIndex = Math.max(0, Math.min(visibleIds.length - 1, startingIndex + direction));
  const nextFocusId = visibleIds[nextIndex];
  const nextAnchorId = anchorId && visibleIds.includes(anchorId)
    ? anchorId
    : currentIndex >= 0 ? visibleIds[currentIndex] : nextFocusId;
  return reminderRangeSelection(visibleIds, nextAnchorId, nextFocusId);
}

export function allReminderSelection(
  visibleIds: readonly string[],
): ReminderSelection | null {
  if (visibleIds.length === 0) return null;
  return {
    anchorId: visibleIds[0],
    focusId: visibleIds[visibleIds.length - 1],
    selectedIds: new Set(visibleIds),
  };
}
