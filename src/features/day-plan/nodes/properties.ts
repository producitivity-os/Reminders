import type { WorkflowNode } from "./model.ts"

export type WorkflowNodePropertyField = "role" | "name" | "subtasks" | "duration" | "status" | "label" | "destination" | "trigger"

export class WorkflowNodePropertySelection {
  readonly nodes: readonly WorkflowNode[]

  private constructor(nodes: readonly WorkflowNode[]) {
    this.nodes = nodes
  }

  static from(nodes: readonly WorkflowNode[]): WorkflowNodePropertySelection | null {
    if (!nodes.length || nodes.some((node) => node.nodeKind !== nodes[0].nodeKind)) return null
    return new WorkflowNodePropertySelection(nodes)
  }

  get nodeKind() { return this.nodes[0].nodeKind }

  get fields(): WorkflowNodePropertyField[] {
    switch (this.nodeKind) {
      case "terminator": return ["role", "name"]
      case "task": return ["name", "subtasks"]
      case "timer": return ["name", "duration"]
      case "trigger": return ["name", "trigger"]
      case "milestone": return ["name", "status"]
      case "link": return ["label", "destination"]
      default: return ["name"]
    }
  }

  common<T>(value: (node: WorkflowNode) => T): T | undefined {
    const first = value(this.nodes[0])
    return this.nodes.every((node) => Object.is(value(node), first)) ? first : undefined
  }

  patch(update: (id: string, patch: Partial<WorkflowNode>) => boolean, patch: Partial<WorkflowNode>): number {
    return this.nodes.reduce((count, node) => count + Number(update(node.id, patch)), 0)
  }
}
