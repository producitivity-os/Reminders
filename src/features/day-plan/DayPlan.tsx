import * as React from "react"
import {
  EndlessCanvas,
  type CanvasObject,
  type CanvasPropertiesSlotProps,
  type CanvasTool,
  type EndlessCanvasHandle,
  type EndlessCanvasOptions,
  type EndlessCanvasState,
} from "@productivity-os/canvas"
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Hand,
  MousePointer2,
  Plus,
  Target,
  Undo2,
  Redo2,
  BookOpenText,
} from "@productivity-os/shared-ui/components/sf-symbols"
import type { WorkflowPluginActionResult } from "@productivity-os/workflow-plugin-sdk"
import { remindersApi, defaultReminderListId, isTauri, type ReminderProject } from "../../api"
import { canvasStateFromDocument, dayPlanApi, localDateKey, type DayPlanDocument, type DailyRoutineNodeRun, type DailyRoutineRun } from "./api"
import { DayPlanPluginHost } from "./plugin-host"
import {
  WorkflowNodeRenderer,
  WorkflowPluginNode,
  WorkflowTaskNode,
  WorkflowTimerNode,
  WorkflowTriggerNode,
  createWorkflowNodeExtension,
  expiredTimerUpdates,
  hydrateWorkflowNode,
  setWorkflowObjectsProvider,
  setWorkflowPluginActionHandler,
  setWorkflowPluginGestureHandler,
  setWorkflowPluginRegionProvider,
  setWorkflowPluginResetter,
  wouldCreateWorkflowCycle,
  workflowNodeCompleted,
  type WorkflowNode,
} from "./nodes"

type CreationKind = "task" | "timer" | "trigger" | "revise" | "quran"

const taskHash = (node: WorkflowTaskNode) =>
  JSON.stringify([node.name, node.notes, node.subtasks, node.priority, node.projectId, node.completed])

function newNode(kind: Exclude<CreationKind, "revise" | "quran">, point: { x: number; y: number }): WorkflowNode {
  const shared = {
    id: crypto.randomUUID(),
    type: "workflow-node" as const,
    layerId: "main",
    x: point.x - 120,
    y: point.y - 36,
    width: 240,
    height: 72,
    rotation: 0,
    opacity: 1,
  }
  if (kind === "timer") return new WorkflowTimerNode({ ...shared, name: "Focus timer", durationMs: 25 * 60_000 })
  if (kind === "trigger") return new WorkflowTriggerNode({ ...shared, name: "Trigger", triggerType: "time", time: "09:00" })
  return new WorkflowTaskNode({ ...shared, name: "New task", notes: "", subtasks: [] })
}

function nodeRun(node: WorkflowNode, existing: DailyRoutineNodeRun | undefined, now: number): DailyRoutineNodeRun {
  const completed = workflowNodeCompleted(node)
  const status = completed
    ? "completed"
    : node instanceof WorkflowTimerNode
      ? node.timerStatus
      : "idle"
  return {
    nodeId: node.id,
    status,
    elapsedMs: node instanceof WorkflowTimerNode ? node.elapsedMs : (existing?.elapsedMs ?? 0),
    startedAt: node instanceof WorkflowTimerNode ? node.startedAt : (existing?.startedAt ?? null),
    completedAt: completed ? (existing?.completedAt ?? now) : null,
    reminderId: node instanceof WorkflowTaskNode ? node.reminderId : (existing?.reminderId ?? null),
    state: node instanceof WorkflowPluginNode ? structuredClone(node.pluginData) : (existing?.state ?? {}),
    updatedAt: now,
  }
}

function restoreTodayRuntime(state: EndlessCanvasState, run: DailyRoutineRun | null): EndlessCanvasState {
  const byId = new Map(run?.nodes.map((node) => [node.nodeId, node]) ?? [])
  return {
    ...state,
    objects: state.objects.map((raw) => {
      if (raw.type !== "workflow-node") return raw
      const object = structuredClone(raw) as CanvasObject
      const node = hydrateWorkflowNode(object)
      const runtime = byId.get(node.id)
      if (node instanceof WorkflowTaskNode) {
        Object.assign(object, {
          completed: runtime?.status === "completed",
          reminderId: runtime?.reminderId ?? null,
          subtasks: node.subtasks.map((item) => ({ ...item, completed: run ? item.completed : false })),
        })
      } else if (node instanceof WorkflowTimerNode) {
        Object.assign(object, {
          timerStatus: runtime?.status ?? "idle",
          elapsedMs: runtime?.elapsedMs ?? 0,
          startedAt: runtime?.startedAt ?? null,
        })
      } else if (node instanceof WorkflowTriggerNode) {
        Object.assign(object, {
          firedAt: runtime?.status === "completed" ? runtime.completedAt ?? Date.now() : null,
          lastFiredDate: runtime?.status === "completed" ? run?.localDate ?? null : null,
        })
      } else if (node instanceof WorkflowPluginNode) {
        Object.assign(object, {
          pluginData: runtime?.state ?? node.pluginData,
          completed: runtime?.status === "completed",
        })
      }
      return object
    }),
  }
}

function DayPlanProperties({
  api,
  projects,
  host,
}: {
  api: CanvasPropertiesSlotProps
  projects: readonly ReminderProject[]
  host: DayPlanPluginHost
}) {
  const raw = api.selection.selectedObjects.length === 1 ? api.selection.selectedObjects[0] : null
  if (!raw || raw.type !== "workflow-node") return null
  const node = hydrateWorkflowNode(raw)
  const pluginNode = node instanceof WorkflowPluginNode ? node : null
  const patch = (values: Partial<WorkflowNode>) => api.updateObject(node.id, values as Partial<CanvasObject>)
  const definition = pluginNode ? host.definition(pluginNode) : null
  const PluginProperties = definition?.PropertiesEditor
  return (
    <aside className="day-plan-properties" aria-label="Node properties">
      <h2>{node.name || "Node"}</h2>
      {PluginProperties ? (
        <PluginProperties
          node={pluginNode!}
          workflowId="reminders-today-routine"
          services={host.servicesFor(pluginNode!.pluginId)}
          canInteract
          canExecute
          updateNode={(values) => patch(values as Partial<WorkflowNode>)}
          completeNode={(pluginData) => patch({ pluginData, completed: true } as Partial<WorkflowNode>)}
        />
      ) : (
        <>
          <label><span>Name</span><input value={node.name} onChange={(event) => patch({ name: event.currentTarget.value })} /></label>
          {node instanceof WorkflowTaskNode && (
            <>
              <label><span>Notes</span><textarea value={node.notes} onChange={(event) => patch({ notes: event.currentTarget.value, description: event.currentTarget.value })} /></label>
              <label><span>Project</span><select value={node.projectId ?? ""} onChange={(event) => patch({ projectId: event.currentTarget.value || null } as Partial<WorkflowNode>)}><option value="">Inbox</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
              <label><span>Priority</span><select value={node.priority} onChange={(event) => patch({ priority: event.currentTarget.value } as Partial<WorkflowNode>)}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <div className="day-plan-subtasks">
                <span>Subtasks</span>
                {node.subtasks.map((subtask, index) => <input key={subtask.id} value={subtask.name} onChange={(event) => patch({ subtasks: node.subtasks.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.currentTarget.value } : item) } as Partial<WorkflowNode>)} />)}
                <button type="button" onClick={() => patch({ subtasks: [...node.subtasks, { id: crypto.randomUUID(), name: "New subtask", completed: false }] } as Partial<WorkflowNode>)}><Plus /> Add subtask</button>
              </div>
            </>
          )}
          {node instanceof WorkflowTimerNode && <label><span>Minutes</span><input type="number" min={1} max={1440} value={Math.round(node.durationMs / 60_000)} onChange={(event) => patch({ durationMs: Math.max(1, event.currentTarget.valueAsNumber || 1) * 60_000, elapsedMs: 0, startedAt: null, timerStatus: "idle" } as Partial<WorkflowNode>)} /></label>}
          {node instanceof WorkflowTriggerNode && (
            <>
              <label><span>Event</span><select value={node.triggerType} onChange={(event) => patch({ triggerType: event.currentTarget.value, firedAt: null } as Partial<WorkflowNode>)}><option value="manual">Manual</option><option value="time">Time</option><option value="revise-completed">Revise completed</option><option value="quran-completed">Quran recording saved</option></select></label>
              {node.triggerType === "time" && <label><span>Time</span><input type="time" value={node.time ?? "09:00"} onChange={(event) => patch({ time: event.currentTarget.value } as Partial<WorkflowNode>)} /></label>}
            </>
          )}
        </>
      )}
    </aside>
  )
}

export function DayPlan({ projects, onRemindersChanged }: { projects: readonly ReminderProject[]; onRemindersChanged(): void }) {
  const canvasRef = React.useRef<EndlessCanvasHandle>(null)
  const documentRef = React.useRef<DayPlanDocument | null>(null)
  const stateRef = React.useRef<EndlessCanvasState | null>(null)
  const saveTimerRef = React.useRef<number | null>(null)
  const taskHashesRef = React.useRef(new Map<string, string>())
  const [initialState, setInitialState] = React.useState<EndlessCanvasState | null>(null)
  const [tool, setTool] = React.useState<CanvasTool>("select")
  const [creationKind, setCreationKind] = React.useState<CreationKind>("task")
  const [error, setError] = React.useState<string | null>(null)
  const [history, setHistory] = React.useState({ canUndo: false, canRedo: false })
  const hostRef = React.useRef<DayPlanPluginHost | null>(null)
  if (!hostRef.current) hostRef.current = new DayPlanPluginHost()
  const host = hostRef.current

  const persistRun = React.useCallback(async (state: EndlessCanvasState) => {
    const now = Date.now()
    const localDate = localDateKey()
    const existing = await dayPlanApi.run(localDate)
    const byId = new Map(existing?.nodes.map((node) => [node.nodeId, node]))
    const nodes = state.objects.filter((object) => object.type === "workflow-node").map((object) => nodeRun(hydrateWorkflowNode(object), byId.get(object.id), now))
    await dayPlanApi.saveRun({
      localDate,
      status: nodes.length > 0 && nodes.every((node) => node.status === "completed") ? "completed" : "active",
      startedAt: existing?.startedAt ?? now,
      completedAt: nodes.length > 0 && nodes.every((node) => node.status === "completed") ? now : null,
      nodes,
    })
  }, [])

  const syncTasks = React.useCallback(async (state: EndlessCanvasState) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const all = await remindersApi.reminders({ view: "all", listId: null, projectId: null, dayStart: null, dayEnd: null })
    const byId = new Map(all.map((reminder) => [reminder.id, reminder]))
    let changed = false
    for (const object of state.objects) {
      if (object.type !== "workflow-node") continue
      const node = hydrateWorkflowNode(object)
      if (!(node instanceof WorkflowTaskNode)) continue
      const reminderId = `day-plan:${localDateKey()}:${node.id}`
      const hash = taskHash(node)
      if (taskHashesRef.current.get(node.id) === hash) continue
      let reminder = byId.get(reminderId)
      if (!reminder) {
        reminder = await remindersApi.create({ id: reminderId, listId: defaultReminderListId, title: node.name, notes: node.notes, dueAt: today.getTime(), dueHasTime: false, priority: node.priority, projectId: node.projectId, subtasks: node.subtasks.map((item) => ({ id: item.id, title: item.name, completed: item.completed })), afterId: null })
      } else {
        reminder = await remindersApi.update({ ...reminder, title: node.name, notes: node.notes, priority: node.priority, projectId: node.projectId, subtasks: node.subtasks.map((item) => ({ id: item.id, title: item.name, completed: item.completed })) })
        if (node.completed !== Boolean(reminder.completedAt)) await remindersApi.complete(reminder.id, node.completed)
      }
      if (node.reminderId !== reminderId) canvasRef.current?.updateObject(node.id, { reminderId } as Partial<CanvasObject>)
      taskHashesRef.current.set(node.id, hash)
      changed = true
    }
    if (changed) onRemindersChanged()
  }, [onRemindersChanged])

  const flush = React.useCallback(async () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    const state = stateRef.current
    const document = documentRef.current
    if (!state || !document) return
    try {
      documentRef.current = await dayPlanApi.save(document, state)
      await Promise.all([persistRun(state), syncTasks(state)])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [persistRun, syncTasks])

  const scheduleSave = React.useCallback((state: EndlessCanvasState) => {
    stateRef.current = state
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void flush(), 1200)
  }, [flush])

  React.useEffect(() => {
    let cancelled = false
    void dayPlanApi.load().then(async (document) => {
      if (cancelled) return
      documentRef.current = document
      const run = await dayPlanApi.run(localDateKey())
      const state = restoreTodayRuntime(canvasStateFromDocument(document), run)
      stateRef.current = state
      setInitialState(state)
      void syncTasks(state).then(() => persistRun(state)).catch((cause) => setError(String(cause)))
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => { cancelled = true }
  }, [persistRun, syncTasks])

  React.useEffect(() => {
    setWorkflowObjectsProvider(() => canvasRef.current?.getState()?.objects ?? [])
    setWorkflowPluginRegionProvider(host.regions)
    setWorkflowPluginActionHandler((node, regionId) => {
      void host.activate(node, regionId).then((result) => {
        if (!result) return
        const typed = result as WorkflowPluginActionResult
        canvasRef.current?.updateObject(node.id, {
          ...(typed.nodePatch ?? {}),
          ...(typed.pluginData ? { pluginData: typed.pluginData } : {}),
          ...(typed.complete ? { completed: true } : {}),
        } as Partial<CanvasObject>)
      }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    })
    setWorkflowPluginGestureHandler((node, regionId, gesture) => host.gesture(node, regionId, gesture))
    setWorkflowPluginResetter((pluginId, nodeType, data) => host.reset(pluginId, nodeType, data))
    host.setRenderRequest(() => canvasRef.current?.requestRender())
    return () => {
      setWorkflowObjectsProvider(null)
      setWorkflowPluginRegionProvider(null)
      setWorkflowPluginActionHandler(null)
      setWorkflowPluginGestureHandler(null)
      setWorkflowPluginResetter(null)
    }
  }, [host])

  const applyRun = React.useCallback((run: DailyRoutineRun) => {
    const state = canvasRef.current?.getState()
    if (!state) return
    const byId = new Map(run.nodes.map((node) => [node.nodeId, node]))
    const updates = state.objects.flatMap((object) => {
      if (object.type !== "workflow-node") return []
      const runtime = byId.get(object.id)
      if (!runtime) return []
      const node = hydrateWorkflowNode(object)
      if (node instanceof WorkflowTimerNode)
        return [{ objectId: node.id, patch: { timerStatus: runtime.status, elapsedMs: runtime.elapsedMs, startedAt: runtime.startedAt } as Partial<CanvasObject> }]
      if (node instanceof WorkflowTriggerNode && runtime.status === "completed")
        return [{ objectId: node.id, patch: { firedAt: runtime.completedAt ?? Date.now(), lastFiredDate: run.localDate } as Partial<CanvasObject> }]
      if (node instanceof WorkflowPluginNode)
        return [{ objectId: node.id, patch: { pluginData: runtime.state, completed: runtime.status === "completed" } as Partial<CanvasObject> }]
      if (node instanceof WorkflowTaskNode)
        return [{ objectId: node.id, patch: { reminderId: runtime.reminderId } as Partial<CanvasObject> }]
      return []
    })
    if (updates.length) canvasRef.current?.updateObjects(updates)
  }, [])

  React.useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<DailyRoutineRun>("reminders:day-plan-updated", ({ payload }) => applyRun(payload)),
    ).then((dispose) => { unlisten = dispose })
    return () => unlisten?.()
  }, [applyRun])

  React.useEffect(() => {
    let checking = false
    const reconcilePlugins = async () => {
      if (checking) return
      checking = true
      try {
        const objects = canvasRef.current?.getState()?.objects ?? []
        const activeReminders = await remindersApi.reminders({ view: "all", listId: null, projectId: null, dayStart: null, dayEnd: null })
        const remindersById = new Map(activeReminders.map((reminder) => [reminder.id, reminder]))
        for (const object of objects) {
          if (object.type !== "workflow-node") continue
          const node = hydrateWorkflowNode(object)
          if (node instanceof WorkflowTaskNode && node.reminderId) {
            const reminder = remindersById.get(node.reminderId)
            const currentHash = taskHash(node)
            if (reminder && taskHashesRef.current.get(node.id) === currentHash) {
              const incoming = {
                name: reminder.title,
                notes: reminder.notes,
                description: reminder.notes,
                priority: reminder.priority,
                projectId: reminder.projectId,
                completed: reminder.completedAt !== null,
                subtasks: reminder.subtasks.map((item) => ({ id: item.id, name: item.title, completed: item.completed })),
              }
              const incomingHash = JSON.stringify([incoming.name, incoming.notes, incoming.subtasks, incoming.priority, incoming.projectId, incoming.completed])
              if (incomingHash !== currentHash) {
                taskHashesRef.current.set(node.id, incomingHash)
                canvasRef.current?.updateObject(node.id, incoming as Partial<CanvasObject>)
              }
            }
          }
          if (!(node instanceof WorkflowPluginNode)) continue
          if (node.pluginId === "workflows.revise-nodes") {
            const sessionId = typeof node.pluginData.sessionId === "string" ? node.pluginData.sessionId : null
            const session = sessionId ? await host.services.revisionSession(sessionId) : null
            if (session && session.updatedAt !== node.pluginData.sessionUpdatedAt)
              canvasRef.current?.updateObject(node.id, { pluginData: { ...node.pluginData, ...session, sessionId: session.id, sessionUpdatedAt: session.updatedAt }, completed: session.status === "completed" } as Partial<CanvasObject>)
          }
          if (node.pluginId === "workflows.quran-nodes") {
            const recordings = await host.services.listQuranRecordings("reminders-today-routine", node.id)
            const recording = recordings.sort((left, right) => right.updatedAt - left.updatedAt)[0]
            if (recording && recording.updatedAt !== node.pluginData.recordingUpdatedAt)
              canvasRef.current?.updateObject(node.id, { pluginData: { ...node.pluginData, recordingId: recording.id, recordingUpdatedAt: recording.updatedAt, latestDurationMs: recording.durationMs, attemptCount: recordings.length, pendingRecordingId: null, captureSessionId: null }, completed: recording.status === "completed" } as Partial<CanvasObject>)
          }
        }
      } finally {
        checking = false
      }
    }
    const interval = window.setInterval(() => void reconcilePlugins(), 3_000)
    void reconcilePlugins()
    return () => window.clearInterval(interval)
  }, [host])

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      const objects = canvasRef.current?.getState()?.objects ?? []
      const expired = expiredTimerUpdates(objects)
      if (expired.length) canvasRef.current?.updateObjects(expired)
      canvasRef.current?.requestRender()
    }, 500)
    const onVisibility = () => { if (document.visibilityState === "hidden") void flush() }
    window.addEventListener("blur", flush)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("blur", flush)
      document.removeEventListener("visibilitychange", onVisibility)
      void flush()
    }
  }, [flush])

  const options = React.useMemo<EndlessCanvasOptions>(() => ({
    gridStyle: "dots",
    objectExtensions: [createWorkflowNodeExtension(new WorkflowNodeRenderer(host.render))],
    onAddToolPlacement: (point) => creationKind === "revise"
      ? host.create("workflows.revise-nodes", "timed-revision", point)
      : creationKind === "quran"
        ? host.create("workflows.quran-nodes", "quran-revision", point)
        : newNode(creationKind, point),
    canInsertObject: (object) => {
      if (object.type !== "arrow") return true
      const arrow = object as CanvasObject & { start?: { binding?: { objectId: string } }; end?: { binding?: { objectId: string } } }
      const from = arrow.start?.binding?.objectId
      const to = arrow.end?.binding?.objectId
      if (!from || !to) return true
      const objects = canvasRef.current?.getState()?.objects ?? []
      return !wouldCreateWorkflowCycle(objects, from, to)
    },
  }), [creationKind, host])

  if (!initialState) return <div className="day-plan-loading">{error ?? "Loading Day Plan…"}</div>

  return (
    <section className="day-plan-workspace">
      <div className="day-plan-toolbar" role="toolbar" aria-label="Day Plan tools">
        <button type="button" data-active={tool === "select" || undefined} onClick={() => setTool("select")} aria-label="Select"><MousePointer2 /></button>
        <button type="button" data-active={tool === "hand" || undefined} onClick={() => setTool("hand")} aria-label="Pan"><Hand /></button>
        <button type="button" data-active={tool === "arrow" || undefined} onClick={() => setTool("arrow")} aria-label="Connect"><ArrowRight /></button>
        <span className="day-plan-toolbar-separator" />
        {([
          ["task", CheckCircle2, "Task"], ["timer", Clock3, "Timer"], ["trigger", Target, "Trigger"],
          ["revise", BrainCircuit, "Revise"], ["quran", BookOpenText, "Quran"],
        ] as const).map(([kind, Icon, label]) => <button key={kind} type="button" data-active={tool === "add" && creationKind === kind || undefined} onClick={() => { setCreationKind(kind); setTool("add") }} aria-label={`Add ${label}`}><Icon /><span>{label}</span></button>)}
        <span className="day-plan-toolbar-separator" />
        <button type="button" disabled={!history.canUndo} onClick={() => canvasRef.current?.undo()} aria-label="Undo"><Undo2 /></button>
        <button type="button" disabled={!history.canRedo} onClick={() => canvasRef.current?.redo()} aria-label="Redo"><Redo2 /></button>
      </div>
      {error && <div className="day-plan-error" role="alert">{error}</div>}
      <EndlessCanvas
        ref={canvasRef}
        className="day-plan-canvas"
        tool={tool}
        initialState={initialState}
        options={options}
        onChange={scheduleSave}
        onToolChangeRequest={setTool}
        onHistoryChange={setHistory}
        propertiesSlot={(api) => <DayPlanProperties api={api} projects={projects} host={host} />}
      />
    </section>
  )
}
