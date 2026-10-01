import { CanvasObject, type CanvasObjectInit } from "../../../../../../../packages/canvas/src/core/model/object.ts"
import type { WorkflowPluginNode as PluginNodeShape } from "@productivity-os/workflow-plugin-sdk"

export const MIN_TIMER_DURATION_MS = 10_000
export const MAX_TIMER_DURATION_MS = 24 * 60 * 60_000

export type WorkflowNodeKind = "terminator" | "task" | "timer" | "trigger" | "milestone" | "link" | "plugin"
export type WorkflowTimerStatus = "idle" | "running" | "paused" | "completed"
export type WorkflowSubtask = { id: string; name: string; completed: boolean }
export type WorkflowTriggerType = "manual" | "time" | "revise-completed" | "quran-completed"

export interface WorkflowNodeInit extends CanvasObjectInit {
  nodeKind: WorkflowNodeKind | "start"
  name?: string
  description?: string
  note?: string
}

export abstract class WorkflowNodeBase extends CanvasObject {
  readonly type = "workflow-node" as const
  abstract nodeKind: WorkflowNodeKind
  name: string
  description: string

  protected constructor(init: WorkflowNodeInit) {
    super({
      ...init,
      capabilities: {
        rotatable: false,
        movable: true,
        resizable: true,
        deletable: true,
        copyable: true,
        connectable: true,
        showConnectionHandles: true,
        ...init.capabilities,
      },
    })
    this.name = init.name?.trim() || "Untitled"
    this.description = init.description ?? init.note ?? ""
  }
}

export interface WorkflowTerminatorInit extends Omit<WorkflowNodeInit, "nodeKind"> {
  nodeKind?: "terminator" | "start"
  role?: "Start" | "End"
  resetSchedule?: { kind: "manual" | "interval"; everyHours?: number; lastResetAt?: number | null }
}

export class WorkflowTerminatorNode extends WorkflowNodeBase {
  nodeKind = "terminator" as const
  role: "Start" | "End"
  resetSchedule: NonNullable<WorkflowTerminatorInit["resetSchedule"]>

  constructor(init: WorkflowTerminatorInit) {
    super({ ...init, nodeKind: "terminator", width: init.width || 72, height: init.height || 72 })
    this.role = init.role ?? "Start"
    this.resetSchedule = {
      kind: init.resetSchedule?.kind ?? "manual",
      everyHours: init.resetSchedule?.everyHours,
      lastResetAt: init.resetSchedule?.lastResetAt ?? null,
    }
  }
}

export interface WorkflowTaskInit extends Omit<WorkflowNodeInit, "nodeKind"> {
  nodeKind?: "task"
  completed?: boolean
  subtasks?: WorkflowSubtask[]
  notes?: string
  priority?: "none" | "low" | "medium" | "high"
  projectId?: string | null
  reminderId?: string | null
}

export class WorkflowTaskNode extends WorkflowNodeBase {
  nodeKind = "task" as const
  completed: boolean
  subtasks: WorkflowSubtask[]
  notes: string
  priority: "none" | "low" | "medium" | "high"
  projectId: string | null
  reminderId: string | null

  constructor(init: WorkflowTaskInit) {
    const subtasks = (init.subtasks ?? []).map((item) => ({ ...item }))
    const minimumHeight = 44 + subtasks.length * 28
    super({ ...init, nodeKind: "task", width: init.width || 250, height: Math.max(init.height || 64, minimumHeight) })
    this.subtasks = subtasks
    this.completed = subtasks.length > 0 ? subtasks.every((item) => item.completed) : Boolean(init.completed)
    this.notes = init.notes ?? init.description ?? init.note ?? ""
    this.priority = init.priority ?? "none"
    this.projectId = init.projectId ?? null
    this.reminderId = init.reminderId ?? null
  }
}

export interface WorkflowTimerInit extends Omit<WorkflowNodeInit, "nodeKind"> {
  nodeKind?: "timer"
  durationMs?: number
  elapsedMs?: number
  startedAt?: number | null
  timerStatus?: WorkflowTimerStatus
}

export class WorkflowTimerNode extends WorkflowNodeBase {
  nodeKind = "timer" as const
  durationMs: number
  elapsedMs: number
  startedAt: number | null
  timerStatus: WorkflowTimerStatus

  constructor(init: WorkflowTimerInit) {
    super({ ...init, nodeKind: "timer", width: init.width || 260, height: Math.max(64, init.height || 72) })
    this.durationMs = Math.min(MAX_TIMER_DURATION_MS, Math.max(MIN_TIMER_DURATION_MS, init.durationMs ?? 25 * 60_000))
    this.elapsedMs = Math.min(this.durationMs, Math.max(0, init.elapsedMs ?? 0))
    this.startedAt = init.startedAt ?? null
    this.timerStatus = init.timerStatus ?? (this.elapsedMs >= this.durationMs ? "completed" : "idle")
  }
}

export interface WorkflowTriggerInit extends Omit<WorkflowNodeInit, "nodeKind"> {
  nodeKind?: "trigger"
  triggerType?: WorkflowTriggerType
  time?: string | null
  weekdays?: number[]
  firedAt?: number | null
  lastFiredDate?: string | null
}

export class WorkflowTriggerNode extends WorkflowNodeBase {
  nodeKind = "trigger" as const
  triggerType: WorkflowTriggerType
  time: string | null
  weekdays: number[]
  firedAt: number | null
  lastFiredDate: string | null

  constructor(init: WorkflowTriggerInit) {
    super({ ...init, nodeKind: "trigger", width: init.width || 220, height: Math.max(64, init.height || 72) })
    this.triggerType = init.triggerType ?? "manual"
    this.time = init.time ?? null
    this.weekdays = [...new Set(init.weekdays ?? [0, 1, 2, 3, 4, 5, 6])].filter((day) => day >= 0 && day <= 6)
    this.firedAt = init.firedAt ?? null
    this.lastFiredDate = init.lastFiredDate ?? null
  }
}

export class WorkflowMilestoneNode extends WorkflowNodeBase {
  nodeKind = "milestone" as const
  status: "blocked" | "ready" | "completed"
  constructor(init: Omit<WorkflowNodeInit, "nodeKind"> & { status?: "blocked" | "ready" | "completed" }) {
    super({ ...init, nodeKind: "milestone" })
    this.status = init.status ?? "blocked"
  }
}

export class WorkflowLinkNode extends WorkflowNodeBase {
  nodeKind = "link" as const
  targetCanvasId: string | null
  targetCanvasTitle: string
  constructor(init: Omit<WorkflowNodeInit, "nodeKind"> & { targetCanvasId?: string | null; targetCanvasTitle?: string }) {
    super({ ...init, nodeKind: "link" })
    this.targetCanvasId = init.targetCanvasId ?? null
    this.targetCanvasTitle = init.targetCanvasTitle ?? ""
  }
}

export class WorkflowPluginNode<TData extends Record<string, unknown> = Record<string, unknown>>
  extends WorkflowNodeBase implements PluginNodeShape<TData> {
  nodeKind = "plugin" as const
  pluginId: string
  pluginNodeType: string
  pluginVersion: number
  pluginData: TData
  completed: boolean

  constructor(init: Omit<WorkflowNodeInit, "nodeKind"> & Partial<PluginNodeShape<TData>> & { pluginId: string; pluginNodeType: string }) {
    super({ ...init, nodeKind: "plugin" })
    this.pluginId = init.pluginId
    this.pluginNodeType = init.pluginNodeType
    this.pluginVersion = init.pluginVersion ?? 1
    this.pluginData = structuredClone(init.pluginData ?? ({} as TData))
    this.completed = Boolean(init.completed)
  }
}

export type WorkflowNode = WorkflowTerminatorNode | WorkflowTaskNode | WorkflowTimerNode | WorkflowTriggerNode | WorkflowMilestoneNode | WorkflowLinkNode | WorkflowPluginNode

export function hydrateWorkflowNode(raw: CanvasObject): WorkflowNode {
  const init = raw as unknown as WorkflowNodeInit & Record<string, unknown>
  switch (init.nodeKind) {
    case "start":
    case "terminator": return new WorkflowTerminatorNode(init as unknown as WorkflowTerminatorInit)
    case "task": return new WorkflowTaskNode(init as unknown as WorkflowTaskInit)
    case "timer": return new WorkflowTimerNode(init as unknown as WorkflowTimerInit)
    case "trigger": return new WorkflowTriggerNode(init as unknown as WorkflowTriggerInit)
    case "milestone": return new WorkflowMilestoneNode(init as never)
    case "link": return new WorkflowLinkNode(init as never)
    case "plugin": return new WorkflowPluginNode(init as never)
    default: return new WorkflowTaskNode({ ...(init as unknown as WorkflowTaskInit), name: init.name as string || "Task" })
  }
}
