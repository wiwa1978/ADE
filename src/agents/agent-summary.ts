import { useEffect, useState } from "react"
import { request } from "../../api"
import type { TimelineItem, TimelineToolCall } from "../../app-types"

export type AgentChanges = { base: string; files: { path: string; added: number; removed: number; status: "added" | "modified" | "deleted" }[]; added: number; removed: number; commits: number }
export type AgentWork = { id: string; cost: number | null; inputTokens: number | null; outputTokens: number | null; changes: AgentChanges | null }
export type AgentsWork = { lead: { cost: number }; agents: AgentWork[] }

/** Cost per agent and what worktree subagents changed; refreshed while the Agents view is open. */
export function useAgentsWork(sessionId: string | null, refreshKey: string) {
  const [work, setWork] = useState<AgentsWork | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void request<AgentsWork>(`/api/sessions/${encodeURIComponent(sessionId)}/agents/work`)
      .then(result => { if (!cancelled && result?.lead && Array.isArray(result.agents)) setWork(result) })
      .catch(() => undefined)
    const timer = setTimeout(() => setTick(value => value + 1), 10_000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionId, refreshKey, tick])
  return work
}

/** A tool call in a few words: "Running npm test", "Editing src/app.ts". */
export function describeTool(tool: TimelineToolCall) {
  const args = tool.arguments ?? {}
  const text = (key: string) => (typeof args[key] === "string" ? String(args[key]) : "")
  switch (tool.name) {
    case "run_command": return `Running ${text("command").split("\n")[0].slice(0, 80)}`
    case "manage_process": return "Managing a background process"
    case "read": return `Reading ${text("path")}`
    case "write": return `Writing ${text("path")}`
    case "edit": case "edit_files": return text("path") ? `Editing ${text("path")}` : "Editing files"
    case "list_files": return `Listing ${text("path") || "files"}`
    case "grep_search": case "find_files": return `Searching for ${text("query") || text("pattern")}`
    case "spawn_subagent": return `Starting subagent ${text("name")}`
    case "wait_subagent": return "Waiting for subagents"
    case "finish_stage": return `Finishing stage ${text("stageId")}`
    case "web_search": return `Searching the web for ${text("query")}`
    default: return tool.name.startsWith("browser_") ? `Browser: ${tool.name.slice(8).replace(/_/g, " ")}` : tool.name.replace(/_/g, " ")
  }
}

function firstLines(text: string, max: number) {
  const clean = text.replace(/[#*`>_]/g, "").split("\n").map(line => line.trim()).filter(Boolean).join(" ")
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** What an agent is doing now, its latest reasoning, and its last answer, from its timeline. */
export function summarize(items: TimelineItem[] | undefined, busy: boolean, liveTools: TimelineToolCall[] = []) {
  const list = items ?? []
  // A tool that's running right now is the clearest answer to "what is it doing?".
  const live = busy ? [...liveTools].reverse().find(tool => ["running", "pending", "waiting", "sleeping"].includes(tool.status)) : undefined
  let now = live ? describeTool(live) : ""
  let reasoning = ""
  let answer = ""
  let steps = 0
  for (const item of list) if (item.kind === "assistant") steps += item.toolCalls.length
  for (const item of [...list].reverse()) {
    if (item.kind === "error" && !now) now = item.message
    if (item.kind !== "assistant") continue
    if (!reasoning && item.thinking.trim()) reasoning = firstLines(item.thinking.split("\n\n").at(-1) ?? item.thinking, 220)
    if (!answer && item.text.trim()) answer = item.text.trim()
    if (!now && busy) {
      const running = [...item.toolCalls].reverse().find(tool => ["running", "pending", "waiting", "sleeping"].includes(tool.status))
      if (running) now = describeTool(running)
      else if (item.streaming && item.text) now = "Writing a reply"
      else if (item.streaming) now = "Thinking"
      else if (item.toolCalls.length) now = `Done: ${describeTool(item.toolCalls[item.toolCalls.length - 1])}`
    }
    if (reasoning && answer && (now || !busy)) break
  }
  return { now, reasoning, answer: answer ? firstLines(answer, 260) : "", fullAnswer: answer, steps }
}

export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return "<1 min"
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
