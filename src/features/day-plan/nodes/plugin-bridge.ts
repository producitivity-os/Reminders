import type { CanvasObject, CanvasObjectPointerGesture } from "@productivity-os/canvas/core"
import type { CanvasObjectPointerInteractionRegion } from "@productivity-os/workflow-plugin-sdk"
import type { WorkflowPluginNode } from "./model.ts"
import { workflowNodeCanExecute } from "./progression.ts"

export type WorkflowPluginActionHandler = (node: WorkflowPluginNode, regionId: string) => void
let handler: WorkflowPluginActionHandler | null = null
let gestureHandler: ((node: WorkflowPluginNode, regionId: string, gesture: CanvasObjectPointerGesture) => boolean) | null = null
let regions: ((node: WorkflowPluginNode) => readonly CanvasObjectPointerInteractionRegion[]) | null = null

export function setWorkflowPluginActionHandler(next: WorkflowPluginActionHandler | null) {
  handler = next
}

export function setWorkflowPluginGestureHandler(next: typeof gestureHandler) {
  gestureHandler = next
}

export function setWorkflowPluginRegionProvider(
  next: ((node: WorkflowPluginNode) => readonly CanvasObjectPointerInteractionRegion[]) | null,
) {
  regions = next
}

export function workflowPluginInteractionRegions(node: WorkflowPluginNode) {
  return regions?.(node) ?? []
}

export function activateWorkflowPluginInteraction(
  node: WorkflowPluginNode,
  regionId: string,
  objects: readonly CanvasObject[],
): boolean {
  if (!handler || !workflowNodeCanExecute(objects, node.id)) return false
  handler(node, regionId)
  return true
}


export function activateWorkflowPluginGesture(
  node: WorkflowPluginNode,
  regionId: string,
  gesture: CanvasObjectPointerGesture,
  objects: readonly CanvasObject[],
): boolean {
  if (!gestureHandler || !workflowNodeCanExecute(objects, node.id)) return false
  return gestureHandler(node, regionId, gesture)
}
