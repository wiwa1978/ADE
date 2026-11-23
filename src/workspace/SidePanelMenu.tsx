import type { ReactNode } from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"

export type SidePanelItem = {
  id: string
  label: string
  description: string
  icon: LucideIcon
  onOpen: () => void
  /** Short status on the right: a count, "Running", "PR #12". */
  badge?: ReactNode
  /** A live dot (app running, agent driving the browser). */
  live?: boolean
  active?: boolean
  /** Something here waits for you (a stage to approve). */
  attention?: boolean
  /** Only in the side panel's menu, not in the activity bar. */
  menuOnly?: boolean
}

/**
 * What the side panel can show, as one list: opened from the header's panel button, and with
 * "+" in the panel's tab bar. Keeps the header quiet instead of a row of tool buttons.
 */
export function SidePanelMenu({ items }: { items: SidePanelItem[] }) {
  return (
    <div className="ade-pane-body ade-side-menu">
      <h3>Open in the side panel</h3>
      <ul>
        {items.map(item => {
          const Icon = item.icon
          return (
            <li key={item.id}>
              <button type="button" className={`ade-side-menu-item ${item.active ? "is-active" : ""}`} onClick={item.onOpen}>
                <span className="ade-side-menu-icon"><Icon className="size-4" /></span>
                <span className="ade-side-menu-text">
                  <strong>{item.label}{item.live ? <span className="ade-state-dot is-running" aria-label="Active" /> : null}</strong>
                  <span>{item.description}</span>
                </span>
                {item.badge ? <span className="ade-side-menu-badge">{item.badge}</span> : null}
                <ChevronRight className="size-3.5 opacity-40" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
