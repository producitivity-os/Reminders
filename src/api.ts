import { invoke } from "@tauri-apps/api/core";

export type ReminderView =
  "today" | "scheduled" | "all" | "completed" | "deleted";
export type ReminderPriority = "none" | "low" | "medium" | "high";
export type ReminderProject = { id: string; title: string };
export type CreateReminderProjectInput = { id: string; title: string };
export type ReminderSubtask = {
  id: string;
  title: string;
  completed: boolean;
};
export type Reminder = {
  id: string;
  listId: string;
  title: string;
  notes: string;
  dueAt: number | null;
  dueHasTime: boolean;
  priority: ReminderPriority;
  projectId: string | null;
  subtasks: ReminderSubtask[];
  completedAt: number | null;
  deletedAt: number | null;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
};
export type ReminderQuery = {
  view: ReminderView;
  listId: string | null;
  projectId: string | null;
  dayStart: number | null;
  dayEnd: number | null;
};
export type CreateReminderInput = {
  id?: string;
  listId: string;
  title: string;
  notes: string;
  dueAt: number | null;
  dueHasTime: boolean;
  priority: ReminderPriority;
  projectId: string | null;
  subtasks: ReminderSubtask[];
  afterId: string | null;
};
export type UpdateReminderInput = {
  id: string;
  listId: string;
  title: string;
  notes: string;
  dueAt: number | null;
  dueHasTime: boolean;
  priority: ReminderPriority;
  projectId: string | null;
  subtasks: ReminderSubtask[];
  sortIndex: number;
};

export const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
const storageKey = "reminders-browser-data-v1";
export const defaultReminderListId = "reminders-inbox";
type BrowserState = { reminders: Reminder[]; projects: ReminderProject[] };

function initialState(): BrowserState {
  return { reminders: [], projects: [] };
}

function browserState(): BrowserState {
  try {
    const state = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as BrowserState | null;
    if (!state) return initialState();
    return {
      projects: Array.isArray(state.projects) ? state.projects : [],
      reminders: state.reminders.map((reminder) => ({
        ...reminder,
        listId: defaultReminderListId,
        dueHasTime: reminder.dueHasTime ?? Boolean(reminder.dueAt),
        priority: reminder.priority ?? "none",
        projectId: reminder.projectId ?? null,
        subtasks: Array.isArray(reminder.subtasks) ? reminder.subtasks : [],
      })),
    };
  } catch {
    return initialState();
  }
}

function writeBrowser(state: BrowserState): void {
  localStorage.setItem(storageKey, JSON.stringify(state));
}
function updateReminder(
  id: string,
  change: (item: Reminder) => Reminder,
): Reminder | null {
  const state = browserState();
  const index = state.reminders.findIndex((item) => item.id === id);
  if (index < 0) return null;
  state.reminders[index] = change(state.reminders[index]);
  writeBrowser(state);
  return state.reminders[index];
}

export const remindersApi = {
  async projects(): Promise<ReminderProject[]> {
    return isTauri ? invoke("list_reminder_projects") : browserState().projects;
  },
  async createProject(
    input: CreateReminderProjectInput,
  ): Promise<ReminderProject> {
    if (isTauri) return invoke("create_reminder_project", { input });
    const state = browserState();
    const saved = { id: input.id, title: input.title.trim() };
    state.projects.push(saved);
    state.projects.sort((left, right) => left.title.localeCompare(right.title));
    writeBrowser(state);
    return saved;
  },
  async reminders(query: ReminderQuery): Promise<Reminder[]> {
    if (isTauri) return invoke("list_reminders", { query });
    const state = browserState();
    const now = Date.now();
    return state.reminders
      .filter((item) => {
        if (query.listId && item.listId !== query.listId) return false;
        if (query.projectId && item.projectId !== query.projectId) return false;
        if (query.view === "deleted") return item.deletedAt !== null;
        if (item.deletedAt !== null) return false;
        if (query.view === "completed") return item.completedAt !== null;
        if (item.completedAt !== null) return false;
        if (query.view === "scheduled") return item.dueAt !== null;
        if (query.view === "today")
          return (
            item.dueAt !== null &&
            item.dueAt >= (query.dayStart ?? now) &&
            item.dueAt < (query.dayEnd ?? now)
          );
        return true;
      })
      .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt);
  },
  async create(input: CreateReminderInput): Promise<Reminder> {
    if (isTauri) return invoke("create_reminder", { input });
    const state = browserState();
    const requestedId = input.id?.trim();
    const existing = requestedId
      ? state.reminders.find((item) => item.id === requestedId)
      : undefined;
    if (existing) return existing;
    const now = Date.now();
    const siblings = state.reminders
      .filter((item) => item.listId === input.listId && item.deletedAt === null)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    const afterIndex = input.afterId
      ? siblings.findIndex((item) => item.id === input.afterId)
      : -1;
    const sortIndex =
      afterIndex >= 0
        ? siblings[afterIndex].sortIndex + 1
        : (siblings.at(-1)?.sortIndex ?? -1) + 1;
    state.reminders = state.reminders.map((item) =>
      item.listId === input.listId &&
      item.deletedAt === null &&
      item.sortIndex >= sortIndex
        ? { ...item, sortIndex: item.sortIndex + 1 }
        : item,
    );
    const saved: Reminder = {
      id: requestedId || crypto.randomUUID(),
      listId: input.listId,
      title: input.title,
      notes: input.notes,
      dueAt: input.dueAt,
      dueHasTime: input.dueHasTime,
      priority: input.priority,
      projectId: input.projectId,
      subtasks: input.subtasks,
      completedAt:
        input.subtasks.length > 0 &&
        input.subtasks.every((subtask) => subtask.completed)
          ? now
          : null,
      deletedAt: null,
      sortIndex,
      createdAt: now,
      updatedAt: now,
    };
    state.reminders.push(saved);
    writeBrowser(state);
    return saved;
  },
  async update(input: UpdateReminderInput): Promise<Reminder> {
    if (isTauri) return invoke("update_reminder", { input });
    const state = browserState();
    const index = state.reminders.findIndex((item) => item.id === input.id);
    if (index < 0) throw new Error("The reminder no longer exists.");
    const saved: Reminder = {
      ...state.reminders[index],
      ...input,
      completedAt:
        input.subtasks.length === 0
          ? state.reminders[index].completedAt
          : input.subtasks.every((subtask) => subtask.completed)
            ? state.reminders[index].completedAt ?? Date.now()
            : null,
      updatedAt: Date.now(),
    };
    state.reminders[index] = saved;
    writeBrowser(state);
    return saved;
  },
  async reorder(listId: string, orderedIds: string[]): Promise<Reminder[]> {
    if (isTauri) return invoke("reorder_reminders", { listId, orderedIds });
    const state = browserState();
    state.reminders = state.reminders.map((item) => {
      const index = item.listId === listId ? orderedIds.indexOf(item.id) : -1;
      return index >= 0
        ? { ...item, sortIndex: index, updatedAt: Date.now() }
        : item;
    });
    writeBrowser(state);
    return state.reminders
      .filter((item) => item.listId === listId)
      .sort((a, b) => a.sortIndex - b.sortIndex);
  },
  async complete(id: string, completed: boolean): Promise<Reminder | null> {
    if (isTauri) return invoke("set_reminder_completed", { id, completed });
    const item = browserState().reminders.find((reminder) => reminder.id === id);
    if (item?.subtasks.length)
      throw new Error("Complete each subtask before completing this reminder.");
    return updateReminder(id, (reminder) => ({
      ...reminder,
      completedAt: completed ? Date.now() : null,
      updatedAt: Date.now(),
    }));
  },
  async remove(id: string): Promise<Reminder | null> {
    return isTauri
      ? invoke("delete_reminder", { id })
      : updateReminder(id, (item) => ({
          ...item,
          deletedAt: Date.now(),
          updatedAt: Date.now(),
        }));
  },
  async restore(id: string): Promise<Reminder | null> {
    return isTauri
      ? invoke("restore_reminder", { id })
      : updateReminder(id, (item) => ({
          ...item,
          deletedAt: null,
          updatedAt: Date.now(),
        }));
  },
  async permanentlyDelete(id: string): Promise<boolean> {
    if (isTauri) return invoke("permanently_delete_reminder", { id });
    const state = browserState();
    const before = state.reminders.length;
    state.reminders = state.reminders.filter((item) => item.id !== id);
    writeBrowser(state);
    return before !== state.reminders.length;
  },
};
