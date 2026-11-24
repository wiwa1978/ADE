import { useMemo, useState } from "react"
import type { SwarmMember, SwarmOverviewModel, SwarmThreadView } from "./swarm-model"

type NodePos = { x: number; y: number; w: number; h: number }

const STATUS_COLOR: Record<string, string> = {
  working: "#38bdf8",
  moving: "#38bdf8",
  waiting: "#f5b941",
  queued: "#a1a1aa",
  done: "#4ade80",
  failed: "#f87171",
  blocked: "#f87171",
  open: "#71717a",
  idle: "#71717a",
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Interactive SVG topology for the Swarm Graph tab:
 * Coordinator -> Workers -> Threads/Tasks (with dependency arrows and live animated pulses).
 */
export function SwarmGraph({
  model,
  onSelectMember,
  onSelectThread,
}: {
  model: SwarmOverviewModel
  onSelectMember: (memberId: string) => void
  onSelectThread?: (threadId: string) => void
}) {
  const [hot, setHot] = useState<string | null>(null)

  const layout = useMemo(() => {
    const workers = model.members.filter(m => !m.isLead)
    const threads = model.threads
    const colW = 196
    const nodeH = 54
    const gapY = 16
    const padX = 20
    const padY = 24
    const gapX = 96

    const hasWorkers = workers.length > 0
    const hasThreads = threads.length > 0

    const xLead = padX
    const xWorkers = xLead + colW + gapX
    const xThreads = hasWorkers ? xWorkers + colW + gapX : xLead + colW + gapX

    const maxRows = Math.max(1, workers.length, threads.length)
    const contentH = maxRows * nodeH + Math.max(0, maxRows - 1) * gapY
    const totalH = Math.max(220, contentH + padY * 2)
    const cols = 1 + (hasWorkers ? 1 : 0) + (hasThreads ? 1 : 0)
    const totalW = padX * 2 + cols * colW + Math.max(0, cols - 1) * gapX

    const centerY = (count: number, index: number) => {
      const h = count * nodeH + Math.max(0, count - 1) * gapY
      const start = (totalH - h) / 2
      return start + index * (nodeH + gapY)
    }

    const leadPos: NodePos = { x: xLead, y: centerY(1, 0), w: colW, h: nodeH }
    const workerPos = new Map<string, NodePos>()
    workers.forEach((worker, idx) => {
      workerPos.set(worker.id, { x: xWorkers, y: centerY(workers.length, idx), w: colW, h: nodeH })
    })

    const threadPos = new Map<string, NodePos>()
    threads.forEach((thread, idx) => {
      threadPos.set(thread.id, { x: xThreads, y: centerY(threads.length, idx), w: colW + 24, h: nodeH + 4 })
    })

    type Edge = { id: string; fromKey: string; toKey: string; from: NodePos; to: NodePos; color: string; live: boolean; dashed?: boolean }
    const edges: Edge[] = []

    // Coordinator -> Workers
    for (const worker of workers) {
      const to = workerPos.get(worker.id)!
      edges.push({
        id: `lead->${worker.id}`,
        fromKey: "lead",
        toKey: worker.id,
        from: leadPos,
        to,
        color: worker.color,
        live: worker.state === "working",
      })
    }

    // Workers (or Coordinator) -> Threads
    for (const thread of threads) {
      const to = threadPos.get(thread.id)!
      const owners = thread.memberIds.filter(id => workerPos.has(id))
      if (owners.length > 0) {
        for (const ownerId of owners) {
          const from = workerPos.get(ownerId)!
          const member = model.membersById[ownerId]
          edges.push({
            id: `${ownerId}->${thread.id}`,
            fromKey: ownerId,
            toKey: thread.id,
            from,
            to,
            color: member?.color ?? STATUS_COLOR[thread.status] ?? "#38bdf8",
            live: thread.status === "moving" || member?.state === "working",
          })
        }
      } else {
        edges.push({
          id: `lead->${thread.id}`,
          fromKey: "lead",
          toKey: thread.id,
          from: leadPos,
          to,
          color: STATUS_COLOR[thread.status] ?? "#8b5cf6",
          live: thread.status === "moving",
          dashed: hasWorkers,
        })
      }
    }

    // Inter-thread task dependencies (if task in thread B depends on task in thread A)
    const taskToThread = new Map<string, string>()
    for (const thread of threads) {
      for (const task of thread.tasks) taskToThread.set(task.id, thread.id)
    }
    const depLinks: Array<{ id: string; fromId: string; toId: string; from: NodePos; to: NodePos }> = []
    const seenDep = new Set<string>()
    for (const thread of threads) {
      for (const task of thread.tasks) {
        for (const dep of task.dependsOn) {
          const depThread = taskToThread.get(dep)
          if (depThread && depThread !== thread.id) {
            const key = `${depThread}->${thread.id}`
            if (!seenDep.has(key)) {
              seenDep.add(key)
              const from = threadPos.get(depThread)
              const to = threadPos.get(thread.id)
              if (from && to) depLinks.push({ id: `dep:${key}`, fromId: depThread, toId: thread.id, from, to })
            }
          }
        }
      }
    }

    return {
      width: Math.max(totalW + (hasThreads ? 24 : 0), 480),
      height: totalH,
      lead: model.members[0],
      leadPos,
      workers,
      workerPos,
      threads,
      threadPos,
      edges,
      depLinks,
    }
  }, [model])

  const connected = useMemo(() => {
    if (!hot) return null
    const set = new Set<string>([hot])
    for (const edge of layout.edges) {
      if (edge.fromKey === hot || edge.toKey === hot) {
        set.add(edge.fromKey)
        set.add(edge.toKey)
      }
    }
    for (const dep of layout.depLinks) {
      if (dep.fromId === hot || dep.toId === hot) {
        set.add(dep.fromId)
        set.add(dep.toId)
      }
    }
    return set
  }, [hot, layout])

  const renderMemberNode = (member: SwarmMember, pos: NodePos) => {
    const dim = connected !== null && !connected.has(member.id)
    const stateColor = STATUS_COLOR[member.state] ?? "#71717a"
    return (
      <g
        key={member.id}
        className={`ade-swarm-gnode ${dim ? "is-dim" : ""}`}
        transform={`translate(${pos.x}, ${pos.y})`}
        onMouseEnter={() => setHot(member.id)}
        onMouseLeave={() => setHot(null)}
        onClick={() => onSelectMember(member.id)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectMember(member.id) } }}
      >
        <rect
          width={pos.w}
          height={pos.h}
          rx={10}
          className={`ade-swarm-grect ${member.state === "working" ? "is-working" : ""}`}
          style={{ stroke: member.state === "working" ? member.color : undefined }}
        />
        <circle cx={16} cy={20} r={4} fill={stateColor} />
        <text x={28} y={23} className="ade-swarm-gtitle">{clip(member.handle, 20)}</text>
        <text x={pos.w - 10} y={22} textAnchor="end" className="ade-swarm-gstate" fill={stateColor}>{member.stateLabel}</text>
        <text x={16} y={40} className="ade-swarm-gsub">{clip(member.focus || member.role || member.harness, 27)}</text>
      </g>
    )
  }

  const renderThreadNode = (thread: SwarmThreadView, pos: NodePos) => {
    const dim = connected !== null && !connected.has(thread.id)
    const color = STATUS_COLOR[thread.status] ?? "#71717a"
    const pct = thread.total > 0 ? Math.round((thread.done / thread.total) * 100) : thread.status === "done" ? 100 : 0
    return (
      <g
        key={thread.id}
        className={`ade-swarm-gnode ${dim ? "is-dim" : ""}`}
        transform={`translate(${pos.x}, ${pos.y})`}
        onMouseEnter={() => setHot(thread.id)}
        onMouseLeave={() => setHot(null)}
        onClick={() => onSelectThread?.(thread.id)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectThread?.(thread.id) } }}
      >
        <rect
          width={pos.w}
          height={pos.h}
          rx={10}
          className={`ade-swarm-grect ${thread.status === "moving" ? "is-working" : ""}`}
        />
        <circle cx={16} cy={20} r={4} fill={color} />
        <text x={28} y={23} className="ade-swarm-gtitle">{clip(thread.title, 22)}</text>
        <text x={pos.w - 12} y={22} textAnchor="end" className="ade-swarm-gstate" fill={color}>{thread.done}/{thread.total}</text>
        <text x={16} y={39} className="ade-swarm-gsub">{clip(thread.now || thread.summary || thread.statusLabel, 30)}</text>
        <rect x={16} y={pos.h - 9} width={pos.w - 32} height={3} rx={1.5} className="ade-swarm-gtrack" />
        <rect x={16} y={pos.h - 9} width={Math.max(pct ? 8 : 0, ((pos.w - 32) * pct) / 100)} height={3} rx={1.5} fill={color} />
      </g>
    )
  }

  return (
    <div className="ade-swarm-graph-wrap">
      <div className="ade-swarm-graph-legend">
        <span><i style={{ background: "#38bdf8" }} /> Moving / Working</span>
        <span><i style={{ background: "#4ade80" }} /> Done</span>
        <span><i style={{ background: "#f5b941" }} /> Waiting</span>
        <span><i style={{ background: "#f87171" }} /> Blocked / Failed</span>
        <span className="ml-auto ade-muted">Hover to trace · click a node to inspect</span>
      </div>
      <div className="ade-swarm-graph-canvas">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" height={layout.height} role="img" aria-label="Swarm coordination graph">
          {layout.edges.map(edge => {
            const sx = edge.from.x + edge.from.w
            const sy = edge.from.y + edge.from.h / 2
            const ex = edge.to.x
            const ey = edge.to.y + edge.to.h / 2
            const bend = Math.max(36, (ex - sx) * 0.48)
            const d = `M${sx},${sy} C${sx + bend},${sy} ${ex - bend},${ey} ${ex},${ey}`
            const isHot = hot !== null && (hot === edge.fromKey || hot === edge.toKey)
            const dim = hot !== null && !isHot
            return (
              <g key={edge.id} className={`ade-swarm-gedge ${edge.live ? "is-live" : ""} ${isHot ? "is-hot" : ""} ${dim ? "is-dim" : ""}`} style={{ color: edge.color }}>
                <path d={d} className="ade-swarm-gpath" strokeDasharray={edge.dashed ? "4 4" : undefined} />
                {edge.live ? (
                  <circle r="3" fill="currentColor">
                    <animateMotion dur="2s" repeatCount="indefinite" path={d} />
                  </circle>
                ) : null}
              </g>
            )
          })}

          {layout.depLinks.map(dep => {
            const sx = dep.from.x + dep.from.w
            const sy = dep.from.y + dep.from.h / 2
            const ex = dep.to.x + dep.to.w
            const ey = dep.to.y + dep.to.h / 2
            const loopX = Math.max(sx, ex) + 26
            const d = `M${sx},${sy} C${loopX},${sy} ${loopX},${ey} ${ex},${ey}`
            const dim = hot !== null && hot !== dep.fromId && hot !== dep.toId
            return (
              <g key={dep.id} className={`ade-swarm-gedge is-dep ${dim ? "is-dim" : ""}`} style={{ color: "#f5b941" }}>
                <path d={d} className="ade-swarm-gpath" strokeDasharray="3 3" />
              </g>
            )
          })}

          {renderMemberNode(layout.lead, layout.leadPos)}
          {layout.workers.map(worker => renderMemberNode(worker, layout.workerPos.get(worker.id)!))}
          {layout.threads.map(thread => renderThreadNode(thread, layout.threadPos.get(thread.id)!))}
        </svg>
      </div>
    </div>
  )
}
