import { invoke } from "@tauri-apps/api/core"
import type { CanvasLayer, CanvasObject, EndlessCanvasState } from "@productivity-os/canvas"
import { isTauri } from "../../api"

export const DAY_PLAN_ID = "reminders-today-routine"

export type DailyRoutineNodeStatus = "idle" | "ready" | "running" | "paused" | "completed"
export type DailyRoutineNodeRun = {
  nodeId: string
  status: DailyRoutineNodeStatus
  elapsedMs: number
  startedAt: number | null
  completedAt: number | null
  reminderId: string | null
  state: Record<string, unknown>
  updatedAt: number
}

export type DailyRoutineRun = {
  workflowId: string
  localDate: string
  status: "active" | "completed" | "archived"
  startedAt: number
  completedAt: number | null
  createdAt: number
  updatedAt: number
  nodes: DailyRoutineNodeRun[]
}

type StoredCanvasObject = {
  id: string
  layerId: string
  objectType: string
  sortIndex: number
  payload: CanvasObject
}

export type DayPlanDocument = {
  id: string
  title: string
  revision: number
  canvas: {
    schemaVersion: number
    activeLayerId: string
    focusedLayerId: string | null
    unfocusedLayerOpacity: number
    viewport: { x: number; y: number; scale: number }
    layers: CanvasLayer[]
    objects: StoredCanvasObject[]
  }
}

const browserDocumentKey = "reminders-day-plan-document-v1"
const browserRunPrefix = "reminders-day-plan-run-v1:"

function startObject(): CanvasObject {
  return {
    id: "day-plan-start",
    type: "workflow-node",
    layerId: "main",
    x: 120,
    y: 220,
    width: 72,
    height: 72,
    rotation: 0,
    opacity: 1,
    nodeKind: "trigger",
    name: "Start",
    description: "Start today's routine",
    triggerType: "manual",
    time: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    firedAt: null,
    lastFiredDate: null,
  } as unknown as CanvasObject
}

function initialDocument(): DayPlanDocument {
  return {
    id: DAY_PLAN_ID,
    title: "Day Plan",
    revision: 0,
    canvas: {
      schemaVersion: 3,
      activeLayerId: "main",
      focusedLayerId: null,
      unfocusedLayerOpacity: 0.35,
      viewport: { x: 0, y: 0, scale: 1 },
      layers: [{
        id: "main",
        name: "Day Plan",
        zIndex: 0,
        visible: true,
        opacity: 1,
        interactionColor: 0x3b82f6,
      }],
      objects: [{ id: "day-plan-start", layerId: "main", objectType: "workflow-node", sortIndex: 0, payload: startObject() }],
    },
  }
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function canvasStateFromDocument(document: DayPlanDocument): EndlessCanvasState {
  return {
    objects: document.canvas.objects.map((item) => structuredClone(item.payload)),
    layers: structuredClone(document.canvas.layers),
    activeLayerId: document.canvas.activeLayerId,
    focusedLayerId: document.canvas.focusedLayerId,
    unfocusedLayerOpacity: document.canvas.unfocusedLayerOpacity,
    viewport: structuredClone(document.canvas.viewport),
  }
}

function saveInput(document: DayPlanDocument, state: EndlessCanvasState) {
  return {
    id: DAY_PLAN_ID,
    title: "Day Plan",
    project: "Reminders",
    canvasType: "workflow",
    workflowKind: "workflow",
    icon: "network",
    starred: false,
    coverMediaId: null,
    expectedRevision: document.revision,
    canvas: {
      schemaVersion: 3,
      activeLayerId: state.activeLayerId ?? "main",
      focusedLayerId: state.focusedLayerId ?? null,
      unfocusedLayerOpacity: state.unfocusedLayerOpacity ?? 0.35,
      viewport: state.viewport ?? { x: 0, y: 0, scale: 1 },
      layers: state.layers ?? [],
      objects: state.objects.map((object, sortIndex) => ({
        id: object.id,
        layerId: object.layerId,
        objectType: object.type,
        sortIndex,
        payload: object,
      })),
    },
  }
}

export const dayPlanApi = {
  async load(): Promise<DayPlanDocument> {
    if (isTauri) return invoke("get_day_plan")
    const raw = localStorage.getItem(browserDocumentKey)
    if (!raw) {
      const seeded = initialDocument()
      localStorage.setItem(browserDocumentKey, JSON.stringify(seeded))
      return seeded
    }
    return JSON.parse(raw) as DayPlanDocument
  },

  async save(document: DayPlanDocument, state: EndlessCanvasState): Promise<DayPlanDocument> {
    const input = saveInput(document, state)
    if (isTauri) {
      const summary = await invoke<{ revision: number }>("save_day_plan", { input })
      return { ...document, revision: summary.revision, canvas: input.canvas as DayPlanDocument["canvas"] }
    }
    const saved = { ...document, revision: document.revision + 1, canvas: input.canvas as DayPlanDocument["canvas"] }
    localStorage.setItem(browserDocumentKey, JSON.stringify(saved))
    return saved
  },

  async run(localDate: string): Promise<DailyRoutineRun | null> {
    if (isTauri) return invoke("get_day_plan_run", { localDate })
    const raw = localStorage.getItem(`${browserRunPrefix}${localDate}`)
    return raw ? JSON.parse(raw) as DailyRoutineRun : null
  },

  async saveRun(input: Omit<DailyRoutineRun, "workflowId" | "createdAt" | "updatedAt">): Promise<DailyRoutineRun> {
    const payload = { ...input, workflowId: DAY_PLAN_ID }
    if (isTauri) return invoke("save_day_plan_run", { input: payload })
    const now = Date.now()
    const previous = await this.run(input.localDate)
    const saved: DailyRoutineRun = {
      ...payload,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    localStorage.setItem(`${browserRunPrefix}${input.localDate}`, JSON.stringify(saved))
    return saved
  },
}
