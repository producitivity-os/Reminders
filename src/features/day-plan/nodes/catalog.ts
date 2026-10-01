import type { LucideIcon } from "@productivity-os/shared-ui/components/sf-symbols"
import type { WorkflowNodeKind } from "./model.ts"

export type WorkflowNodeCatalogItem = { kind: WorkflowNodeKind; title: string; detail: string; icon: LucideIcon }

const bundledSymbol = undefined as unknown as LucideIcon

export const WORKFLOW_NODE_CATALOG: readonly WorkflowNodeCatalogItem[] = [
  { kind: "task", title: "Task", detail: "A reminder with optional subtasks", icon: bundledSymbol },
  { kind: "timer", title: "Timer", detail: "A timed focus task", icon: bundledSymbol },
  { kind: "trigger", title: "Trigger", detail: "Start from a time or app event", icon: bundledSymbol },
  { kind: "terminator", title: "Start", detail: "Manually start or reset the day", icon: bundledSymbol },
  { kind: "plugin", title: "App", detail: "Use a bundled app plugin", icon: bundledSymbol },
]
