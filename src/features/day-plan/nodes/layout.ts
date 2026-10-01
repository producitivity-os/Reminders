import type { WorkflowTaskNode } from "./model.ts"

export class WorkflowTaskLayout {
  readonly headerHeight = 44
  readonly rowHeight = 28
  readonly addHeight = 28

  minimumHeightFor(subtaskCount: number): number {
    return subtaskCount > 0 ? this.headerHeight + subtaskCount * this.rowHeight : 64
  }

  checkboxBounds(index: number) {
    return { x: 14, y: this.headerHeight + index * this.rowHeight + 6, width: 16, height: 16 }
  }

  collapseBounds(width: number) {
    return { x: width - 34, y: 10, width: 24, height: 24 }
  }

  addBounds(width: number, hasSubtasks: boolean) {
    return { x: 0, y: 0, width, height: hasSubtasks ? 0 : this.addHeight }
  }

  fit(task: WorkflowTaskNode): void {
    task.height = Math.max(task.height, this.minimumHeightFor(task.subtasks.length))
  }
}

export const workflowTaskLayout = new WorkflowTaskLayout()
