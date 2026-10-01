import type { CanvasObject } from "@productivity-os/canvas/core"
import { WorkflowTimerNode } from "./model.ts"
import { workflowNodeCanExecute, type WorkflowObjectUpdate } from "./progression.ts"

export function timerElapsed(timer: WorkflowTimerNode, now = Date.now()): number {
  const running = timer.timerStatus === "running" && timer.startedAt !== null
    ? Math.max(0, now - timer.startedAt)
    : 0
  return Math.min(timer.durationMs, timer.elapsedMs + running)
}

export function toggleTimerUpdates(
  objects: readonly CanvasObject[],
  timerId: string,
  now = Date.now(),
): WorkflowObjectUpdate[] {
  const timer = objects.find((object): object is WorkflowTimerNode =>
    object.id === timerId && object.type === "workflow-node" && (object as WorkflowTimerNode).nodeKind === "timer",
  )
  if (!timer || !workflowNodeCanExecute(objects, timerId) || timer.timerStatus === "completed") return []
  if (timer.timerStatus === "running") {
    return [{ objectId: timer.id, patch: { elapsedMs: timerElapsed(timer, now), startedAt: null, timerStatus: "paused" } as never }]
  }
  const updates: WorkflowObjectUpdate[] = objects
    .filter((object): object is WorkflowTimerNode =>
      object.type === "workflow-node" && (object as WorkflowTimerNode).nodeKind === "timer" &&
      (object as WorkflowTimerNode).timerStatus === "running" && object.id !== timer.id,
    )
    .map((other) => ({
      objectId: other.id,
      patch: { elapsedMs: timerElapsed(other, now), startedAt: null, timerStatus: "paused" } as never,
    }))
  updates.push({ objectId: timer.id, patch: { startedAt: now, timerStatus: "running" } as never })
  return updates
}

export function expiredTimerUpdates(objects: readonly CanvasObject[], now = Date.now()): WorkflowObjectUpdate[] {
  return objects
    .filter((object): object is WorkflowTimerNode =>
      object.type === "workflow-node" && (object as WorkflowTimerNode).nodeKind === "timer" &&
      (object as WorkflowTimerNode).timerStatus === "running" && timerElapsed(object as WorkflowTimerNode, now) >= (object as WorkflowTimerNode).durationMs,
    )
    .map((timer) => ({
      objectId: timer.id,
      patch: { elapsedMs: timer.durationMs, startedAt: null, timerStatus: "completed" } as never,
    }))
}

export function normalizeTimerUpdates(objects: readonly CanvasObject[], now = Date.now()): WorkflowObjectUpdate[] {
  const running = objects
    .filter((object): object is WorkflowTimerNode =>
      object.type === "workflow-node" && (object as WorkflowTimerNode).nodeKind === "timer" &&
      (object as WorkflowTimerNode).timerStatus === "running",
    )
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  return running.slice(1).map((timer) => ({
    objectId: timer.id,
    patch: { elapsedMs: timerElapsed(timer, now), startedAt: null, timerStatus: "paused" } as never,
  }))
}
