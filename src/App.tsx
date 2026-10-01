import * as React from "react"
import {
  CalendarDays,
  Check,
  CircleCheckBig,
  Clock3,
  Flag,
  FolderKanban,
  Inbox,
  Network,
  Plus,
  Search,
  Trash2,
  X,
} from "@productivity-os/shared-ui/components/sf-symbols"
import {
  ApplicationSidebar,
  ApplicationSidebarContent,
  ApplicationSidebarItem,
  ApplicationSidebarLayout,
  ApplicationSidebarNav,
  ApplicationSidebarSection,
} from "@productivity-os/shared-ui/components/application-sidebar"
import { Input } from "@productivity-os/shared-ui/components/ui/input"
import { Textarea } from "@productivity-os/shared-ui/components/ui/textarea"
import { TimePickerInput } from "@productivity-os/shared-ui/components/time-picker-input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@productivity-os/shared-ui/components/ui/popover"
import { Calendar } from "@productivity-os/shared-ui/components/ui/calendar"
import { ApplicationContextMenu } from "@productivity-os/shared-ui/components/application-context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@productivity-os/shared-ui/components/ui/dropdown-menu"
import Draggable from "react-draggable"
import {
  DragDropProvider,
  PointerSensor,
} from "@dnd-kit/react"
import { PointerActivationConstraints } from "@dnd-kit/dom"
import { useSortable } from "@dnd-kit/react/sortable"
import {
  remindersApi,
  defaultReminderListId,
  type Reminder,
  type ReminderPriority,
  type ReminderProject,
  type ReminderSubtask,
  type ReminderView,
} from "./api"
import {
  allReminderSelection,
  extendReminderSelection,
  reminderRangeSelection,
  reminderSelectionEdges,
} from "./reminder-selection"
import { countRemindersByProject } from "./reminder-project-counts"
import {
  countRemindersDueByToday,
  countScheduledReminders,
} from "./reminder-badge-count"
import { defaultReminderDueAt } from "./reminder-draft"
import { isReminderOverdue } from "./reminder-due-state"
import {
  copyReminderImage,
  fileAsDataUrl,
  readNativeClipboardImage,
  reminderImages,
  reminderImageUrl,
  type ReminderImageAttachment,
} from "./reminder-images"
import { DayPlan } from "./features/day-plan/DayPlan"

type Selection =
  | { type: "view"; id: ReminderView }
  | { type: "project"; id: string }
  | { type: "day-plan"; id: "today" }
type CompletionPhase = "holding" | "exiting"
type PendingCompletion = { reminder: Reminder; selectionKey: string }
type ProjectDraft = { title: string; saving: boolean; error: string | null }
type ProjectEditDraft = ProjectDraft & { id: string }
type ReminderDraft = {
  key: string
  afterId: string | null
  listId: string
  title: string
  dueAt: number | null
  dueHasTime: boolean
  priority: ReminderPriority
  projectId: string | null
  saving: boolean
  error: string | null
}
const completionHoldMs = 600
const completionExitMs = 180
const smartViews: Array<{
  id: ReminderView
  label: string
  icon: React.ReactNode | null
}> = [
  { id: "today", label: "Today", icon: null },
  { id: "scheduled", label: "Scheduled", icon: <CalendarDays /> },
  { id: "all", label: "All", icon: <Inbox /> },
  { id: "completed", label: "Completed", icon: <CircleCheckBig /> },
  { id: "deleted", label: "Recently Deleted", icon: <Trash2 /> },
]

const priorityLabels: Record<ReminderPriority, string> = {
  none: "Add Priority",
  low: "Low Priority",
  medium: "Medium Priority",
  high: "High Priority",
}

function localDateTimestamp(
  value: Date,
  current: number | null,
  preserveTime: boolean,
): number | null {
  const next = new Date(value)
  const previous = current ? new Date(current) : null
  next.setHours(
    preserveTime && previous ? previous.getHours() : 0,
    preserveTime && previous ? previous.getMinutes() : 0,
    0,
    0,
  )
  return next.getTime()
}

function SortableSubtask({
  id,
  index,
  disabled,
  completed,
  children,
}: {
  id: string
  index: number
  disabled: boolean
  completed: boolean
  children: React.ReactNode
}) {
  const { ref, isDragging } = useSortable({
    id,
    index,
    group: "reminder-subtasks",
    disabled,
  })
  return (
    <div
      ref={ref}
      className="reminder-subtask"
      data-completed={completed || undefined}
      data-dragging={isDragging || undefined}
    >
      {children}
    </div>
  )
}

function DraggableProjectItem({
  project,
  index,
  count,
  active,
  onSelect,
  onRename,
  onDelete,
  onMove,
}: {
  project: ReminderProject
  index: number
  count: number
  active: boolean
  onSelect(): void
  onRename(): void
  onDelete(): void
  onMove(targetIndex: number): void
}) {
  const nodeRef = React.useRef<HTMLDivElement>(null)
  const dragged = React.useRef(false)
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  return (
    <Draggable
      nodeRef={nodeRef}
      axis="y"
      position={position}
      onStart={() => {
        dragged.current = false
      }}
      onDrag={(_event, data) => {
        if (Math.abs(data.y) > 5) dragged.current = true
        setPosition({ x: 0, y: data.y })
      }}
      onStop={(_event, data) => {
        setPosition({ x: 0, y: 0 })
        if (Math.abs(data.y) > 16)
          onMove(index + Math.round(data.y / 33))
        window.setTimeout(() => {
          dragged.current = false
        }, 0)
      }}
    >
      <div ref={nodeRef} className="reminders-project-row">
        <ApplicationContextMenu
          actions={[
            { id: "rename", label: "Rename", onSelect: onRename },
            { id: "delete-separator", type: "separator" },
            {
              id: "delete",
              label: "Delete Project",
              icon: <Trash2 aria-hidden="true" />,
              variant: "destructive",
              onSelect: onDelete,
            },
          ]}
        >
          <button
            type="button"
            className="application-sidebar-item reminders-project-item"
            data-active={active || undefined}
            onClick={(event) => {
              if (dragged.current) {
                event.preventDefault()
                return
              }
              onSelect()
            }}
          >
            <FolderKanban />
            <span className="reminders-project-title">{project.title}</span>
            <span
              className="reminders-project-count"
              aria-label={`${count} active ${count === 1 ? "task" : "tasks"}`}
            >
              {count}
            </span>
          </button>
        </ApplicationContextMenu>
      </div>
    </Draggable>
  )
}

function formatReminderDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value)
}

function formatReminderTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value)
}

function queryFor(selection: Selection) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  return {
    view: selection.type === "view" ? selection.id : ("all" as ReminderView),
    listId: null,
    projectId: selection.type === "project" ? selection.id : null,
    dayStart: null,
    dayEnd:
      selection.type === "view" && selection.id === "today"
        ? tomorrow.getTime()
        : null,
  }
}

function keyForSelection(selection: Selection): string {
  return `${selection.type}:${selection.id}`
}

const allActiveRemindersQuery = {
  view: "all" as const,
  listId: null,
  projectId: null,
  dayStart: null,
  dayEnd: null,
}

async function setApplicationBadge(count: number): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("update_today_badge", { count })
}

function ReminderTimePicker({
  value,
  onChange,
}: {
  value: number | null
  onChange(value: number): void
}) {
  const hoursRef = React.useRef<HTMLInputElement>(null)
  const minutesRef = React.useRef<HTMLInputElement>(null)
  const date = React.useMemo(() => (value ? new Date(value) : new Date()), [value])
  const update = (next?: Date) => {
    if (!next) return
    const target = value ? new Date(value) : new Date()
    target.setHours(next.getHours(), next.getMinutes(), 0, 0)
    onChange(target.getTime())
  }
  return (
    <div className="reminder-time-picker" aria-label="Reminder time">
      <TimePickerInput
        ref={hoursRef}
        picker="hours"
        date={date}
        setDate={update}
        aria-label="Hours"
        onRightFocus={() => minutesRef.current?.focus()}
      />
      <span aria-hidden="true">:</span>
      <TimePickerInput
        ref={minutesRef}
        picker="minutes"
        date={date}
        setDate={update}
        aria-label="Minutes"
        onLeftFocus={() => hoursRef.current?.focus()}
      />
    </div>
  )
}

function ReminderRow({
  reminder,
  projects,
  selected,
  focused,
  selectionStart,
  selectionEnd,
  completionPhase,
  deletedView,
  hideProjectBadge,
  inputRef,
  onSelect,
  onSave,
  onCreateAfter,
  onComplete,
  onDelete,
  onRestore,
  onPermanentlyDelete,
  dragEnabled,
  onDragStart,
  onDrop,
  images,
  selectedImageId,
  onPasteImages,
  onSelectImage,
}: {
  reminder: Reminder
  projects: ReminderProject[]
  selected: boolean
  focused: boolean
  selectionStart: boolean
  selectionEnd: boolean
  completionPhase?: CompletionPhase
  deletedView: boolean
  hideProjectBadge: boolean
  inputRef(node: HTMLInputElement | null): void
  onSelect(extend: boolean, toggle: boolean): void
  onSave(next: Reminder, animateCompletion?: boolean): Promise<boolean>
  onCreateAfter(): void
  onComplete(completed: boolean): void
  onDelete(): void
  onRestore(): void
  onPermanentlyDelete(): void
  dragEnabled: boolean
  onDragStart(): void
  onDrop(): void
  images: ReminderImageAttachment[]
  selectedImageId: string | null
  onPasteImages(
    images: Array<{ originalName: string; mimeType: string; dataUrl: string }>,
  ): void
  onSelectImage(id: string): void
}) {
  const [draft, setDraft] = React.useState(reminder)
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  const [error, setError] = React.useState<string | null>(null)
  const pendingCommit = React.useRef<Promise<boolean> | null>(null)
  const notesRef = React.useRef<HTMLTextAreaElement | null>(null)
  const subtaskInputs = React.useRef(new Map<string, HTMLInputElement>())
  const subtaskOriginalTitles = React.useRef(new Map<string, string>())
  const newSubtaskIds = React.useRef(new Set<string>())
  const skipSubtaskBlur = React.useRef(new Set<string>())
  const subtaskSavingRef = React.useRef(false)
  const [subtaskSaving, setSubtaskSaving] = React.useState(false)
  const [dateOpen, setDateOpen] = React.useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = React.useState("")
  React.useEffect(() => setDraft(reminder), [reminder])
  React.useLayoutEffect(() => {
    const notes = notesRef.current
    if (!focused || !notes) return
    notes.style.height = "0px"
    notes.style.height = `${Math.max(20, notes.scrollHeight)}px`
  }, [draft.notes, focused])
  const commit = (): Promise<boolean> => {
    if (pendingCommit.current) return pendingCommit.current
    if (!draft.title.trim()) {
      setError("Enter a title.")
      return Promise.resolve(false)
    }
    if (JSON.stringify(draft) === JSON.stringify(reminder)) return Promise.resolve(true)
    const request = onSave({ ...draft, title: draft.title.trim() })
      .then((saved) => {
        if (saved) setError(null)
        return saved
      })
      .finally(() => {
        pendingCommit.current = null
      })
    pendingCommit.current = request
    return request
  }
  const persistPatch = (
    patch: Partial<
      Pick<Reminder, "dueAt" | "dueHasTime" | "listId" | "priority" | "projectId">
    >,
  ) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setError(null)
    void onSave(next).then((saved) => {
      if (!saved) setError("Couldn’t save changes.")
    })
  }
  const completionPending = Boolean(completionPhase)
  const detailsOpen = focused && !deletedView && completionPhase !== "exiting"
  const summaryOpen = (!focused || deletedView) && !completionPending
  const handleImagePaste = (
    event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (files.length > 0) {
      event.preventDefault()
      void Promise.all(
        files.map(async (file) => ({
          originalName: file.name || "pasted-image",
          mimeType: file.type || "image/png",
          dataUrl: await fileAsDataUrl(file),
        })),
      ).then(onPasteImages)
      return
    }
    if (!event.clipboardData.types.includes("text/plain")) {
      void readNativeClipboardImage().then((image) => {
        if (image) onPasteImages([image])
      })
    }
  }
  const focusSubtask = (id: string) => {
    window.requestAnimationFrame(() => {
      const input = subtaskInputs.current.get(id)
      input?.focus({ preventScroll: true })
      input?.setSelectionRange(input.value.length, input.value.length)
    })
  }
  const saveSubtasks = async (
    subtasks: ReminderSubtask[],
    previous: ReminderSubtask[],
  ) => {
    if (subtaskSavingRef.current || completionPending) return false
    const currentDraft = draftRef.current
    const next = { ...currentDraft, subtasks }
    const completes =
      !currentDraft.completedAt &&
      subtasks.length > 0 &&
      subtasks.every((subtask) => subtask.completed)
    subtaskSavingRef.current = true
    setSubtaskSaving(true)
    draftRef.current = next
    setDraft(next)
    setError(null)
    try {
      const saved = await onSave(next, completes)
      if (!saved) {
        draftRef.current = { ...draftRef.current, subtasks: previous }
        setDraft((current) => ({ ...current, subtasks: previous }))
        setError("Couldn’t save subtasks.")
      }
      return saved
    } finally {
      subtaskSavingRef.current = false
      setSubtaskSaving(false)
    }
  }
  const addSubtask = (afterId?: string) => {
    if (subtaskSaving || completionPending) return
    const id = crypto.randomUUID()
    newSubtaskIds.current.add(id)
    subtaskOriginalTitles.current.delete(id)
    setDraft((current) => ({
      ...current,
      subtasks: (() => {
        const next = [...current.subtasks]
        const index = afterId
          ? Math.max(0, next.findIndex((subtask) => subtask.id === afterId) + 1)
          : next.length
        next.splice(index, 0, { id, title: "", completed: false })
        return next
      })(),
    }))
    focusSubtask(id)
  }
  const finishSubtaskTitle = async (id: string, value: string) => {
    const isNew = newSubtaskIds.current.has(id)
    const originalTitle = isNew ? undefined : subtaskOriginalTitles.current.get(id)
    subtaskOriginalTitles.current.delete(id)
    const title = value.trim()
    if (!title) {
      newSubtaskIds.current.delete(id)
      setDraft((current) => ({
        ...current,
        subtasks:
          originalTitle === undefined
            ? current.subtasks.filter((subtask) => subtask.id !== id)
            : current.subtasks.map((subtask) =>
                subtask.id === id ? { ...subtask, title: originalTitle } : subtask,
              ),
      }))
      return false
    }
    newSubtaskIds.current.delete(id)
    const previous = draftRef.current.subtasks.map((subtask) => ({
      ...subtask,
    }))
    const current = draftRef.current.subtasks.find((subtask) => subtask.id === id)
    if (current?.title === title && originalTitle !== undefined) return true
    const next = draftRef.current.subtasks.map((subtask) =>
      subtask.id === id ? { ...subtask, title } : subtask,
    )
    return saveSubtasks(next, previous)
  }
  const cancelSubtaskTitle = (id: string) => {
    const isNew = newSubtaskIds.current.has(id)
    const originalTitle = isNew ? undefined : subtaskOriginalTitles.current.get(id)
    newSubtaskIds.current.delete(id)
    subtaskOriginalTitles.current.delete(id)
    setDraft((current) => ({
      ...current,
      subtasks:
        originalTitle === undefined
          ? current.subtasks.filter((subtask) => subtask.id !== id)
          : current.subtasks.map((subtask) =>
              subtask.id === id ? { ...subtask, title: originalTitle } : subtask,
            ),
    }))
  }
  const commitNewSubtask = async () => {
    const title = newSubtaskTitle.trim()
    if (!title || subtaskSaving || completionPending) return false
    const previous = draftRef.current.subtasks.map((subtask) => ({ ...subtask }))
    const next = [
      ...previous,
      { id: crypto.randomUUID(), title, completed: false },
    ]
    const saved = await saveSubtasks(next, previous)
    if (saved) setNewSubtaskTitle("")
    return saved
  }
  const reorderSubtasks = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || subtaskSaving || completionPending) return
    const previous = draftRef.current.subtasks.map((subtask) => ({ ...subtask }))
    const from = previous.findIndex((subtask) => subtask.id === sourceId)
    const to = previous.findIndex((subtask) => subtask.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...previous]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    void saveSubtasks(next, previous)
  }
  return (
    <ApplicationContextMenu
      actions={
        deletedView
          ? [
              { id: "restore", label: "Restore", onSelect: onRestore },
              { id: "delete-separator", type: "separator" },
              {
                id: "delete-permanently",
                label: "Delete permanently",
                variant: "destructive",
                onSelect: onPermanentlyDelete,
              },
            ]
          : [
              {
                id: "delete",
                label: "Delete",
                icon: <Trash2 aria-hidden="true" />,
                variant: "destructive",
                onSelect: onDelete,
              },
            ]
      }
    >
      <article
        className="reminder-row"
        data-selected={selected || undefined}
        data-selection-start={selectionStart || undefined}
        data-selection-end={selectionEnd || undefined}
        data-focused={focused || undefined}
        data-completed={Boolean(reminder.completedAt) || undefined}
        data-completion-phase={completionPhase}
        aria-busy={completionPending || undefined}
        draggable={dragEnabled && !completionPending}
        onDragStart={(event) => {
          if (event.shiftKey) {
            event.preventDefault()
            return
          }
          onDragStart()
        }}
        onDragOver={(event) => {
          if (dragEnabled && !completionPending) event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (!completionPending) onDrop()
        }}
        onClick={(event) => {
          if (!completionPending)
            onSelect(event.shiftKey, event.metaKey || event.ctrlKey)
        }}
        onPointerDown={(event) => {
          if (!completionPending && event.button === 0 && event.shiftKey) {
            event.preventDefault()
            onSelect(true, false)
          }
        }}
        onPointerEnter={(event) => {
          if (!completionPending && event.buttons === 1 && event.shiftKey)
            onSelect(true, false)
        }}
      >
        <button
          className="reminder-checkbox"
          aria-label={
            draft.subtasks.length > 0
              ? draft.subtasks.every((subtask) => subtask.completed)
                ? "Completed through subtasks"
                : "Complete all subtasks first"
              : reminder.completedAt
                ? "Mark incomplete"
                : "Mark complete"
          }
          aria-pressed={
            Boolean(reminder.completedAt) ||
            (draft.subtasks.length > 0 &&
              draft.subtasks.every((subtask) => subtask.completed))
          }
          disabled={
            deletedView || completionPending || draft.subtasks.length > 0
          }
          onClick={(event) => {
            event.stopPropagation()
            onComplete(!reminder.completedAt)
          }}
        >
          {(reminder.completedAt ||
            (draft.subtasks.length > 0 &&
              draft.subtasks.every((subtask) => subtask.completed))) && <Check />}
        </button>
        <div className="reminder-row-content">
          <Input
            ref={inputRef}
            className="reminder-title-input"
            value={draft.title}
            aria-label="Reminder title"
            aria-invalid={Boolean(error) || undefined}
            readOnly={completionPending}
            onChange={(event) => {
              const title = event.currentTarget.value
              setError(null)
              setDraft((item) => ({ ...item, title }))
            }}
            onPaste={handleImagePaste}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Tab" && !event.shiftKey) {
                event.preventDefault()
                onSelect(false, false)
                window.requestAnimationFrame(() =>
                  notesRef.current?.focus({ preventScroll: true }),
                )
                return
              }
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return
              event.preventDefault()
              void commit().then((saved) => {
                if (saved) onCreateAfter()
              })
            }}
          />
          {error && (
            <small className="reminder-inline-error" role="alert">
              {error}
            </small>
          )}
          {!deletedView && (
            <div
              className="reminder-reveal reminder-details-reveal"
              data-open={detailsOpen || undefined}
              aria-hidden={!detailsOpen}
              inert={!detailsOpen}
            >
              <div className="reminder-details-inner">
                <div className="reminder-details-content">
                  <Textarea
                    ref={notesRef}
                    className="reminder-notes-input"
                    rows={1}
                    value={draft.notes}
                    placeholder="Notes"
                    aria-label="Notes"
                    onChange={(event) => {
                      const notes = event.currentTarget.value
                      setDraft((item) => ({ ...item, notes }))
                    }}
                    onPaste={handleImagePaste}
                    onBlur={() => void commit()}
                  />
                  <DragDropProvider
                    sensors={(defaults) => [
                      ...defaults.filter((sensor) => sensor !== PointerSensor),
                      PointerSensor.configure({
                        activationConstraints: [
                          new PointerActivationConstraints.Delay({
                            value: 275,
                            tolerance: 5,
                          }),
                        ],
                      }),
                    ]}
                    onDragEnd={(event) => {
                      if (event.canceled) return
                      const sourceId = event.operation.source?.id
                      const targetId = event.operation.target?.id
                      if (sourceId != null && targetId != null)
                        reorderSubtasks(String(sourceId), String(targetId))
                    }}
                  >
                    <div
                      className="reminder-subtasks"
                      aria-label="Subtasks"
                      aria-busy={subtaskSaving || undefined}
                    >
                      {draft.subtasks.map((subtask, index) => (
                        <SortableSubtask
                          key={subtask.id}
                          id={subtask.id}
                          index={index}
                          disabled={subtaskSaving || completionPending}
                          completed={subtask.completed}
                        >
                        <button
                          type="button"
                          className="reminder-checkbox reminder-subtask-checkbox"
                          aria-label={
                            subtask.completed
                              ? `Mark ${subtask.title || "subtask"} incomplete`
                              : `Complete ${subtask.title || "subtask"}`
                          }
                          aria-pressed={subtask.completed}
                          disabled={subtaskSaving || completionPending}
                          onClick={(event) => {
                            event.stopPropagation()
                            const previous = draft.subtasks.map((item) => ({
                              ...item,
                            }))
                            const next = draft.subtasks.map((item) =>
                              item.id === subtask.id
                                ? { ...item, completed: !item.completed }
                                : item,
                            )
                            void saveSubtasks(next, previous)
                          }}
                        >
                          {subtask.completed && <Check aria-hidden="true" />}
                        </button>
                        <Input
                          ref={(node) => {
                            if (node) subtaskInputs.current.set(subtask.id, node)
                            else subtaskInputs.current.delete(subtask.id)
                          }}
                          className="reminder-subtask-input"
                          value={subtask.title}
                          placeholder="Subtask"
                          aria-label="Subtask title"
                          disabled={subtaskSaving || completionPending}
                          onFocus={() => {
                            if (
                              !newSubtaskIds.current.has(subtask.id) &&
                              !subtaskOriginalTitles.current.has(subtask.id)
                            )
                              subtaskOriginalTitles.current.set(
                                subtask.id,
                                subtask.title,
                              )
                          }}
                          onChange={(event) => {
                            const title = event.currentTarget.value
                            setDraft((current) => ({
                              ...current,
                              subtasks: current.subtasks.map((item) =>
                                item.id === subtask.id ? { ...item, title } : item,
                              ),
                            }))
                          }}
                          onBlur={(event) => {
                            if (skipSubtaskBlur.current.delete(subtask.id)) return
                            void finishSubtaskTitle(
                              subtask.id,
                              event.currentTarget.value,
                            )
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault()
                              skipSubtaskBlur.current.add(subtask.id)
                              const value = event.currentTarget.value
                              void finishSubtaskTitle(subtask.id, value).then(
                                (saved) => {
                                  if (saved) addSubtask(subtask.id)
                                },
                              )
                            } else if (event.key === "Escape") {
                              event.preventDefault()
                              skipSubtaskBlur.current.add(subtask.id)
                              cancelSubtaskTitle(subtask.id)
                              event.currentTarget.blur()
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="reminder-subtask-delete"
                          aria-label={`Delete ${subtask.title || "subtask"}`}
                          disabled={subtaskSaving || completionPending}
                          onClick={(event) => {
                            event.stopPropagation()
                            const previous = draft.subtasks.map((item) => ({
                              ...item,
                            }))
                            void saveSubtasks(
                              draft.subtasks.filter((item) => item.id !== subtask.id),
                              previous,
                            )
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                        </SortableSubtask>
                      ))}
                      <Input
                      className="reminder-add-subtask-input"
                      value={newSubtaskTitle}
                      placeholder="Add subtask"
                      aria-label="Add subtask"
                      disabled={subtaskSaving || completionPending}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setNewSubtaskTitle(event.currentTarget.value)}
                      onBlur={() => void commitNewSubtask()}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          void commitNewSubtask().then(() =>
                            event.currentTarget.focus({ preventScroll: true }),
                          )
                        } else if (event.key === "Escape") {
                          event.preventDefault()
                          setNewSubtaskTitle("")
                          event.currentTarget.blur()
                        }
                      }}
                    />
                    </div>
                  </DragDropProvider>
                  <div className="reminder-metadata-chips">
                    <Popover open={dateOpen} onOpenChange={setDateOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="reminder-metadata-chip"
                          data-populated={Boolean(draft.dueAt) || undefined}
                        >
                          <CalendarDays aria-hidden="true" />
                          <span>
                            {draft.dueAt ? formatReminderDate(draft.dueAt) : "Add Date"}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="reminder-date-popover">
                        <Calendar
                          mode="single"
                          autoFocus
                          selected={draft.dueAt ? new Date(draft.dueAt) : undefined}
                          defaultMonth={draft.dueAt ? new Date(draft.dueAt) : new Date()}
                          onSelect={(value) => {
                            if (!value) return
                            persistPatch({
                              dueAt: localDateTimestamp(
                                value,
                                draft.dueAt,
                                draft.dueHasTime,
                              ),
                            })
                            setDateOpen(false)
                          }}
                        />
                        {draft.dueAt && (
                          <button
                            type="button"
                            className="reminder-popover-clear"
                            onClick={() => {
                              persistPatch({ dueAt: null, dueHasTime: false })
                              setDateOpen(false)
                            }}
                          >
                            <X /> Clear date
                          </button>
                        )}
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="reminder-metadata-chip"
                          data-populated={draft.dueHasTime || undefined}
                        >
                          <Clock3 aria-hidden="true" />
                          <span>
                            {draft.dueAt && draft.dueHasTime
                              ? formatReminderTime(draft.dueAt)
                              : "Add Time"}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="reminder-time-popover">
                        <ReminderTimePicker
                          value={draft.dueAt}
                          onChange={(dueAt) =>
                            persistPatch({ dueAt, dueHasTime: true })
                          }
                        />
                        {draft.dueHasTime && (
                          <button
                            type="button"
                            className="reminder-popover-clear"
                            onClick={() => {
                              const date = draft.dueAt ? new Date(draft.dueAt) : null
                              persistPatch({
                                dueAt: date?.setHours(0, 0, 0, 0) ?? null,
                                dueHasTime: false,
                              })
                            }}
                          >
                            <X /> Clear time
                          </button>
                        )}
                      </PopoverContent>
                    </Popover>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            className="reminder-metadata-chip"
                            data-populated={draft.priority !== "none" || undefined}
                            aria-label="Set reminder priority"
                          >
                            <Flag aria-hidden="true" />
                            <span>{priorityLabels[draft.priority]}</span>
                          </button>
                        }
                      />
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>Priority</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={draft.priority}
                          onValueChange={(value) =>
                            persistPatch({
                              priority: value as ReminderPriority,
                            })
                          }
                        >
                          <DropdownMenuRadioItem value="none">
                            None
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="low">Low</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="medium">
                            Medium
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="high">
                            High
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {!hideProjectBadge && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              className="reminder-metadata-chip"
                              data-populated={Boolean(draft.projectId) || undefined}
                              aria-label="Assign reminder to project"
                            >
                              <FolderKanban aria-hidden="true" />
                              <span>
                                {projects.find(
                                  (project) => project.id === draft.projectId,
                                )?.title ?? "Add Project"}
                              </span>
                            </button>
                          }
                        />
                        <DropdownMenuContent align="start">
                          <DropdownMenuLabel>Project</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={draft.projectId ?? "none"}
                            onValueChange={(value) =>
                              persistPatch({
                                projectId: value === "none" ? null : value,
                              })
                            }
                          >
                            <DropdownMenuRadioItem value="none">
                              None
                            </DropdownMenuRadioItem>
                            {projects.map((project) => (
                              <DropdownMenuRadioItem
                                key={project.id}
                                value={project.id}
                              >
                                {project.title}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                          {projects.length === 0 && (
                            <DropdownMenuItem disabled>
                              No projects available
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {(reminder.notes || reminder.dueAt) && (
            <div
              className="reminder-reveal reminder-summary-reveal"
              data-open={summaryOpen || undefined}
              aria-hidden={!summaryOpen}
            >
              <div className="reminder-summary-inner">
                <div className="reminder-summary-content">
                  {reminder.notes && <p>{reminder.notes}</p>}
                  {!focused && reminder.dueAt && (
                    <time
                      dateTime={new Date(reminder.dueAt).toISOString()}
                      data-overdue={
                        isReminderOverdue(reminder) || undefined
                      }
                    >
                      {formatReminderDate(reminder.dueAt)}
                    </time>
                  )}
                </div>
              </div>
            </div>
          )}
          {images.length > 0 && (
            <div className="reminder-images" aria-label="Reminder images">
              {images.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  className="reminder-image"
                  aria-label={`Select ${image.originalName}`}
                  aria-pressed={selectedImageId === image.id}
                  data-selected={selectedImageId === image.id || undefined}
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelectImage(image.id)
                  }}
                >
                  <img
                    src={reminderImageUrl(image.id)}
                    alt={image.originalName}
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </article>
    </ApplicationContextMenu>
  )
}

function NewReminderRow({
  draft,
  inputRef,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: ReminderDraft
  inputRef(node: HTMLInputElement | null): void
  onChange(title: string): void
  onCommit(createNext: boolean): void
  onCancel(): void
}) {
  return (
    <form
      className="reminder-row reminder-new"
      onSubmit={(event) => {
        event.preventDefault()
        onCommit(true)
      }}
    >
      <span className="reminder-checkbox" />
      <div className="reminder-row-content">
        <Input
          ref={inputRef}
          value={draft.title}
          placeholder="New Reminder"
          aria-label="New reminder title"
          aria-invalid={Boolean(draft.error) || undefined}
          disabled={draft.saving}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={() => {
            if (!draft.title.trim()) onCancel()
            else onCommit(false)
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              onCancel()
            }
            if (event.key === "Enter" && event.nativeEvent.isComposing)
              event.preventDefault()
          }}
        />
        {draft.error && (
          <small className="reminder-inline-error" role="alert">
            {draft.error}
          </small>
        )}
      </div>
    </form>
  )
}

export function App() {
  const [selection, setSelection] = React.useState<Selection>({
    type: "view",
    id: "all",
  })
  const [projects, setProjects] = React.useState<ReminderProject[]>([])
  const [projectDraft, setProjectDraft] = React.useState<ProjectDraft | null>(null)
  const [projectEdit, setProjectEdit] = React.useState<ProjectEditDraft | null>(
    null,
  )
  const [reminders, setReminders] = React.useState<Reminder[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [drafts, setDrafts] = React.useState<ReminderDraft[]>([])
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchVisible, setSearchVisible] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [applicationBadgeCount, setApplicationBadgeCount] = React.useState<
    number | null
  >(null)
  const [scheduledReminderCount, setScheduledReminderCount] = React.useState(0)
  const [projectReminderCounts, setProjectReminderCounts] = React.useState<
    Record<string, number>
  >({})
  const [draggedId, setDraggedId] = React.useState<string | null>(null)
  const [images, setImages] = React.useState<ReminderImageAttachment[]>([])
  const [selectedImageId, setSelectedImageId] = React.useState<string | null>(null)
  const [imageError, setImageError] = React.useState<string | null>(null)
  const [completionPhases, setCompletionPhases] = React.useState<
    Record<string, CompletionPhase>
  >({})
  const draftInputs = React.useRef(new Map<string, HTMLInputElement>())
  const reminderInputs = React.useRef(new Map<string, HTMLInputElement>())
  const selectionAnchorRef = React.useRef<string | null>(null)
  const pendingDrafts = React.useRef(new Set<string>())
  const pendingCompletions = React.useRef(new Map<string, PendingCompletion>())
  const completionTimers = React.useRef(new Map<number, () => void>())
  const selectionRef = React.useRef(selection)
  const projectInputRef = React.useRef<HTMLInputElement>(null)
  const projectEditInputRef = React.useRef<HTMLInputElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const projectSavingRef = React.useRef(false)
  selectionRef.current = selection

  const focusDraftInput = React.useCallback((key: string) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const input = draftInputs.current.get(key)
        if (!input) return
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      })
    })
  }, [])

  const waitForCompletion = React.useCallback(
    (duration: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          completionTimers.current.delete(timer)
          resolve()
        }, duration)
        completionTimers.current.set(timer, resolve)
      }),
    [],
  )

  React.useEffect(
    () => () => {
      pendingCompletions.current.clear()
      for (const [timer, resolve] of completionTimers.current) {
        window.clearTimeout(timer)
        resolve()
      }
      completionTimers.current.clear()
    },
    [],
  )

  const updateActiveReminderSummary = React.useCallback(
    (items: readonly Reminder[]) => {
      setApplicationBadgeCount(countRemindersDueByToday(items))
      setScheduledReminderCount(countScheduledReminders(items))
      setProjectReminderCounts(countRemindersByProject(items))
    },
    [],
  )

  const sync = React.useCallback(async () => {
    const requestedSelectionKey = keyForSelection(selection)
    const [nextProjects, nextReminders, activeReminders] = await Promise.all([
      remindersApi.projects(),
      remindersApi.reminders(queryFor(selection)),
      remindersApi.reminders(allActiveRemindersQuery),
    ])
    if (keyForSelection(selectionRef.current) !== requestedSelectionKey) return
    if (
      selection.type === "project" &&
      !nextProjects.some((project) => project.id === selection.id)
    )
      setSelection({ type: "view", id: "all" })
    setProjects((current) =>
      nextProjects.map(
        (project) =>
          current.find(
            (candidate) =>
              candidate.id === project.id && candidate.title === project.title,
          ) ?? project,
      ),
    )
    setReminders((current) => {
      const pending = [...pendingCompletions.current.values()].filter(
        (completion) => completion.selectionKey === requestedSelectionKey,
      )
      const pendingById = new Map(
        pending.map((completion) => [completion.reminder.id, completion.reminder]),
      )
      const merged = nextReminders.map(
        (reminder) => pendingById.get(reminder.id) ?? reminder,
      )
      const mergedIds = new Set(merged.map((reminder) => reminder.id))
      for (const completion of pending) {
        if (!mergedIds.has(completion.reminder.id)) merged.push(completion.reminder)
      }
      return merged
        .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
        .map((reminder) => {
          const previous = current.find((candidate) => candidate.id === reminder.id)
          return previous && JSON.stringify(previous) === JSON.stringify(reminder)
            ? previous
            : reminder
        })
    })
    updateActiveReminderSummary(activeReminders)
  }, [selection, updateActiveReminderSummary])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      await sync()
    } finally {
      setLoading(false)
    }
  }, [sync])
  React.useEffect(() => {
    void refresh()
  }, [refresh])
  const reminderIdsKey = React.useMemo(
    () =>
      reminders
        .map((reminder) => reminder.id)
        .sort()
        .join("\n"),
    [reminders],
  )
  React.useEffect(() => {
    let cancelled = false
    const reminderIds = reminderIdsKey ? reminderIdsKey.split("\n") : []
    void reminderImages
      .list(reminderIds)
      .then((items) => {
        if (!cancelled) setImages(items)
      })
      .catch((error) => {
        if (!cancelled)
          setImageError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [reminderIdsKey])
  React.useEffect(() => {
    if (applicationBadgeCount === null) return
    void setApplicationBadge(applicationBadgeCount).catch((error) => {
      console.warn("Could not update the Reminders application badge", error)
    })
  }, [applicationBadgeCount])
  React.useEffect(() => {
    const update = () => void sync().catch(() => undefined)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") update()
    }
    const interval = window.setInterval(update, 3_000)
    window.addEventListener("focus", update)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", update)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [sync])

  const selectedProject =
    selection.type === "project"
      ? projects.find((item) => item.id === selection.id)
      : null
  const title =
    selection.type === "day-plan" ? "Day Plan" : selectedProject?.title ??
    smartViews.find(
      (item) => item.id === (selection.type === "view" ? selection.id : "all"),
    )?.label ??
    "Reminders"
  const saveReminder = async (item: Reminder): Promise<boolean> => {
    try {
      const saved = await remindersApi.update({
        id: item.id,
        listId: item.listId,
        title: item.title,
        notes: item.notes,
        dueAt: item.dueAt,
        dueHasTime: item.dueHasTime,
        priority: item.priority,
        projectId: item.projectId,
        subtasks: item.subtasks,
        sortIndex: item.sortIndex,
      })
      setReminders((current) =>
        selection.type === "project" && saved.projectId !== selection.id
          ? current.filter((candidate) => candidate.id !== saved.id)
          : current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
      )
      void remindersApi
        .reminders(allActiveRemindersQuery)
        .then(updateActiveReminderSummary)
        .catch(() => undefined)
      return true
    } catch (error) {
      return false
    }
  }

  const setReminderCompleted = React.useCallback(
    (reminder: Reminder, completed: boolean) => {
      if (!completed) {
        void remindersApi
          .complete(reminder.id, false)
          .then(() => refresh())
          .catch(() => undefined)
        return
      }
      if (pendingCompletions.current.has(reminder.id)) return

      const startedAt = Date.now()
      const originSelectionKey = keyForSelection(selection)
      const original = reminder
      const optimistic = {
        ...reminder,
        completedAt: startedAt,
        updatedAt: startedAt,
      }
      pendingCompletions.current.set(reminder.id, {
        reminder: optimistic,
        selectionKey: originSelectionKey,
      })
      setCompletionPhases((current) => ({
        ...current,
        [reminder.id]: "holding",
      }))
      setSelectedId((current) => (current === reminder.id ? null : current))
      setSelectedIds((current) => {
        if (!current.has(reminder.id)) return current
        const next = new Set(current)
        next.delete(reminder.id)
        return next
      })
      if (selectionAnchorRef.current === reminder.id) selectionAnchorRef.current = null
      setReminders((current) =>
        current.map((candidate) =>
          candidate.id === reminder.id ? optimistic : candidate,
        ),
      )

      void (async () => {
        try {
          const saved = await remindersApi.complete(reminder.id, true)
          if (!saved) throw new Error("The reminder no longer exists.")
          const pending = pendingCompletions.current.get(reminder.id)
          if (!pending) return
          pending.reminder = saved
          setReminders((current) =>
            current.map((candidate) =>
              candidate.id === reminder.id ? saved : candidate,
            ),
          )

          const remainingHold = Math.max(0, completionHoldMs - (Date.now() - startedAt))
          if (remainingHold) await waitForCompletion(remainingHold)
          if (!pendingCompletions.current.has(reminder.id)) return
          setCompletionPhases((current) => ({
            ...current,
            [reminder.id]: "exiting",
          }))
          await waitForCompletion(completionExitMs)
          if (!pendingCompletions.current.has(reminder.id)) return

          pendingCompletions.current.delete(reminder.id)
          setCompletionPhases((current) => {
            const next = { ...current }
            delete next[reminder.id]
            return next
          })
          if (keyForSelection(selectionRef.current) === originSelectionKey)
            setReminders((current) =>
              current.filter((candidate) => candidate.id !== reminder.id),
            )
          void remindersApi
            .reminders(allActiveRemindersQuery)
            .then(updateActiveReminderSummary)
            .catch(() => undefined)
        } catch {
          if (!pendingCompletions.current.has(reminder.id)) return
          pendingCompletions.current.delete(reminder.id)
          setCompletionPhases((current) => {
            const next = { ...current }
            delete next[reminder.id]
            return next
          })
          if (keyForSelection(selectionRef.current) === originSelectionKey) {
            setReminders((current) => {
              const restored = current.some((candidate) => candidate.id === original.id)
                ? current.map((candidate) =>
                    candidate.id === original.id ? original : candidate,
                  )
                : [...current, original]
              return restored.sort(
                (a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt,
              )
            })
          }
        }
      })()
    },
    [refresh, selection, updateActiveReminderSummary, waitForCompletion],
  )

  const draftContext = React.useCallback(
    (_afterId: string | null) => {
      return {
        listId: defaultReminderListId,
        dueAt: defaultReminderDueAt(selection),
        dueHasTime: false,
        priority: "none" as ReminderPriority,
        projectId: selection.type === "project" ? selection.id : null,
      }
    },
    [selection],
  )

  const addDraft = React.useCallback(
    (afterId: string | null) => {
      const key = crypto.randomUUID()
      const context = draftContext(afterId)
      setSelectedId(null)
      setSelectedIds(new Set())
      selectionAnchorRef.current = null
      setDrafts((current) => [
        ...current,
        { key, afterId, ...context, title: "", saving: false, error: null },
      ])
      focusDraftInput(key)
    },
    [draftContext, focusDraftInput],
  )

  const canAddReminder = !(
    selection.type === "view" &&
    (selection.id === "completed" || selection.id === "deleted")
  )
  const addReminderAtEnd = React.useCallback(() => {
    if (!canAddReminder) return
    addDraft(reminders.at(-1)?.id ?? null)
  }, [addDraft, canAddReminder, reminders])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "n" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      )
        return
      event.preventDefault()
      addReminderAtEnd()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [addReminderAtEnd])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "f" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      )
        return
      event.preventDefault()
      setSearchVisible(true)
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  React.useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      unlisten = await getCurrentWindow().listen("reminders:new-reminder", () => {
        addReminderAtEnd()
      })
    })
    return () => unlisten?.()
  }, [addReminderAtEnd])

  const cancelDraft = React.useCallback((key: string) => {
    if (pendingDrafts.current.has(key)) return
    setDrafts((current) => current.filter((draft) => draft.key !== key))
    draftInputs.current.delete(key)
  }, [])

  const commitDraft = React.useCallback(
    (key: string, createNext: boolean) => {
      if (pendingDrafts.current.has(key)) return
      const draft = drafts.find((candidate) => candidate.key === key)
      if (!draft) return
      const title = draft.title.trim()
      if (!title) {
        setDrafts((current) =>
          current.map((candidate) =>
            candidate.key === key
              ? { ...candidate, error: "Enter a title." }
              : candidate,
          ),
        )
        draftInputs.current.get(key)?.focus()
        return
      }
      pendingDrafts.current.add(key)
      setDrafts((current) =>
        current.map((candidate) =>
          candidate.key === key
            ? { ...candidate, saving: true, error: null }
            : candidate,
        ),
      )
      void remindersApi
        .create({
          id: draft.key,
          listId: draft.listId,
          title,
          notes: "",
          dueAt: draft.dueAt,
          dueHasTime: draft.dueHasTime,
          priority: draft.priority,
          projectId: draft.projectId,
          subtasks: [],
          afterId: draft.afterId,
        })
        .then((saved) => {
          const remainsVisible =
            selection.type === "project"
              ? saved.projectId === selection.id
              : selection.id === "all" ||
                selection.id === "today" ||
                selection.id === "scheduled"
          setReminders((current) =>
            remainsVisible
              ? [...current.filter((item) => item.id !== saved.id), saved].sort(
                  (a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt,
                )
              : current.filter((item) => item.id !== saved.id),
          )
          void remindersApi
            .reminders(allActiveRemindersQuery)
            .then(updateActiveReminderSummary)
            .catch(() => undefined)
          setSelectedId(null)
          setSelectedIds(new Set())
          selectionAnchorRef.current = null
          setDrafts((current) => current.filter((candidate) => candidate.key !== key))
          draftInputs.current.delete(key)
          if (createNext)
            addDraft(remainsVisible ? saved.id : (reminders.at(-1)?.id ?? null))
        })
        .catch((error) => {
          pendingDrafts.current.delete(key)
          setDrafts((current) =>
            current.map((candidate) =>
              candidate.key === key
                ? {
                    ...candidate,
                    saving: false,
                    error: error instanceof Error ? error.message : String(error),
                  }
                : candidate,
            ),
          )
          window.requestAnimationFrame(() => draftInputs.current.get(key)?.focus())
        })
    },
    [addDraft, drafts, reminders, selection, updateActiveReminderSummary],
  )

  const draftsAfter = React.useCallback(
    (afterId: string | null) => drafts.filter((draft) => draft.afterId === afterId),
    [drafts],
  )
  const renderDraft = (draft: ReminderDraft) => (
    <NewReminderRow
      key={draft.key}
      draft={draft}
      inputRef={(node) => {
        if (node) draftInputs.current.set(draft.key, node)
        else draftInputs.current.delete(draft.key)
      }}
      onChange={(title) =>
        setDrafts((current) =>
          current.map((candidate) =>
            candidate.key === draft.key
              ? { ...candidate, title, error: null }
              : candidate,
          ),
        )
      }
      onCommit={(createNext) => commitDraft(draft.key, createNext)}
      onCancel={() => cancelDraft(draft.key)}
    />
  )
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const visibleReminders = React.useMemo(
    () =>
      normalizedSearch
        ? reminders.filter((reminder) =>
            `${reminder.title}\n${reminder.notes}`
              .toLocaleLowerCase()
              .includes(normalizedSearch),
          )
        : reminders,
    [normalizedSearch, reminders],
  )
  const visibleReminderIds = React.useMemo(
    () => visibleReminders.map((reminder) => reminder.id),
    [visibleReminders],
  )

  const clearReminderSelection = React.useCallback(() => {
    setSelectedId(null)
    setSelectedIds(new Set())
    selectionAnchorRef.current = null
  }, [])

  const selectImage = React.useCallback(
    (id: string) => {
      clearReminderSelection()
      setSelectedImageId(id)
      setImageError(null)
    },
    [clearReminderSelection],
  )

  const importImages = React.useCallback(
    (
      reminderId: string,
      inputs: Array<{
        originalName: string
        mimeType: string
        dataUrl: string
      }>,
    ) => {
      setImageError(null)
      void Promise.all(inputs.map((input) => reminderImages.import(reminderId, input)))
        .then((saved) =>
          setImages((current) =>
            [
              ...current.filter(
                (item) => !saved.some((candidate) => candidate.id === item.id),
              ),
              ...saved,
            ].sort(
              (left, right) =>
                left.createdAt - right.createdAt || left.id.localeCompare(right.id),
            ),
          ),
        )
        .catch((error) =>
          setImageError(error instanceof Error ? error.message : String(error)),
        )
    },
    [],
  )

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedImageId) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "c") {
        event.preventDefault()
        void copyReminderImage(selectedImageId).catch((error) => {
          setImageError(error instanceof Error ? error.message : String(error))
        })
        return
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return
      event.preventDefault()
      const deleting = selectedImageId
      void reminderImages
        .delete(deleting)
        .then((deleted) => {
          if (!deleted) return
          setImages((current) => current.filter((item) => item.id !== deleting))
          setSelectedImageId(null)
        })
        .catch((error) =>
          setImageError(error instanceof Error ? error.message : String(error)),
        )
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedImageId])

  const createProject = React.useCallback(() => {
    if (!projectDraft || projectDraft.saving || projectSavingRef.current) return
    const title = projectDraft.title.trim()
    if (!title) {
      setProjectDraft((current) =>
        current ? { ...current, error: "Enter a project name." } : current,
      )
      projectInputRef.current?.focus()
      return
    }
    projectSavingRef.current = true
    setProjectDraft({ title: projectDraft.title, saving: true, error: null })
    void remindersApi
      .createProject({
        id: `workflow-${crypto.randomUUID()}`,
        title,
      })
      .then((saved) => {
        setProjects((current) =>
          [...current.filter((project) => project.id !== saved.id), saved],
        )
        setSelection({ type: "project", id: saved.id })
        clearReminderSelection()
        setProjectDraft(null)
        setReminders([])
        setProjectReminderCounts((current) => ({ ...current, [saved.id]: 0 }))
      })
      .catch((error) => {
        setProjectDraft({
          title: projectDraft.title,
          saving: false,
          error: error instanceof Error ? error.message : String(error),
        })
        window.requestAnimationFrame(() => projectInputRef.current?.focus())
      })
      .finally(() => {
        projectSavingRef.current = false
      })
  }, [clearReminderSelection, projectDraft])

  const commitProjectRename = React.useCallback(() => {
    if (!projectEdit || projectEdit.saving) return
    const title = projectEdit.title.trim()
    if (!title) {
      setProjectEdit((current) =>
        current ? { ...current, error: "Enter a project name." } : current,
      )
      projectEditInputRef.current?.focus()
      return
    }
    setProjectEdit((current) =>
      current ? { ...current, saving: true, error: null } : current,
    )
    void remindersApi
      .updateProject({ id: projectEdit.id, title })
      .then((saved) => {
        setProjects((current) =>
          current.map((project) => (project.id === saved.id ? saved : project)),
        )
        setProjectEdit(null)
      })
      .catch((error) => {
        setProjectEdit((current) =>
          current
            ? {
                ...current,
                saving: false,
                error: error instanceof Error ? error.message : String(error),
              }
            : current,
        )
        window.requestAnimationFrame(() => projectEditInputRef.current?.focus())
      })
  }, [projectEdit])

  const deleteProject = React.useCallback(
    (project: ReminderProject) => {
      if (
        !window.confirm(
          `Delete “${project.title}”? Its reminders will remain available without a project.`,
        )
      )
        return
      void remindersApi.deleteProject(project.id).then((deleted) => {
        if (!deleted) return
        setProjects((current) => current.filter((item) => item.id !== project.id))
        setProjectReminderCounts((current) => {
          const next = { ...current }
          delete next[project.id]
          return next
        })
        if (selectionRef.current.type === "project" && selectionRef.current.id === project.id) {
          setSelection({ type: "view", id: "all" })
          clearReminderSelection()
        }
        void sync()
      })
    },
    [clearReminderSelection, sync],
  )

  const moveProject = React.useCallback(
    (projectId: string, targetIndex: number) => {
      const previous = projects
      const sourceIndex = previous.findIndex((project) => project.id === projectId)
      const boundedIndex = Math.max(0, Math.min(previous.length - 1, targetIndex))
      if (sourceIndex < 0 || sourceIndex === boundedIndex) return
      const next = [...previous]
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(boundedIndex, 0, moved)
      setProjects(next)
      void remindersApi
        .reorderProjects(next.map((project) => project.id))
        .then(setProjects)
        .catch(() => setProjects(previous))
    },
    [projects],
  )

  const selectReminder = React.useCallback(
    (id: string, extend: boolean, toggle: boolean) => {
      if (toggle) {
        const nextIds = new Set(selectedIds)
        if (nextIds.has(id)) nextIds.delete(id)
        else nextIds.add(id)
        const nextFocusId = nextIds.has(id)
          ? id
          : selectedId && nextIds.has(selectedId)
            ? selectedId
            : ([...nextIds].at(-1) ?? null)
        setSelectedId(nextFocusId)
        setSelectedIds(nextIds)
        selectionAnchorRef.current = nextFocusId
        return
      }
      if (!extend) {
        setSelectedId(id)
        setSelectedIds(new Set())
        selectionAnchorRef.current = id
        return
      }
      const anchorId =
        selectionAnchorRef.current &&
        visibleReminderIds.includes(selectionAnchorRef.current)
          ? selectionAnchorRef.current
          : selectedId && visibleReminderIds.includes(selectedId)
            ? selectedId
            : id
      const next = reminderRangeSelection(visibleReminderIds, anchorId, id)
      setSelectedId(next.focusId)
      setSelectedIds(next.selectedIds)
      selectionAnchorRef.current = next.anchorId
    },
    [selectedId, selectedIds, visibleReminderIds],
  )

  const applyKeyboardSelection = React.useCallback(
    (direction: -1 | 1) => {
      const next = extendReminderSelection(
        visibleReminderIds,
        selectionAnchorRef.current,
        selectedId,
        direction,
      )
      if (!next) return
      setSelectedId(next.focusId)
      setSelectedIds(next.selectedIds)
      selectionAnchorRef.current = next.anchorId
      window.requestAnimationFrame(() => {
        const input = reminderInputs.current.get(next.focusId)
        input?.focus({ preventScroll: true })
        input?.closest(".reminder-row-shell")?.scrollIntoView({ block: "nearest" })
      })
    },
    [selectedId, visibleReminderIds],
  )

  const selectAllVisibleReminders = React.useCallback(() => {
    const next = allReminderSelection(visibleReminderIds)
    if (!next) return
    setSelectedId(next.focusId)
    setSelectedIds(next.selectedIds)
    selectionAnchorRef.current = next.anchorId
  }, [visibleReminderIds])

  React.useEffect(() => {
    const visibleIds = new Set(visibleReminderIds)
    setSelectedIds((current) => {
      if ([...current].every((id) => visibleIds.has(id))) return current
      return new Set([...current].filter((id) => visibleIds.has(id)))
    })
    setSelectedId((current) => (current && visibleIds.has(current) ? current : null))
    if (selectionAnchorRef.current && !visibleIds.has(selectionAnchorRef.current))
      selectionAnchorRef.current = null
  }, [visibleReminderIds])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const titleEditor =
        target instanceof HTMLElement &&
        target.classList.contains("reminder-title-input")
      const editingText =
        target instanceof HTMLElement &&
        target.matches("input, textarea, [contenteditable='true']") &&
        !titleEditor
      if (
        event.key.toLocaleLowerCase() === "a" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        !editingText
      ) {
        if (visibleReminderIds.length === 0) return
        event.preventDefault()
        selectAllVisibleReminders()
        return
      }
      if (
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !editingText
      ) {
        event.preventDefault()
        applyKeyboardSelection(event.key === "ArrowDown" ? 1 : -1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [applyKeyboardSelection, selectAllVisibleReminders, visibleReminderIds.length])

  return (
    <ApplicationSidebarLayout
      className="reminders-app"
      accentColor="#3b82f6"
      sidebarWidth={230}
    >
      <ApplicationSidebar
        className="reminders-application-sidebar"
      >
          <ApplicationSidebarNav
            className="reminders-smart-grid"
            aria-label="Smart lists"
          >
            {smartViews.map((item) => {
              const count =
                item.id === "today"
                  ? (applicationBadgeCount ?? 0)
                  : item.id === "scheduled"
                    ? scheduledReminderCount
                    : null
              return (
                <ApplicationSidebarItem
                  key={item.id}
                  className={`reminders-smart-view reminders-smart-view-${item.id}`}
                  active={selection.type === "view" && selection.id === item.id}
                  icon={
                    item.id === "today" ? (
                      <span className="reminders-today-calendar" aria-hidden="true">
                        {new Date().getDate()}
                      </span>
                    ) : (
                      item.icon
                    )
                  }
                  label={item.label}
                  badge={count}
                  aria-label={
                    count === null
                      ? item.label
                      : `${item.label}, ${count} ${count === 1 ? "reminder" : "reminders"}`
                  }
                  onClick={() => {
                    setSelection({ type: "view", id: item.id })
                    clearReminderSelection()
                  }}
                />
              )
            })}
          </ApplicationSidebarNav>
          <ApplicationSidebarNav aria-label="Planning">
            <ApplicationSidebarItem
              className="reminders-day-plan-item"
              active={selection.type === "day-plan"}
              icon={<Network />}
              label="Day Plan"
              onClick={() => {
                setSelection({ type: "day-plan", id: "today" })
                clearReminderSelection()
              }}
            />
          </ApplicationSidebarNav>
          <ApplicationSidebarSection
            label="Projects"
            action={
              <button
                type="button"
                className="reminders-project-add"
                aria-label="Create project"
                disabled={projectDraft?.saving}
                onClick={() => {
                  setProjectDraft({ title: "", saving: false, error: null })
                  window.requestAnimationFrame(() => projectInputRef.current?.focus())
                }}
              >
                <Plus />
              </button>
            }
          >
          {projectDraft && (
            <form
              className="reminders-project-form"
              onSubmit={(event) => {
                event.preventDefault()
                createProject()
              }}
            >
              <Input
                ref={projectInputRef}
                value={projectDraft.title}
                placeholder="Project name"
                aria-label="Project name"
                aria-invalid={Boolean(projectDraft.error) || undefined}
                disabled={projectDraft.saving}
                onChange={(event) => {
                  const title = event.currentTarget.value
                  setProjectDraft((current) =>
                    current ? { ...current, title, error: null } : current,
                  )
                }}
                onBlur={() => {
                  if (!projectSavingRef.current) setProjectDraft(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !projectSavingRef.current) {
                    event.preventDefault()
                    setProjectDraft(null)
                  }
                }}
              />
              {projectDraft.error && (
                <small className="reminder-inline-error" role="alert">
                  {projectDraft.error}
                </small>
              )}
            </form>
          )}
          <nav className="reminders-project-list" aria-label="Projects">
            {projects.map((project, index) => {
              const count = projectReminderCounts[project.id] ?? 0
              if (projectEdit?.id === project.id)
                return (
                  <form
                    key={project.id}
                    className="reminders-project-form reminders-project-rename"
                    onSubmit={(event) => {
                      event.preventDefault()
                      commitProjectRename()
                    }}
                  >
                    <Input
                      ref={projectEditInputRef}
                      value={projectEdit.title}
                      aria-label={`Rename ${project.title}`}
                      aria-invalid={Boolean(projectEdit.error) || undefined}
                      disabled={projectEdit.saving}
                      onChange={(event) => {
                        const title = event.currentTarget.value
                        setProjectEdit((current) =>
                          current ? { ...current, title, error: null } : current,
                        )
                      }}
                      onBlur={() => commitProjectRename()}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !projectEdit.saving) {
                          event.preventDefault()
                          setProjectEdit(null)
                        }
                      }}
                    />
                    {projectEdit.error && (
                      <small className="reminder-inline-error" role="alert">
                        {projectEdit.error}
                      </small>
                    )}
                  </form>
                )
              return (
                <DraggableProjectItem
                  key={project.id}
                  project={project}
                  index={index}
                  count={count}
                  active={selection.type === "project" && selection.id === project.id}
                  onSelect={() => {
                    setSelection({ type: "project", id: project.id })
                    clearReminderSelection()
                  }}
                  onRename={() => {
                    setProjectEdit({
                      id: project.id,
                      title: project.title,
                      saving: false,
                      error: null,
                    })
                    window.requestAnimationFrame(() => {
                      projectEditInputRef.current?.focus()
                      projectEditInputRef.current?.select()
                    })
                  }}
                  onDelete={() => deleteProject(project)}
                  onMove={(targetIndex) => moveProject(project.id, targetIndex)}
                />
              )
            })}
          </nav>
          </ApplicationSidebarSection>
      </ApplicationSidebar>
      <ApplicationSidebarContent className="reminders-main">
        {selection.type === "day-plan" ? (
          <DayPlan projects={projects} onRemindersChanged={() => void sync()} />
        ) : (
          <>
          <header>
            <h1>{title}</h1>
            {searchVisible && (
              <label className="reminders-page-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Search reminders</span>
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  placeholder="Search reminders"
                  aria-label="Search reminders"
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    setSearchQuery("")
                    setSearchVisible(false)
                  }}
                />
              </label>
            )}
          </header>
          <section
            className="reminders-list"
            aria-busy={loading}
            aria-keyshortcuts="Meta+A Control+A Shift+ArrowUp Shift+ArrowDown"
            onClick={(event) => {
              const target = event.target
              if (!(target instanceof HTMLElement)) return
              if (
                target.closest(
                  ".reminder-row, button, input, textarea, [contenteditable='true']",
                )
              )
                return
              clearReminderSelection()
              setSelectedImageId(null)
            }}
          >
            {imageError && (
              <small className="reminder-image-error" role="alert">
                {imageError}
              </small>
            )}
            {draftsAfter(null).map(renderDraft)}
            {!loading && visibleReminders.length === 0 && drafts.length === 0 && (
              <p className="reminders-empty">
                {normalizedSearch ? "No matching reminders" : "No reminders"}
              </p>
            )}
            {visibleReminders.map((reminder) => {
              const completionPhase = completionPhases[reminder.id]
              const selectionEdges = reminderSelectionEdges(
                visibleReminderIds,
                selectedIds,
                reminder.id,
              )
              return (
                <React.Fragment key={reminder.id}>
                  <div
                    className="reminder-row-shell"
                    data-exiting={completionPhase === "exiting" || undefined}
                    aria-hidden={completionPhase === "exiting" || undefined}
                    inert={completionPhase === "exiting" || undefined}
                  >
                    <div className="reminder-row-shell-inner">
                      <ReminderRow
                        reminder={reminder}
                        projects={projects}
                        selected={selectionEdges.selected}
                        focused={selectedId === reminder.id}
                        selectionStart={selectionEdges.start}
                        selectionEnd={selectionEdges.end}
                        completionPhase={completionPhase}
                        deletedView={
                          selection.type === "view" && selection.id === "deleted"
                        }
                        hideProjectBadge={selection.type === "project"}
                        dragEnabled={selection.type === "project" && !normalizedSearch}
                        images={images.filter(
                          (image) => image.reminderId === reminder.id,
                        )}
                        selectedImageId={selectedImageId}
                        onPasteImages={(items) => importImages(reminder.id, items)}
                        onSelectImage={selectImage}
                        inputRef={(node) => {
                          if (node) reminderInputs.current.set(reminder.id, node)
                          else reminderInputs.current.delete(reminder.id)
                        }}
                        onDragStart={() => setDraggedId(reminder.id)}
                        onDrop={() => {
                          if (
                            selection.type !== "project" ||
                            !draggedId ||
                            draggedId === reminder.id
                          )
                            return
                          const next = [...reminders]
                          const source = next.findIndex((item) => item.id === draggedId)
                          const target = next.findIndex(
                            (item) => item.id === reminder.id,
                          )
                          if (source < 0 || target < 0) return
                          const [moved] = next.splice(source, 1)
                          next.splice(target, 0, moved)
                          setReminders(next)
                          setDraggedId(null)
                          void remindersApi
                            .reorder(
                              defaultReminderListId,
                              next.map((item) => item.id),
                            )
                            .then((items) =>
                              setReminders(
                                items.filter((item) => item.projectId === selection.id),
                              ),
                            )
                        }}
                        onSelect={(extend, toggle) => {
                          setSelectedImageId(null)
                          selectReminder(reminder.id, extend, toggle)
                        }}
                        onSave={saveReminder}
                        onCreateAfter={() => addDraft(reminder.id)}
                        onComplete={(completed) =>
                          setReminderCompleted(reminder, completed)
                        }
                        onDelete={() =>
                          void remindersApi.remove(reminder.id).then(refresh)
                        }
                        onRestore={() =>
                          void remindersApi.restore(reminder.id).then(refresh)
                        }
                        onPermanentlyDelete={() =>
                          void remindersApi
                            .permanentlyDelete(reminder.id)
                            .then(async (deleted) => {
                              if (deleted)
                                await reminderImages.deleteForReminder(reminder.id)
                              await refresh()
                            })
                        }
                      />
                    </div>
                  </div>
                  {draftsAfter(reminder.id).map(renderDraft)}
                </React.Fragment>
              )
            })}
          </section>
          </>
        )}
      </ApplicationSidebarContent>
    </ApplicationSidebarLayout>
  )
}
