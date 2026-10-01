import type { ArrowObject } from "../../../../../../../packages/canvas/src/core/model/arrow/arrow.ts"
import type { CanvasObject } from "../../../../../../../packages/canvas/src/core/model/object.ts"
import type { WorkflowNode } from "./model.ts"

export type WorkflowObjectUpdate = { objectId: string; patch: Partial<CanvasObject> }

export const isWorkflowNode = (object: CanvasObject): object is WorkflowNode => object.type === "workflow-node"

function edges(objects: readonly CanvasObject[]) {
  return objects.filter((object): object is ArrowObject => object.type === "arrow")
    .flatMap((arrow) => {
      const from = arrow.start.binding?.objectId
      const to = arrow.end.binding?.objectId
      return from && to ? [{ from, to }] : []
    })
}

export function workflowNodeCompleted(node: WorkflowNode): boolean {
  if (node.nodeKind === "task" || node.nodeKind === "plugin") return node.completed
  if (node.nodeKind === "timer") return node.timerStatus === "completed"
  if (node.nodeKind === "trigger") return node.firedAt !== null
  if (node.nodeKind === "milestone") return node.status === "completed"
  return node.nodeKind === "terminator" && node.role === "Start"
}

export function workflowReachableNodeIds(objects: readonly CanvasObject[]): Set<string> {
  const graph = edges(objects)
  const starts = objects.filter((object): object is WorkflowNode =>
    isWorkflowNode(object) && (
      (object.nodeKind === "terminator" && object.role === "Start") || object.nodeKind === "trigger"
    ))
  const seen = new Set(starts.map((node) => node.id))
  const queue = [...seen]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of graph) {
      if (edge.from !== current || seen.has(edge.to)) continue
      seen.add(edge.to)
      queue.push(edge.to)
    }
  }
  return seen
}

export function workflowNodeCanInteract(objects: readonly CanvasObject[], nodeId: string): boolean {
  return workflowReachableNodeIds(objects).has(nodeId)
}

export function workflowNodeCanExecute(objects: readonly CanvasObject[], nodeId: string): boolean {
  if (!workflowNodeCanInteract(objects, nodeId)) return false
  const byId = new Map(objects.filter(isWorkflowNode).map((node) => [node.id, node]))
  const incoming = edges(objects).filter((edge) => edge.to === nodeId)
  return incoming.length > 0 && incoming.every((edge) => {
    const node = byId.get(edge.from)
    return Boolean(node && workflowNodeCompleted(node))
  })
}

export function workflowEntryNodes(objects: readonly CanvasObject[]): WorkflowNode[] {
  return objects.filter((object): object is WorkflowNode =>
    isWorkflowNode(object) &&
    object.nodeKind !== "terminator" &&
    object.nodeKind !== "trigger" &&
    !workflowNodeCompleted(object) &&
    workflowNodeCanExecute(objects, object.id),
  )
}

export function nextExecutableWorkflowNodes(objects: readonly CanvasObject[], sourceId: string): WorkflowNode[] {
  const byId = new Map(objects.filter(isWorkflowNode).map((node) => [node.id, node]))
  const graph = edges(objects)
  const found: WorkflowNode[] = []
  const visited = new Set<string>([sourceId])
  const queue = [sourceId]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of graph) {
      if (edge.from !== current || visited.has(edge.to)) continue
      visited.add(edge.to)
      const node = byId.get(edge.to)
      if (!node) continue
      if (workflowNodeCompleted(node)) queue.push(node.id)
      else found.push(node)
    }
  }
  return found
}

export function workflowCompletionUpdates(
  objects: readonly CanvasObject[],
  sourceId: string,
  patch: Partial<CanvasObject>,
): WorkflowObjectUpdate[] {
  if (!objects.some((object) => object.id === sourceId && isWorkflowNode(object))) return []
  return [{ objectId: sourceId, patch }]
}

export function applyWorkflowUpdates(objects: readonly CanvasObject[], updates: readonly WorkflowObjectUpdate[]): number {
  let count = 0
  for (const update of updates) {
    const object = objects.find((candidate) => candidate.id === update.objectId)
    if (!object) continue
    Object.assign(object, update.patch)
    count += 1
  }
  return count
}

export function wouldCreateWorkflowCycle(objects: readonly CanvasObject[], fromId: string, toId: string): boolean {
  if (fromId === toId) return true
  const graph = edges(objects)
  const seen = new Set<string>()
  const queue = [toId]
  while (queue.length) {
    const current = queue.shift()!
    if (current === fromId) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of graph) if (edge.from === current) queue.push(edge.to)
  }
  return false
}
