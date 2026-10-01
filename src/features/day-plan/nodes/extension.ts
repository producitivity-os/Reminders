import type { CanvasObjectExtension } from "@productivity-os/canvas/core"
import { workflowTaskLayout } from "./layout.ts"
import { hydrateWorkflowNode, WorkflowPluginNode, WorkflowTaskNode, WorkflowTerminatorNode, WorkflowTimerNode, WorkflowTriggerNode, type WorkflowNode } from "./model.ts"
import { activateWorkflowPluginGesture, activateWorkflowPluginInteraction, workflowPluginInteractionRegions } from "./plugin-bridge.ts"
import { applyWorkflowUpdates, workflowNodeCanExecute } from "./progression.ts"
import { resetWorkflowUpdates, workflowCanReset, workflowObjects } from "./reset.ts"
import { toggleTimerUpdates } from "./timer-lifecycle.ts"
import { WorkflowNodeRenderer } from "./renderer.ts"

export function createWorkflowNodeExtension(renderer = new WorkflowNodeRenderer()): CanvasObjectExtension<WorkflowNode> {
  return {
    type: "workflow-node",
    hydrate: hydrateWorkflowNode,
    createRenderer: () => renderer,
    permanentConnectionHandles: true,
    selectionGeometry(node) {
      if (node.nodeKind === "terminator")
        return node.role === "Start"
          ? { shape: "ellipse", strokeWidth: 1.5, strokeColor: 0x60a5fa }
          : { shape: "rectangle", radius: 28, strokeWidth: 1.5, strokeColor: 0x60a5fa }
      return { shape: "rectangle", radius: 20, strokeWidth: 1.5, strokeColor: 0x60a5fa }
    },
    connectionHandles(node) {
      if (node.nodeKind === "terminator")
        return node.role === "Start"
          ? [{ hint: "right", anchor: { x: 1, y: 0.5 }, direction: "output", shape: "rounded-rectangle" }]
          : [{ hint: "left", anchor: { x: 0, y: 0.5 }, direction: "input", shape: "rounded-rectangle" }]
      if (node.nodeKind === "trigger")
        return [{ hint: "right", anchor: { x: 1, y: 0.5 }, direction: "output", shape: "rounded-rectangle" }]
      return [
        { hint: "left", anchor: { x: 0, y: 0.5 }, direction: "input", shape: "rounded-rectangle" },
        { hint: "right", anchor: { x: 1, y: 0.5 }, direction: "output", shape: "rounded-rectangle" },
      ]
    },
    minimumSize(node) {
      if (node instanceof WorkflowTaskNode) return { width: 120, height: workflowTaskLayout.minimumHeightFor(node.subtasks.length) }
      if (node instanceof WorkflowTimerNode) return { width: 200, height: 64 }
      return { width: 120, height: 64 }
    },
    pointerInteractionRegions(node) {
      if (node instanceof WorkflowTaskNode) {
        if (!node.subtasks.length) return [{ id: "task:toggle", bounds: { x: 10, y: node.height / 2 - 14, width: 32, height: 28 }, cursor: "pointer" }]
        return [
          { id: "task:add-subtask", bounds: workflowTaskLayout.addBounds(node.width, true), cursor: "pointer" },
          { id: "task:toggle-subtasks", bounds: workflowTaskLayout.collapseBounds(node.width), cursor: "pointer" },
          ...node.subtasks.map((subtask, index) => ({ id: `subtask:${subtask.id}`, bounds: workflowTaskLayout.checkboxBounds(index), cursor: "pointer" })),
        ]
      }
      if (node instanceof WorkflowTimerNode) return [{ id: "timer:toggle", bounds: { x: 8, y: node.height / 2 - 20, width: 40, height: 40 }, cursor: "pointer" }]
      if (node instanceof WorkflowTerminatorNode && node.role === "Start")
        return workflowCanReset(workflowObjects(), node.id)
          ? [{ id: "terminator:reset", bounds: { x: 0, y: 0, width: node.width, height: node.height }, cursor: "pointer" }]
          : []
      if (node instanceof WorkflowTriggerNode) return [{ id: "trigger:fire", bounds: { x: 8, y: node.height / 2 - 20, width: 40, height: 40 }, cursor: "pointer" }]
      if (node instanceof WorkflowPluginNode) return workflowPluginInteractionRegions(node)
      return []
    },
    onPointerInteraction(node, regionId, objects) {
      if (node instanceof WorkflowTaskNode) {
        if (regionId !== "task:add-subtask" && !workflowNodeCanExecute(objects, node.id)) return false
        if (regionId === "task:toggle" && node.subtasks.length === 0) {
          node.completed = !node.completed
          return true
        }
        if (regionId.startsWith("subtask:")) {
          const subtask = node.subtasks.find((item) => item.id === regionId.slice(8))
          if (!subtask) return false
          subtask.completed = !subtask.completed
          node.completed = node.subtasks.length > 0 && node.subtasks.every((item) => item.completed)
          return true
        }
        if (regionId === "task:add-subtask") {
          node.subtasks.push({ id: crypto.randomUUID(), name: "New subtask", completed: false })
          workflowTaskLayout.fit(node)
          node.completed = false
          return true
        }
      }
      if (node instanceof WorkflowTimerNode && regionId === "timer:toggle")
        return applyWorkflowUpdates(objects, toggleTimerUpdates(objects, node.id)) > 0
      if (node instanceof WorkflowTerminatorNode && regionId === "terminator:reset")
        return applyWorkflowUpdates(objects, resetWorkflowUpdates(objects, node.id)) > 0
      if (node instanceof WorkflowTriggerNode && regionId === "trigger:fire") {
        node.firedAt = Date.now()
        return true
      }
      if (node instanceof WorkflowPluginNode) return activateWorkflowPluginInteraction(node, regionId, objects)
      return false
    },
    onPointerGesture(node, regionId, gesture, objects) {
      return node instanceof WorkflowPluginNode
        ? activateWorkflowPluginGesture(node, regionId, gesture, objects)
        : false
    },
  }
}

export const workflowNodeExtension = createWorkflowNodeExtension()
