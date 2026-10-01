import { Container, Graphics, Text } from "pixi.js"
import type { CanvasRenderContext, ElementRenderer } from "@productivity-os/canvas/core"
import { timerElapsed } from "./timer-lifecycle.ts"
import { WorkflowPluginNode, WorkflowTaskNode, WorkflowTerminatorNode, WorkflowTimerNode, WorkflowTriggerNode, type WorkflowNode } from "./model.ts"
import { workflowTaskLayout } from "./layout.ts"

const fontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif"

function palette() {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  return dark
    ? { surface: 0x25272b, surfaceDone: 0x2e3136, border: 0x525866, text: 0xf5f7fb, muted: 0xa8afba, blue: 0x60a5fa }
    : { surface: 0xffffff, surfaceDone: 0xf1f3f5, border: 0xcbd5e1, text: 0x172033, muted: 0x8a94a3, blue: 0x3b82f6 }
}

function text(value: string, x: number, y: number, size = 14, color = palette().text, weight: "normal" | "bold" = "normal") {
  const label = new Text({ text: value, style: { fill: color, fontFamily, fontSize: size, fontWeight: weight } })
  label.position.set(x, y)
  return label
}

function clear(target: Container) {
  for (const child of target.removeChildren()) child.destroy({ children: true })
}

function checkbox(checked: boolean, x: number, y: number, color = palette().blue) {
  const box = new Graphics().circle(x + 9, y + 9, 8)
    .fill({ color: checked ? color : 0xffffff })
    .stroke({ color, width: 1.5 })
  const children: (Graphics | Text)[] = [box]
  if (checked) {
    const mark = new Graphics().moveTo(x + 5, y + 9).lineTo(x + 8, y + 12).lineTo(x + 14, y + 5)
      .stroke({ color: 0xffffff, width: 2 })
    children.push(mark)
  }
  return children
}

export class WorkflowNodeRenderer implements ElementRenderer<WorkflowNode> {
  private readonly pluginRenderer?: (target: Container, node: WorkflowPluginNode, context: CanvasRenderContext) => boolean

  constructor(pluginRenderer?: (target: Container, node: WorkflowPluginNode, context: CanvasRenderContext) => boolean) {
    this.pluginRenderer = pluginRenderer
  }

  render(target: Container, node: WorkflowNode, context: CanvasRenderContext): void {
    clear(target)
    if (node instanceof WorkflowTaskNode) this.renderTask(target, node)
    else if (node instanceof WorkflowTimerNode) this.renderTimer(target, node, context)
    else if (node instanceof WorkflowTerminatorNode) this.renderTerminator(target, node)
    else if (node instanceof WorkflowTriggerNode) this.renderTrigger(target, node)
    else if (node instanceof WorkflowPluginNode) {
      if (!this.pluginRenderer?.(target, node, context)) this.renderUnavailablePlugin(target, node)
    }
    else this.renderPlain(target, node)
  }

  private root(target: Container, node: WorkflowNode) {
    const root = new Container()
    root.position.set(node.x + node.width / 2, node.y + node.height / 2)
    root.pivot.set(node.width / 2, node.height / 2)
    root.rotation = node.rotation
    root.alpha = node.opacity
    target.addChild(root)
    return root
  }

  private renderTask(target: Container, node: WorkflowTaskNode) {
    const colors = palette()
    const root = this.root(target, node)
    root.addChild(new Graphics().roundRect(0, 0, node.width, node.height, 20)
      .fill({ color: node.completed ? colors.surfaceDone : colors.surface })
      .stroke({ color: colors.border, width: 1.25 }))
    if (!node.subtasks.length) {
      root.addChild(...checkbox(node.completed, 14, node.height / 2 - 9))
      const label = text(node.name, 44, node.height / 2, 14, node.completed ? colors.muted : colors.text, "bold")
      label.anchor.set(0, 0.5)
      root.addChild(label)
      return
    }
    const title = text(node.name, 16, 14, 14, colors.text, "bold")
    root.addChild(title)
    root.addChild(new Graphics().moveTo(0, workflowTaskLayout.headerHeight).lineTo(node.width, workflowTaskLayout.headerHeight).stroke({ color: colors.border, width: 1 }))
    const chevron = text("⌃", node.width - 26, 12, 14, colors.muted, "bold")
    root.addChild(chevron)
    node.subtasks.forEach((subtask, index) => {
      const bounds = workflowTaskLayout.checkboxBounds(index)
      root.addChild(...checkbox(subtask.completed, bounds.x, bounds.y))
      const label = text(subtask.name || "Subtask", 42, bounds.y + 8, 12, subtask.completed ? colors.muted : colors.text)
      label.anchor.set(0, 0.5)
      root.addChild(label)
    })
  }

  private renderTimer(target: Container, node: WorkflowTimerNode, _context: CanvasRenderContext) {
    const colors = palette()
    const root = this.root(target, node)
    const radius = 20
    root.addChild(new Graphics().roundRect(0, 0, node.width, node.height, radius).fill({ color: colors.surface }))
    const elapsed = timerElapsed(node)
    const progress = Math.min(1, elapsed / node.durationMs)
    const labels = (color: number) => {
      const button = text(node.timerStatus === "running" ? "Ⅱ" : "▶", 19, node.height / 2, 14, color, "bold"); button.anchor.set(0.5)
      const title = text(node.name, 42, node.height / 2 - 8, 14, color, "bold")
      const remaining = Math.max(0, node.durationMs - elapsed)
      const clock = text(`${Math.ceil(remaining / 60_000)}:${String(Math.floor(remaining / 1_000) % 60).padStart(2, "0")}`, node.width - 16, node.height / 2, 12, color, "bold"); clock.anchor.set(1, 0.5)
      return [button, title, clock]
    }
    root.addChild(...labels(colors.text))
    if (progress > 0) {
      const mask = new Graphics().roundRect(0, 0, node.width * progress, node.height, radius).fill({ color: 0xffffff })
      const fill = new Graphics().roundRect(0, 0, node.width, node.height, radius).fill({ color: colors.blue })
      fill.mask = mask
      const inverse = new Container(); inverse.mask = mask; inverse.addChild(...labels(0xffffff))
      root.addChild(mask, fill, inverse)
    }
    root.addChild(new Graphics().roundRect(0, 0, node.width, node.height, radius).stroke({ color: colors.blue, width: 2 }))
  }

  private renderTerminator(target: Container, node: WorkflowTerminatorNode) {
    const colors = palette(); const root = this.root(target, node)
    if (node.role === "Start") root.addChild(new Graphics().circle(node.width / 2, node.height / 2, Math.min(node.width, node.height) / 2 - 2).fill({ color: colors.surface }).stroke({ color: colors.border, width: 1.5 }))
    else root.addChild(new Graphics().roundRect(0, 0, node.width, node.height, 28).fill({ color: colors.surface }).stroke({ color: colors.border, width: 1.5 }))
    const label = text(node.role === "Start" ? "↻" : node.name, node.width / 2, node.height / 2, 16, colors.text, "bold"); label.anchor.set(0.5); root.addChild(label)
  }

  private renderTrigger(target: Container, node: WorkflowTriggerNode) {
    const colors = palette(); const root = this.root(target, node)
    root.addChild(new Graphics().roundRect(0, 0, node.width, node.height, 20).fill({ color: colors.surface }).stroke({ color: colors.border, width: 1.5 }))
    const icon = text(node.triggerType === "time" ? "◷" : "▶", 23, node.height / 2, 16, colors.blue, "bold"); icon.anchor.set(0.5)
    const title = text(node.name, 45, node.height / 2 - 8, 14, colors.text, "bold")
    const detail = text(node.triggerType === "time" ? (node.time ?? "Choose time") : node.triggerType.replace("-", " "), 45, node.height / 2 + 11, 10, colors.muted)
    root.addChild(icon, title, detail)
  }

  private renderUnavailablePlugin(target: Container, node: WorkflowPluginNode) {
    const colors = palette(); const root = this.root(target, node)
    root.addChild(new Graphics().roundRect(0, 0, node.width, node.height, 20).fill({ color: colors.surface }).stroke({ color: colors.border, width: 1.5 }))
    const title = text(node.name, 16, 16, 14, colors.text, "bold")
    const detail = text("Plugin unavailable", 16, 40, 11, colors.muted)
    root.addChild(title, detail)
  }

  private renderPlain(target: Container, node: WorkflowNode) {
    const colors = palette(); const root = this.root(target, node)
    root.addChild(new Graphics().roundRect(0, 0, node.width, node.height, 20).fill({ color: colors.surface }).stroke({ color: colors.border, width: 1.5 }))
    const title = text(node.name, 16, node.height / 2, 14, colors.text, "bold"); title.anchor.set(0, 0.5); root.addChild(title)
  }
}
