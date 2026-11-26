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
  fullCanvas = false,
}: {
  header: ReactNode
  children: ReactNode
  aboveComposer?: ReactNode
  composer?: ReactNode
  beside?: ReactNode
  footer?: ReactNode
  containerRef?: RefObject<HTMLDivElement | null>
  primaryWidth?: string
  fullCanvas?: boolean
}) {
  return (
    <div className="ade-workspace-shell">
      {header}
      <div className="ade-split-container" ref={containerRef}>
        <section className="ade-pane ade-pane-primary" style={{ width: primaryWidth }}>
          <div className={fullCanvas ? "ade-pane-fill" : "ade-pane-scroll ade-lead-scroll"}>
            {children}
          </div>
          {aboveComposer || composer ? (
            <div className="ade-composer-anchor">
              {aboveComposer}
              {composer}
            </div>
          ) : null}
        </section>
        {beside}
      </div>
      {footer}
    </div>
  )
}
