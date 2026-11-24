import { type CSSProperties } from "react"
import { Bot } from "lucide-react"

export function MemberBadge({ handle, color, onClick }: { handle: string; color: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="ade-swarm-member-glyph" style={{ "--member": color } as CSSProperties} aria-hidden="true">
        <Bot className="size-3" />
      </span>
      <span className="ade-truncate">{handle}</span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" className="ade-swarm-member-pill is-clickable" onClick={e => { e.stopPropagation(); onClick() }}>
        {inner}
      </button>
    )
  }
  return <span className="ade-swarm-member-pill">{inner}</span>
}
