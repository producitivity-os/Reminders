import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("Reminders owns its desktop identity and shared application chrome", () => {
  const config = JSON.parse(read("../src-tauri/tauri.conf.json")) as {
    identifier: string;
    productName: string;
    build: { devUrl: string };
  };
  const main = read("../src/main.tsx");
  const app = read("../src/App.tsx");
  assert.equal(config.identifier, "com.productivity-os.reminders");
  assert.equal(config.productName, "Reminders");
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
  assert.match(main, /defaultTheme="system"/);
  assert.match(main, /preferencesWindow \? <Preferences \/> : <App \/>/);
  assert.match(main, /configureOverdueNotifications\(\)/);
  assert.match(app, /<ApplicationSidebarLayout/);
  assert.match(app, /<ApplicationSidebar/);
  assert.doesNotMatch(app, /<AppHeader>|reminders-show-sidebar/);
  assert.match(app, /Recently Deleted/);
  assert.match(app, /placeholder="Search reminders"/);
  assert.doesNotMatch(app, /search=\{\{/);
  assert.match(app, /setSearchVisible\(true\)/);
  assert.match(app, /event\.key\.toLocaleLowerCase\(\) !== "f"/);
  assert.match(app, /searchInputRef\.current\?\.focus\(\)/);
  assert.match(app, /setSearchVisible\(false\)/);
  assert.match(
    app,
    /<ApplicationSidebarContent className="reminders-main">[\s\S]*<h1>\{title\}<\/h1>/,
  );
  assert.doesNotMatch(
    app,
    /className="reminders-header-search"/,
  );
  assert.doesNotMatch(app, /className="reminders-header-add"/);
  assert.doesNotMatch(app, /aria-label="Settings"/);
  assert.match(app, /!event\.metaKey && !event\.ctrlKey/);
  assert.match(app, /getCurrentWindow\(\)\.listen\("reminders:new-reminder"/);
  assert.doesNotMatch(app, /<List\s*\/>/);
  assert.doesNotMatch(app, /sidebarOpen/);
  assert.match(read("../src/App.css"), /\.reminders-project-count[^}]*transition:/);
  assert.match(
    read("../src/App.css"),
    /\.reminders-app[^}]*grid-template-columns:/,
  );
  assert.match(
    read("../src/App.css"),
    /\.reminders-main > header[^}]*flex-direction: column/,
  );
  assert.match(
    read("../src/App.css"),
    /\.reminders-page-search[^}]*width: min\(430px, 100%\)/,
  );
  assert.doesNotMatch(app, /className="reminders-add"/);
  assert.match(app, /invoke\("update_today_badge", \{ count \}\)/);
  assert.match(app, /remindersApi\.reminders\(allActiveRemindersQuery\)/);
  assert.match(app, /countRemindersDueByToday\(items\)/);
  assert.match(app, /countScheduledReminders\(items\)/);
  assert.match(app, /className="reminders-smart-grid"/);
  assert.match(app, /className="reminders-today-calendar"/);
  assert.match(read("../src/App.css"), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(read("../src/App.css"), /\.reminders-smart-view \.application-sidebar-badge[^}]*background: #ef4444/);
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
  assert.ok(
    capability.permissions.includes("notification:allow-is-permission-granted"),
  );
  assert.ok(
    capability.permissions.includes("notification:allow-request-permission"),
  );
  const window = JSON.parse(read("../src-tauri/tauri.conf.json")) as {
    app: { windows: Array<{ width: number; minWidth: number }> };
  };
  assert.equal(window.app.windows[0].width, 760);
  assert.equal(window.app.windows[0].minWidth, 560);
});

test("Reminders replaces custom lists with project workflows and preserves reminder lifecycle", () => {
  const app = read("../src/App.tsx");
  const api = read("../src/api.ts");
  const native = read("../src-tauri/src/lib.rs");
  for (const operation of [
    "projects",
    "createProject",
    "updateProject",
    "deleteProject",
    "reorderProjects",
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
  assert.match(native, /update_reminder_project/);
  assert.match(native, /delete_reminder_project/);
  assert.match(native, /reorder_reminder_projects/);
  assert.match(native, /workflow_kind: WorkflowDocumentKind::Project/);
  assert.match(native, /project: "Drafts"\.into\(\)/);
  assert.match(native, /objects: vec!\[\]/);
  assert.match(app, /label="Projects"/);
  assert.match(app, /aria-label="Create project"/);
  assert.match(app, /aria-label="Project name"/);
  assert.match(app, /remindersApi\s*\.createProject/);
  assert.match(
    app,
    /const title = event\.currentTarget\.value;?[\s\S]*setProjectDraft/,
  );
  assert.match(app, /setSelection\(\{ type: "project", id: saved\.id \}\)/);
  assert.match(app, /projectSavingRef/);
  assert.match(app, /aria-label="Projects"/);
  assert.match(app, /className="reminders-project-count"/);
  assert.match(app, /<Draggable/);
  assert.match(app, /Delete Project/);
  assert.match(app, /countRemindersByProject\(items\)/);
  assert.match(
    read("../src/App.css"),
    /\.reminders-project-count[^}]*border-radius: 999px/,
  );
  assert.match(
    read("../src/App.css"),
    /\.reminders-project-count[^}]*opacity: 0/,
  );
  assert.match(
    read("../src/App.css"),
    /\.light \.reminders-sidebar nav \.reminders-project-count \{[^}]*rgb\(30 58 100 \/ 78%\)[^}]*color: #fff/,
  );
  assert.match(
    read("../src/App.css"),
    /button\[data-active\] \.reminders-project-count \{[^}]*var\(--foreground\) 12%[^}]*color: var\(--foreground\)/,
  );
  assert.doesNotMatch(
    read("../src/App.css"),
    /button\[data-active\] \.reminders-project-count \{[^}]*#3b82f6/,
  );
  assert.doesNotMatch(app, /My Lists|Add list|Rename list|Delete list/);
  assert.match(
    app,
    /projectId: selection\.type === "project" \? selection\.id : null/,
  );
  assert.match(app, /draggable=\{dragEnabled && !completionPending\}/);
  assert.match(native, /reorder_reminders/);
  assert.match(native, /permanently_delete_reminder/);
  const orderMigration = read(
    "../../../../crates/database/migrations/202609290001_reminder_project_order.sql",
  );
  assert.match(orderMigration, /CREATE TABLE reminder_project_order/);
  assert.match(orderMigration, /ROW_NUMBER\(\) OVER/);
  const migration = read(
    "../../../../crates/database/migrations/202609140001_replace_reminder_lists_with_projects.sql",
  );
  assert.match(migration, /SET list_id = 'reminders-inbox'/);
  assert.match(migration, /DELETE FROM reminder_lists/);
});

test("Reminders monitors overdue items through native system notifications", () => {
  const bootstrap = read("../src/overdue-notifications.ts");
  const native = read("../src-tauri/src/lib.rs");
  const monitor = read("../src-tauri/src/overdue_notifications.rs");
  const cargo = read("../src-tauri/Cargo.toml");
  const packageJson = read("../package.json");

  assert.doesNotMatch(packageJson, /@tauri-apps\/plugin-notification/);
  assert.match(cargo, /tauri-plugin-notification = "2"/);
  assert.match(bootstrap, /window\.Notification\.permission/);
  assert.match(bootstrap, /window\.Notification\.requestPermission\(\)/);
  assert.match(bootstrap, /set_overdue_notification_permission/);
  assert.match(native, /start_monitor/);
  assert.match(native, /CloseRequested \{ api, \.\. \}/);
  assert.match(native, /api\.prevent_close\(\)/);
  assert.match(native, /window\.hide\(\)/);
  assert.match(monitor, /Duration::from_secs\(30\)/);
  assert.match(monitor, /overdue-notifications\.json/);
  assert.match(monitor, /ReminderView::All/);
  assert.match(monitor, /Reminder overdue/);
  assert.match(monitor, /overdue reminders/);
});

test("Reminders supports subtle notes, date/time chips, project assignment, and smart views", () => {
  const app = read("../src/App.tsx");
  const api = read("../src/api.ts");
  const styles = read("../src/App.css");
  assert.match(app, /<Calendar\s+mode="single"/);
  assert.doesNotMatch(app, /type="date"/);
  assert.match(app, /defaultMonth=\{draft\.dueAt/);
  assert.match(app, /setDateOpen\(false\)/);
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

test("Reminders uses native preferences, a tray badge, and long-press subtask sorting", () => {
  const app = read("../src/App.tsx");
  const styles = read("../src/App.css");
  const main = read("../src/main.tsx");
  const preferences = read("../src/Preferences.tsx");
  const themeSync = read("../src/native-theme-sync.tsx");
  const backend = read("../src-tauri/src/lib.rs");
  const tray = read("../src-tauri/src/tray/mod.rs");
  const capability = JSON.parse(
    read("../src-tauri/capabilities/preferences.json"),
  ) as { windows: string[]; permissions: string[] };

  assert.match(main, /<NativeThemeSync \/>/);
  assert.match(preferences, /Reminders Settings/);
  assert.match(preferences, /System/);
  assert.match(themeSync, /getCurrentWindow\(\)\.setTheme/);
  assert.deepEqual(capability.windows, ["preferences"]);
  assert.ok(capability.permissions.includes("core:window:allow-set-theme"));
  assert.match(backend, /WebviewWindowBuilder::new/);
  assert.match(tray, /TrayIconBuilder::with_id\("reminders-tray"\)/);
  assert.match(backend, /standard_app_menu_with_settings/);
  assert.match(tray, /set_badge_count/);
  assert.match(tray, /tray\.set_title/);

  assert.match(app, /PointerSensor\.configure/);
  assert.match(app, /value: 275/);
  assert.match(app, /useSortable/);
  assert.match(app, /placeholder="Add subtask"/);
  assert.match(app, /commitNewSubtask/);
  assert.doesNotMatch(app, /GripVertical/);
  assert.doesNotMatch(app, /<button[^>]*reminder-add-subtask/);
  assert.match(
    styles,
    /\.reminder-subtask-checkbox[^}]*width: 18px[^}]*height: 18px/,
  );
  assert.match(styles, /\.reminder-subtask-input[^}]*font-size: 13px/);
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
  assert.match(app, /draft\.subtasks\.length > 0/);
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
    "../../../../packages/shared-ui/src/styles/styles.css",
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
    /if \(!extend\) \{[\s\S]*setSelectedId\(id\)[\s\S]*setSelectedIds\(new Set\(\)\)/,
  );
  assert.match(app, /onPointerEnter=\{\(event\) => \{/);
  assert.match(app, /event\.buttons === 1 && event\.shiftKey/);
  assert.match(
    app,
    /aria-keyshortcuts="Meta\+A Control\+A Shift\+ArrowUp Shift\+ArrowDown"/,
  );
  assert.match(app, /focused=\{selectedId === reminder\.id\}/);
  assert.match(
    app,
    /target\.closest\(\s*"\.reminder-row, button, input, textarea, \[contenteditable='true'\]",?\s*\)/,
  );
  assert.match(app, /clearReminderSelection\(\);?/);
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
    "../../../../crates/database/migrations/202609150002_add_reminder_media.sql",
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
