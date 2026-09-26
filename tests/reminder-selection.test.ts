import assert from "node:assert/strict";
import test from "node:test";
import {
  allReminderSelection,
  extendReminderSelection,
  reminderRangeSelection,
  reminderSelectionEdges,
} from "../src/reminder-selection.ts";

const ids = ["one", "two", "three", "four"];

test("shift selection spans the visible range in either direction", () => {
  assert.deepEqual(
    [...reminderRangeSelection(ids, "two", "four").selectedIds],
    ["two", "three", "four"],
  );
  assert.deepEqual(
    [...reminderRangeSelection(ids, "three", "one").selectedIds],
    ["one", "two", "three"],
  );
});

test("shift arrows grow and shrink selection around a stable anchor", () => {
  const down = extendReminderSelection(ids, "two", "two", 1);
  assert.deepEqual(down && [...down.selectedIds], ["two", "three"]);
  const fartherDown = extendReminderSelection(ids, down?.anchorId ?? null, down?.focusId ?? null, 1);
  assert.deepEqual(fartherDown && [...fartherDown.selectedIds], ["two", "three", "four"]);
  const backUp = extendReminderSelection(ids, fartherDown?.anchorId ?? null, fartherDown?.focusId ?? null, -1);
  assert.deepEqual(backUp && [...backUp.selectedIds], ["two", "three"]);
});

test("shift arrows start at the nearest visible edge without a selection", () => {
  assert.equal(extendReminderSelection(ids, null, null, 1)?.focusId, "one");
  assert.equal(extendReminderSelection(ids, null, null, -1)?.focusId, "four");
});

test("select all includes only the provided visible reminders", () => {
  const selection = allReminderSelection(["one", "three"]);
  assert.deepEqual(selection && [...selection.selectedIds], ["one", "three"]);
  assert.equal(selection?.anchorId, "one");
  assert.equal(selection?.focusId, "three");
  assert.equal(allReminderSelection([]), null);
});

test("selection edges form one outline per consecutive block", () => {
  const selectedIds = new Set(["one", "two", "four"]);

  assert.deepEqual(reminderSelectionEdges(ids, selectedIds, "one"), {
    selected: true,
    start: true,
    end: false,
  });
  assert.deepEqual(reminderSelectionEdges(ids, selectedIds, "two"), {
    selected: true,
    start: false,
    end: true,
  });
  assert.deepEqual(reminderSelectionEdges(ids, selectedIds, "three"), {
    selected: false,
    start: false,
    end: false,
  });
  assert.deepEqual(reminderSelectionEdges(ids, selectedIds, "four"), {
    selected: true,
    start: true,
    end: true,
  });
});
