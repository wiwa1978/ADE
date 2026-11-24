import { useRef } from "react"

/**
 * A drag handle on the left edge of a right-hand panel. Drag to resize; double-click for the
 * standard width. Works under the app's interface zoom (it measures the panel it resizes).
 */
export function PaneResizer({ width, min, max, standard, onChange, paneRef, label }: {
  width: number
  min: number
  max: number
  standard: number
  onChange: (width: number) => void
  /** The panel being resized, to read the interface zoom from. */
  paneRef: React.RefObject<HTMLElement | null>
  label: string
}) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null)
  const clamp = (value: number) => Math.round(Math.min(Math.min(max, window.innerWidth * 0.7), Math.max(min, value)))
  return (
    <div
      className="ade-pane-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click for the standard width"
      onPointerDown={event => {
        const pane = paneRef.current
        const scale = pane && pane.offsetWidth ? pane.getBoundingClientRect().width / pane.offsetWidth : 1
        drag.current = { x: event.clientX, width, scale }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (!drag.current) return
        // The panel is on the right: dragging left makes it wider.
        onChange(clamp(drag.current.width + (drag.current.x - event.clientX) / drag.current.scale))
      }}
      onPointerUp={() => { drag.current = null }}
      onPointerCancel={() => { drag.current = null }}
      onDoubleClick={() => onChange(standard)}
      onKeyDown={event => {
        if (event.key === "ArrowLeft") onChange(clamp(width + 20))
        if (event.key === "ArrowRight") onChange(clamp(width - 20))
      }}
    />
  )
}
