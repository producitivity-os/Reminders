import { invoke } from "@tauri-apps/api/core"
import { Container } from "pixi.js"
import quranPlugin from "@productivity-os/workflow-quran-nodes"
import revisePlugin from "@productivity-os/workflow-revise-nodes"
import type {
  QuranRecording,
  RevisionSession,
  WorkflowNodePluginDefinition,
  WorkflowNodePluginPackage,
  WorkflowPluginActionResult,
  WorkflowPluginCapability,
  WorkflowPluginServices,
  WorkflowNodePointerGesture,
} from "@productivity-os/workflow-plugin-sdk"
import type { CanvasRenderContext } from "@productivity-os/canvas/core"
import { isTauri } from "../../api"
import { DAY_PLAN_ID } from "./api"
import { WorkflowPluginNode } from "./nodes"

const bundledPlugins: readonly WorkflowNodePluginPackage[] = [revisePlugin, quranPlugin]

type Definition = WorkflowNodePluginDefinition<Record<string, unknown>>

export class DayPlanPluginHost {
  private readonly definitions = new Map<string, Definition>()
  private readonly capabilities = new Map<string, ReadonlySet<WorkflowPluginCapability>>()
  private readonly recordings = new Map<string, QuranRecording>()
  private readonly preferences = new Map<string, unknown>()
  private renderRequest: () => void = () => undefined

  readonly services: WorkflowPluginServices

  constructor() {
    for (const plugin of bundledPlugins) {
      this.capabilities.set(plugin.manifest.id, new Set(plugin.manifest.capabilities ?? []))
      for (const definition of plugin.nodes)
        this.definitions.set(`${plugin.manifest.id}:${definition.nodeType}`, definition)
    }
    this.services = this.createServices()
  }

  setRenderRequest(callback: () => void) {
    this.renderRequest = callback
  }

  definition(node: WorkflowPluginNode): Definition | null {
    return this.definitions.get(`${node.pluginId}:${node.pluginNodeType}`) ?? null
  }

  servicesFor(pluginId: string): WorkflowPluginServices {
    const services = this.services
    const capabilities = this.capabilities.get(pluginId) ?? new Set<WorkflowPluginCapability>()
    const requirements: Partial<Record<keyof WorkflowPluginServices, WorkflowPluginCapability>> = {
      getPreference: "preferences", setPreference: "preferences",
      listQuranRecordings: "quran:recordings", resolveQuranRecording: "quran:recordings",
      launchQuranRevision: "quran:capture", quranRecordingUrl: "media:read",
      cacheQuranRecordingSegmentPeaks: "media:read",
      listRevisionNotebooks: "revise:sessions", revisionSession: "revise:sessions",
      launchRevisionSession: "revise:sessions", setRevisionSessionStatus: "revise:sessions",
    }
    return new Proxy(services, {
      get(target, property: keyof WorkflowPluginServices) {
        const required = requirements[property]
        if (required && !capabilities.has(required)) {
          return () => { throw new Error(`${pluginId} is not allowed to use ${String(property)}.`) }
        }
        const value = target[property]
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }

  create(pluginId: string, nodeType: string, point: { x: number; y: number }, layerId = "main") {
    const definition = this.definitions.get(`${pluginId}:${nodeType}`)
    if (!definition) return null
    return new WorkflowPluginNode({
      id: crypto.randomUUID(),
      type: "workflow-node",
      layerId,
      x: point.x - definition.defaultSize.width / 2,
      y: point.y - definition.defaultSize.height / 2,
      width: definition.defaultSize.width,
      height: definition.defaultSize.height,
      rotation: 0,
      opacity: 1,
      pluginId,
      pluginNodeType: nodeType,
      pluginVersion: definition.schemaVersion,
      pluginData: definition.createData(),
      completed: false,
      name: definition.title,
    })
  }

  migrate(node: WorkflowPluginNode): WorkflowPluginNode {
    const definition = this.definition(node)
    if (!definition || node.pluginVersion >= definition.schemaVersion) return node
    const fromVersion = node.pluginVersion
    node.pluginData = definition.migrate?.(node.pluginData, fromVersion) ?? node.pluginData
    Object.assign(node, definition.migrateNode?.(node, fromVersion))
    node.pluginVersion = definition.schemaVersion
    return node
  }

  render = (target: Container, rawNode: WorkflowPluginNode, context: CanvasRenderContext): boolean => {
    const node = this.migrate(rawNode)
    const definition = this.definition(node)
    if (!definition) return false
    try {
      const root = new Container()
      root.position.set(node.x + node.width / 2, node.y + node.height / 2)
      root.pivot.set(node.width / 2, node.height / 2)
      root.rotation = node.rotation
      root.alpha = node.opacity
      target.addChild(root)
      definition.render(root, node, context, this.servicesFor(node.pluginId))
      const disabled = false
      for (const button of definition.buttons ?? [])
        button.render(root, node, { hoveredRegionId: context.hoveredRegionId, disabled })
      for (const waveform of definition.waveforms ?? [])
        waveform.render(root, node, { hoveredRegionId: context.hoveredRegionId, disabled })
      return true
    } catch (error) {
      console.warn(`Could not render ${node.pluginId}:${node.pluginNodeType}`, error)
      return false
    }
  }

  regions = (node: WorkflowPluginNode) => {
    const definition = this.definition(node)
    if (!definition) return []
    return [
      ...(definition.buttons ?? []).flatMap((button) => {
        const region = button.interactionRegion(node)
        return region ? [region] : []
      }),
      ...(definition.waveforms ?? []).flatMap((waveform) => {
        const region = waveform.interactionRegion(node)
        return region ? [region] : []
      }),
      ...(definition.pointerInteractionRegions?.(node) ?? []),
    ]
  }

  async activate(node: WorkflowPluginNode, regionId: string): Promise<WorkflowPluginActionResult | void> {
    const definition = this.definition(node)
    if (!definition) throw new Error("This plugin is not available in this build.")
    const services = this.servicesFor(node.pluginId)
    for (const button of definition.buttons ?? []) {
      const result = await button.press(node, regionId, DAY_PLAN_ID, services)
      if (result) return result
    }
    return definition.onInteraction?.(node, regionId, DAY_PLAN_ID, services)
  }

  gesture(node: WorkflowPluginNode, regionId: string, gesture: WorkflowNodePointerGesture): boolean {
    const definition = this.definition(node)
    if (!definition?.onPointerGesture) return false
    return Boolean(definition.onPointerGesture(node, regionId, gesture, DAY_PLAN_ID, this.servicesFor(node.pluginId)))
  }

  reset(pluginId: string, nodeType: string, data: Record<string, unknown>) {
    const definition = this.definitions.get(`${pluginId}:${nodeType}`)
    return definition?.reset?.(data) ?? data
  }

  tick(node: WorkflowPluginNode, now = Date.now()) {
    return this.definition(node)?.onTick?.(node, now, DAY_PLAN_ID, this.services)
  }

  private createServices(): WorkflowPluginServices {
    return {
      listBooks: async () => [],
      resolveBook: () => null,
      getPreference: async <T,>(pluginId: string, key: string) =>
        (this.preferences.get(`${pluginId}:${key}`) as T | undefined) ?? null,
      setPreference: async (pluginId, key, value) => {
        this.preferences.set(`${pluginId}:${key}`, value)
      },
      launchQuranRevision: async (input) => {
        if (!isTauri) throw new Error("Quran capture requires the desktop app.")
        await invoke("day_plan_create_quran_capture", { input: {
          id: input.captureSessionId,
          workflowId: input.workflowId,
          nodeId: input.nodeId,
          recordingId: input.recordingId,
          replaceStartMs: input.replaceStartMs,
          surahNumber: input.surahNumber,
          surahName: input.surahName,
          ayahStart: input.ayahStart,
          endSurahNumber: input.endSurahNumber,
          endSurahName: input.endSurahName,
          ayahEnd: input.ayahEnd,
        } })
        window.location.href = `productivity-quran://capture/${encodeURIComponent(input.captureSessionId)}`
      },
      listQuranRecordings: async (_workflowId, nodeId) => {
        if (!isTauri) return []
        const recordings = await invoke<QuranRecording[]>("day_plan_quran_recordings", { nodeId })
        for (const recording of recordings) this.recordings.set(recording.id, recording)
        return recordings
      },
      resolveQuranRecording: (id) => this.recordings.get(id) ?? null,
      quranRecordingUrl: (mediaId) => `media://${mediaId}/content`,
      cacheQuranRecordingSegmentPeaks: async () => undefined,
      requestRender: () => this.renderRequest(),
      bookCoverUrl: (mediaId, variant = "content") => `media://${mediaId}/${variant}`,
      healthWaterDay: async (localDate) => ({ localDate, targetMilliliters: 2000, intakeMilliliters: 0, updatedAt: Date.now() }),
      saveHealthWater: async (input) => input,
      nutritionWaterDay: async (localDate) => ({ localDate, targetMilliliters: 2000, intakeMilliliters: 0, updatedAt: Date.now() }),
      saveNutritionWater: async (input) => input,
      listNutritionFood: async () => [],
      saveNutritionFood: async (input) => input,
      listRevisionNotebooks: async () => {
        if (!isTauri) return []
        const items = await invoke<Array<{ id: string; title: string }>>("day_plan_revision_notebooks")
        return items.map(({ id, title }) => ({ id, title }))
      },
      revisionSession: async (id) => isTauri
        ? invoke<RevisionSession | null>("day_plan_revision_session", { id })
        : null,
      launchRevisionSession: async (input) => {
        if (!isTauri) throw new Error("Review sessions require the desktop app.")
        const session = await invoke<RevisionSession>("day_plan_launch_revision", { input })
        window.location.href = `productivity-revise://session/${encodeURIComponent(input.sessionId)}`
        return session
      },
      setRevisionSessionStatus: async (id, status) => {
        if (!isTauri) throw new Error("Review sessions require the desktop app.")
        return invoke<RevisionSession>("day_plan_set_revision_status", { id, status })
      },
    }
  }
}
