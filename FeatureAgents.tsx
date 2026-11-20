export type FeatureAgent = {
  id: string
  parentId: string
  assignmentId: string
  name: string
  assignment: string
  status: "running" | "waiting" | "blocked" | "failed" | "completed" | "unknown"
  model: string | null
  reasoning: string
  error: string | null
  messages: { id: string; role: "user" | "assistant"; content: string }[]
}

export function FeatureAgents({ agents, loading, error, sessionId, selectedId, onSelect, onLead }: {
  agents: FeatureAgent[]; loading: boolean; error: string; sessionId: string; selectedId: string | null
  onSelect: (agent: FeatureAgent) => void; onLead: () => void
}) {
  return <section className="feature-agents" aria-label="Session subagents">
    <button className={`conversation-target${selectedId === null ? " selected" : ""}`} type="button" aria-pressed={selectedId === null} onClick={onLead}>
      <MessageSquare size={15} /><span><strong>Session lead</strong><small>Conversation</small></span>
    </button>
    <div className="subagent-list-heading"><h2>Subagents</h2><span>{agents.length}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    {loading && <p className="hint" role="status">Loading subagents…</p>}
    {!loading && !error && !agents.length && <p className="hint">Delegated work will appear here when the session lead assigns it.</p>}
    {agents.map(agent => <div className="subagent-tile" key={agent.id}>
      <button className={`conversation-target${selectedId === agent.id ? " selected" : ""}`} type="button" aria-label={`View ${agent.name} conversation`} aria-pressed={selectedId === agent.id} onClick={() => onSelect(agent)}>
        <Bot size={15} /><span><strong>{agent.name}</strong><small>{agent.assignment}</small></span>
        <span className={`activity-label ${agent.status}`}><i />{agent.status}</span>
      </button>
      {selectedId === agent.id && <details className="subagent-metadata">
        <summary>Agent details</summary>
        <p className="hint">{agent.model ?? "Model not recorded"} · {agent.reasoning} reasoning · read-only</p>
        <p className="hint">Session ID: {sessionId}<br />Subagent ID: {agent.id}<br />Assignment ID: {agent.assignmentId}</p>
      </details>}
    </div>)}
  </section>
}

function SubagentMessage({ role, name, content }: { role: "user" | "assistant"; name: string; content: string }) {
  return <article className={`message ${role}`}>
    <span className="message-avatar">{role === "user" ? "Lead" : <Bot size={15} />}</span>
    <div className="message-body">
      <div className="message-meta"><strong>{role === "user" ? "Session lead" : name}</strong></div>
      {role === "assistant" ? <MessageContent content={content} /> : <p>{content}</p>}
    </div>
  </article>
}

export function SubagentConversation({ name, agent, loading, error, onLead }: {
  name: string; agent: FeatureAgent | undefined; loading: boolean; error: string; onLead: () => void
}) {
  const hasAssignmentMessage = agent?.messages.some(message => message.role === "user")
  const hasReport = agent?.messages.some(message => message.role === "assistant")
  return <>
    <div className="main-head subagent-head">
      <div><span className="small-icon"><Bot size={16} /></span><span><strong>{agent?.name ?? name}</strong><small>Subagent · {agent?.status ?? (loading ? "loading" : "unavailable")}</small></span></div>
      <button className="quiet-button" type="button" onClick={onLead}><ArrowLeft size={14} /> Session lead</button>
    </div>
    <div className="conversation-feed" aria-label="Subagent conversation" aria-live="polite">
      {error && <p className="error" role="alert">{agent ? `Could not refresh this conversation. Showing the last available messages. ${error}` : error}</p>}
      {loading && <p className="hint" role="status">Loading subagent conversation…</p>}
      {!loading && !error && !agent && <p className="hint">This subagent is no longer available in this session.</p>}
      {agent && <>
        {!hasAssignmentMessage && agent.assignment && <SubagentMessage role="user" name={agent.name} content={agent.assignment} />}
        {agent.messages.map(message => <SubagentMessage key={message.id} role={message.role} name={agent.name} content={message.content} />)}
        {agent.error && <p className="error" role="alert">Subagent ended without an answer: {agent.error}</p>}
        {agent.status === "running" || agent.status === "waiting"
          ? <div className="working-state" role="status"><span className="working-dot" />{agent.status === "running" ? "Subagent is working…" : "Subagent is waiting…"}</div>
          : !hasReport && <p className="hint">No text report yet.</p>}
      </>}
    </div>
    <div className="subagent-readonly">This text conversation is read-only. Message the session lead to continue.</div>
  </>
}
import { ArrowLeft, Bot, MessageSquare } from "lucide-react"

import { MessageContent } from "./MessageContent"

