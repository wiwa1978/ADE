import { memo, useState } from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"

export interface ThinkingBlockProps {
  text: string
  streaming?: boolean
}

export const ThinkingBlock = memo(function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  const [open, setOpen] = useState(Boolean(streaming))
  return (
    <div className="ade-thinking">
      <button type="button" className="ade-thinking-toggle" onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Brain className="size-3.5" />
        <span>{streaming ? "Thinking…" : "Thought process"}</span>
      </button>
      {open ? <div className="ade-thinking-body">{text}</div> : null}
    </div>
  )
})
