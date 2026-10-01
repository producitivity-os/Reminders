import type { CanvasObject } from "@productivity-os/canvas/core"
import type { WorkflowNode } from "./model.ts"
import { workflowCompletionUpdates, workflowNodeCanExecute, type WorkflowObjectUpdate } from "./progression.ts"

export class WorkflowNodeActivation {
  private readonly objects: () => readonly CanvasObject[]
  private readonly update: (updates: readonly WorkflowObjectUpdate[]) => number

  constructor(
    objects: () => readonly CanvasObject[],
    update: (updates: readonly WorkflowObjectUpdate[]) => number,
  ) {
    this.objects = objects
    this.update = update
  }

  activate(node: WorkflowNode): boolean {
    if (node.nodeKind !== "task" || node.subtasks.length > 0 || node.completed) return false
    const objects = this.objects()
    if (!workflowNodeCanExecute(objects, node.id)) return false
    return this.update(workflowCompletionUpdates(objects, node.id, { completed: true } as never)) > 0
  }
}
