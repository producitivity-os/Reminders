import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("Reminders owns its desktop identity and shared application chrome", () => {
  const config = JSON.parse(read("../src-tauri/tauri.conf.json")) as {
    identifier: string;
    build: { devUrl: string };
  };
  const main = read("../src/main.tsx");
  const app = read("../src/App.tsx");
  assert.equal(config.identifier, "com.productivity-os.reminders");
  assert.equal(config.build.devUrl, "http://localhost:1460");
  assert.equal(
    existsSync(new URL("../assets/icons/reminders.svg", import.meta.url)),
    true,
  );
  assert.equal(
    existsSync(new URL("../src-tauri/icons/icon.icns", import.meta.url)),
    true,
  );
  assert.doesNotMatch(
    read("../src-tauri/tauri.conf.json"),
    /workflows\/src-tauri\/icons/,
  );
  assert.match(main, /SharedUiProvider/);
  assert.match(main, /defaultTheme="dark"/);
  assert.match(app, /<AppHeader>/);
  assert.match(app, /className="reminders-show-sidebar"/);
  assert.doesNotMatch(
    app,
    /<main[^>]*>[\s\S]*!sidebarOpen && <button className="reminders-show-sidebar"/,
  );
  assert.match(app, /Recently Deleted/);
  assert.match(app, /className="reminders-header-search"/);
  assert.match(
    app,
    /<main className="reminders-main">[\s\S]*<h1>\{title\}<\/h1>[\s\S]*className="reminders-header-search"/,
  );
  assert.doesNotMatch(
    app,
    /<AppHeader>[\s\S]*className="reminders-header-search"[\s\S]*<\/AppHeader>/,
  );
  assert.match(app, /aria-keyshortcuts="Meta\+N Control\+N"/);
  assert.match(app, /!event\.metaKey && !event\.ctrlKey/);
  assert.doesNotMatch(app, /<List\s*\/>/);
  assert.match(app, /inert=\{!sidebarOpen\}/);
  assert.match(read("../src/App.css"), /\.reminders-sidebar[^}]*transition:/);
  assert.match(
    read("../src/App.css"),
    /\.reminders-header-search[^}]*border: 1px solid/,
  );
  assert.match(
    read("../src/App.css"),
    /\.reminders-main > header[^}]*flex-direction: column/,
  );
  assert.doesNotMatch(app, /className="reminders-add"/);
  assert.match(app, /setBadgeCount\(count > 0 \? count : undefined\)/);
  assert.match(app, /remindersApi\.reminders\(allActiveRemindersQuery\)/);
  assert.match(app, /countRemindersDueByToday\(items\)/);
  assert.match(
    app,
    /useState<Selection>\(\{\s*type: "view",\s*id: "all",?\s*\}\)/,
  );
  const capability = JSON.parse(
    read("../src-tauri/capabilities/default.json"),
  ) as { permissions: string[] };
  assert.ok(
    capability.permissions.includes("core:window:allow-set-badge-count"),
  );
  const window = JSON.parse(read("../src-tauri/tauri.conf.json")) as {
    app: { windows: Array<{ width: number; minWidth: number }> };
  };
  assert.equal(window.app.windows[0].width, 600);
  assert.equal(window.app.windows[0].minWidth, 420);
});

test("Reminders replaces custom lists with project workflows and preserves reminder lifecycle", () => {
  const app = read("../src/App.tsx");
  const api = read("../src/api.ts");
  const native = read("../src-tauri/src/lib.rs");
  for (const operation of [
    "projects",
    "createProject",
    "create",
    "update",
    "reorder",
    "complete",
    "remove",
    "restore",
    "permanentlyDelete",
  ])
    assert.match(api, new RegExp(`async ${operation}\\(`));
  assert.doesNotMatch(api, /async saveList\(|async deleteList\(/);
  assert.match(app, /ReminderDraft/);
  assert.match(app, /isComposing/);
  assert.match(native, /create_reminder/);
  assert.match(native, /update_reminder/);
  assert.match(native, /list_reminder_projects/);
  assert.match(native, /create_reminder_project/);
  assert.match(native, /workflow_kind: WorkflowDocumentKind::Project/);
  assert.match(native, /project: "Drafts"\.into\(\)/);
  assert.match(native, /objects: vec!\[\]/);
  assert.match(app, /<span>Projects<\/span>/);
  assert.match(app, /aria-label="Create project"/);
  assert.match(app, /aria-label="Project name"/);
  assert.match(app, /remindersApi\s*\.createProject/);
  assert.match(
    app,
    /const title = event\.currentTarget\.value;[\s\S]*setProjectDraft/,
  );
  assert.match(app, /setSelection\(\{ type: "project", id: saved\.id \}\)/);
  assert.match(app, /projectSavingRef/);
  assert.match(app, /aria-label="Projects"/);
  assert.match(app, /className="reminders-project-count"/);
  assert.match(app, /countRemindersByProject\(items\)/);
  assert.match(
    read("../src/App.css"),
    /\.reminders-project-count[^}]*border-radius: 999px/,
  );
  assert.doesNotMatch(app, /My Lists|Add list|Rename list|Delete list/);
  assert.match(
    app,
    /projectId: selection\.type === "project" \? selection\.id : null/,
  );
  assert.match(app, /draggable=\{dragEnabled && !completionPending\}/);
  assert.match(native, /reorder_reminders/);
  assert.match(native, /permanently_delete_reminder/);
  const migration = read(
    "../../../crates/database/migrations/202609140001_replace_reminder_lists_with_projects.sql",
  );
  assert.match(migration, /SET list_id = 'reminders-inbox'/);
  assert.match(migration, /DELETE FROM reminder_lists/);
});

test("Reminders supports subtle notes, date/time chips, project assignment, and smart views", () => {
  const app = read("../src/App.tsx");
  const api = read("../src/api.ts");
  const styles = read("../src/App.css");
  assert.match(app, /type="date"/);
  assert.match(app, /TimePickerInput/);
  assert.match(app, /Add Date/);
  assert.match(app, /Add Time/);
  assert.match(app, /Add Priority/);
  assert.match(app, /Add Project/);
  assert.match(app, /hideProjectBadge=\{selection\.type === "project"\}/);
  assert.match(app, /!hideProjectBadge\s*&&\s*\(\s*<DropdownMenu>/);
  assert.match(app, /aria-label="Notes"/);
  assert.match(app, /className="reminder-reveal reminder-details-reveal"/);
  assert.match(app, /data-open=\{detailsOpen \|\| undefined\}/);
  assert.match(app, /aria-hidden=\{!detailsOpen\}\s+inert=\{!detailsOpen\}/);
  assert.match(app, /className="reminder-reveal reminder-summary-reveal"/);
  assert.match(styles, /\.reminder-notes-input[^}]*border: 0/);
  assert.match(
    styles,
    /\.reminder-row[^}]*border-bottom: 1px solid var\(--border\)/,
  );
  assert.match(styles, /\.reminder-row[^}]*border-radius: 0/);
  assert.match(
    styles,
    /\.reminder-row\[data-selected\]::after[^}]*border-right: 2px solid #3b82f6[^}]*border-left: 2px solid #3b82f6/,
  );
  assert.match(
    styles,
    /\.reminder-row\[data-selection-start\]::after[^}]*border-top: 2px solid #3b82f6/,
  );
  assert.match(
    styles,
    /\.reminder-row\[data-selection-end\]::after[^}]*border-bottom: 2px solid #3b82f6/,
  );
  assert.doesNotMatch(
    styles,
    /\.reminder-row\[data-selected\][^}]*inset 0 0 0 2px #3b82f6/,
  );
  assert.match(styles, /\.reminder-reveal[^}]*grid-template-rows: 0fr/);
  assert.match(
    styles,
    /\.reminder-reveal\[data-open\][^}]*grid-template-rows: 1fr/,
  );
  assert.match(styles, /grid-template-rows 180ms ease/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.reminder-reveal[^}]*transition: none/,
  );
  assert.doesNotMatch(styles, /\.reminder-row:hover/);
  assert.match(app, /dueAt: defaultReminderDueAt\(selection\)/);
  assert.doesNotMatch(app, /dueInCurrentView/);
  assert.match(app, /const title = event\.currentTarget\.value/);
  assert.match(app, /const notes = event\.currentTarget\.value/);
  assert.match(api, /projectId: string \| null/);
  assert.match(
    api,
    /type ReminderView =\s*"today"\s*\|\s*"scheduled"\s*\|\s*"all"\s*\|\s*"completed"\s*\|\s*"deleted"/,
  );
  for (const view of ["today", "scheduled", "completed", "deleted"])
    assert.match(api, new RegExp(`query\\.view === "${view}"`));
});

test("Reminders animates successful completion and rolls back failed completion", () => {
  const app = read("../src/App.tsx");
  const styles = read("../src/App.css");
  assert.match(app, /const completionHoldMs = 600/);
  assert.match(app, /const completionExitMs = 180/);
  assert.match(app, /completedAt: startedAt/);
  assert.match(app, /pendingCompletions\.current\.set/);
  assert.match(app, /pendingById\.get\(reminder\.id\) \?\? reminder/);
  assert.match(app, /data-completion-phase=\{completionPhase\}/);
  assert.match(app, /disabled=\{deletedView \|\| completionPending\}/);
  assert.match(
    app,
    /data-exiting=\{completionPhase === "exiting" \|\| undefined\}/,
  );
  assert.match(app, /await waitForCompletion\(remainingHold\)/);
  assert.match(app, /await waitForCompletion\(completionExitMs\)/);
  assert.match(
    app,
    /current\.map\(\(candidate\)\s*=>\s*candidate\.id === original\.id \? original : candidate,?\s*\)/,
  );
  assert.match(
    styles,
    /\.reminder-row-shell\[data-exiting\][^}]*grid-template-rows: 0fr/,
  );
  assert.match(
    styles,
    /\.reminder-row\[data-completion-phase="holding"\] \.reminder-checkbox svg[^}]*reminder-check-in/,
  );
  assert.match(styles, /@keyframes reminder-checkbox-complete/);
  assert.match(styles, /@keyframes reminder-check-in/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.reminder-row-shell[^}]*animation: none/,
  );
});

test("Reminders supports visible-range multi-selection", () => {
  const app = read("../src/App.tsx");
  const sharedStyles = read(
    "../../../packages/shared-ui/src/styles/styles.css",
  );
  assert.match(app, /event\.shiftKey/);
  assert.match(app, /extendReminderSelection/);
  assert.match(app, /allReminderSelection/);
  assert.match(app, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(
    app,
    /reminderSelectionEdges\(\s*visibleReminderIds,\s*selectedIds,\s*reminder\.id,?\s*\)/,
  );
  assert.match(app, /data-selection-start=\{selectionStart \|\| undefined\}/);
  assert.match(app, /data-selection-end=\{selectionEnd \|\| undefined\}/);
  assert.match(
    app,
    /onSelect\(event\.shiftKey, event\.metaKey \|\| event\.ctrlKey\)/,
  );
  assert.match(
    app,
    /aria-keyshortcuts="Meta\+A Control\+A Shift\+ArrowUp Shift\+ArrowDown"/,
  );
  assert.match(app, /focused=\{selectedId === reminder\.id\}/);
  assert.match(
    app,
    /target\.closest\(\s*"\.reminder-row, button, input, textarea, \[contenteditable='true'\]",?\s*\)/,
  );
  assert.match(app, /clearReminderSelection\(\);/);
  assert.match(
    sharedStyles,
    /\[role="menuitemradio"\][^{]*\{[^}]*user-select: none/,
  );
});

test("Creating reminders keeps selection clear and focuses the next draft", () => {
  const app = read("../src/App.tsx");
  assert.match(app, /const focusDraftInput = React\.useCallback/);
  assert.match(
    app,
    /input\.setSelectionRange\(input\.value\.length, input\.value\.length\)/,
  );
  assert.match(
    app,
    /if \(createNext\)\s+addDraft\(\s*remainsVisible \? saved\.id/,
  );
  assert.doesNotMatch(
    app,
    /setSelectedId\(remainsVisible \? saved\.id : null\)/,
  );
  assert.match(app, /id: draft\.key/);
  assert.match(app, /pendingDrafts\.current\.delete\(key\)/);
  assert.match(app, /event\.key === "Tab"/);
  assert.match(app, /notesRef\.current\?\.focus/);
});

test("Reminder images use managed ownership, system clipboard data, and browser persistence", () => {
  const app = read("../src/App.tsx");
  const images = read("../src/reminder-images.ts");
  const backend = read("../src-tauri/src/lib.rs");
  const migration = read(
    "../../../crates/database/migrations/202609150002_add_reminder_media.sql",
  );
  assert.match(app, /onPaste=\{handleImagePaste\}/);
  assert.match(app, /className="reminder-image"/);
  assert.match(app, /copyReminderImage\(selectedImageId\)/);
  assert.match(app, /event\.key !== "Delete" && event\.key !== "Backspace"/);
  assert.match(images, /indexedDB\.open/);
  assert.match(images, /new ClipboardItem/);
  assert.match(images, /writeImage\(image\)/);
  assert.match(backend, /register_asynchronous_uri_scheme_protocol\("media"/);
  assert.match(
    migration,
    /reminder_id TEXT REFERENCES reminders\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    migration,
    /CHECK \(\(canvas_id IS NOT NULL\) <> \(reminder_id IS NOT NULL\)\)/,
  );
});
