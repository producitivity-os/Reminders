import type { CanvasObject } from "@productivity-os/canvas/core"
import { WorkflowPluginNode, WorkflowTaskNode, WorkflowTerminatorNode, WorkflowTimerNode, WorkflowTriggerNode } from "./model.ts"
import type { WorkflowObjectUpdate } from "./progression.ts"

let objectsProvider: (() => readonly CanvasObject[]) | null = null
let pluginResetter: ((pluginId: string, nodeType: string, data: Record<string, unknown>) => Record<string, unknown>) | null = null

export const setWorkflowObjectsProvider = (provider: typeof objectsProvider) => { objectsProvider = provider }
export const workflowObjects = () => objectsProvider?.() ?? []
export const setWorkflowPluginResetter = (resetter: typeof pluginResetter) => { pluginResetter = resetter }

export function workflowResetIsDue(schedule: WorkflowTerminatorNode["resetSchedule"], now: number): boolean {
  if (schedule.kind !== "interval" || !schedule.everyHours) return false
  return now - (schedule.lastResetAt ?? 0) >= schedule.everyHours * 60 * 60_000
}

export function workflowCanReset(objects: readonly CanvasObject[], startId: string): boolean {
  return objects.some((object) => {
    if (object.id === startId || object.type !== "workflow-node") return false
    if (object instanceof WorkflowTaskNode) return object.completed
    if (object instanceof WorkflowTimerNode) return object.timerStatus !== "idle" || object.elapsedMs > 0
    if (object instanceof WorkflowTriggerNode) return object.firedAt !== null
    if (object instanceof WorkflowPluginNode) return object.completed
    return false
  })
}

export function resetWorkflowUpdates(objects: readonly CanvasObject[], startId: string, now = Date.now()): WorkflowObjectUpdate[] {
  const updates: WorkflowObjectUpdate[] = []
  for (const object of objects) {
    if (object.id === startId && object instanceof WorkflowTerminatorNode) {
      updates.push({ objectId: object.id, patch: { resetSchedule: { ...object.resetSchedule, lastResetAt: now } } as never })
    } else if (object instanceof WorkflowTaskNode) {
      updates.push({ objectId: object.id, patch: { completed: false, subtasks: object.subtasks.map((item) => ({ ...item, completed: false })), reminderId: null } as never })
    } else if (object instanceof WorkflowTimerNode) {
      updates.push({ objectId: object.id, patch: { elapsedMs: 0, startedAt: null, timerStatus: "idle" } as never })
    } else if (object instanceof WorkflowTriggerNode) {
      updates.push({ objectId: object.id, patch: { firedAt: null } as never })
    } else if (object instanceof WorkflowPluginNode) {
      updates.push({ objectId: object.id, patch: { completed: false, pluginData: pluginResetter?.(object.pluginId, object.pluginNodeType, object.pluginData) ?? object.pluginData } as never })
    }
  }
  return updates
}

export function dueWorkflowResetUpdates(objects: readonly CanvasObject[], now = Date.now()): WorkflowObjectUpdate[] {
  const start = objects.find((object): object is WorkflowTerminatorNode => object instanceof WorkflowTerminatorNode && object.role === "Start" && workflowResetIsDue(object.resetSchedule, now))
  return start ? resetWorkflowUpdates(objects, start.id, now) : []
}
