import type { ReactNode, RefObject } from "react"

/**
 * Shared workspace conversation shell used by both SplitWorkspace (active chats/sessions)
 * and NewSessionView so header, centered canvas, and bottom-docked composer always match.
 */
export function ConversationLayout({
  header,
  children,
  aboveComposer,
  composer,
  beside,
  footer,
  containerRef,
  primaryWidth = "100%",
}: {
  header: ReactNode
  children: ReactNode
  aboveComposer?: ReactNode
  composer: ReactNode
  beside?: ReactNode
  footer?: ReactNode
  containerRef?: RefObject<HTMLDivElement | null>
  primaryWidth?: string
}) {
  return (
    <div className="ade-workspace-shell">
      {header}
      <div className="ade-split-container" ref={containerRef}>
        <section className="ade-pane ade-pane-primary" style={{ width: primaryWidth }}>
          <div className="ade-pane-scroll ade-lead-scroll">
            {children}
          </div>
          <div className="ade-composer-anchor">
            {aboveComposer}
            {composer}
          </div>
        </section>
        {beside}
      </div>
      {footer}
    </div>
  )
}
