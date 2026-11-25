import { useEffect, useRef, type RefObject } from "react"

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!active) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const el = ref.current
      if (!el) return
      const target = event.target
      if (target instanceof Node && !el.contains(target)) {
        onCloseRef.current()
      }
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown, { passive: true })
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
    }
  }, [ref, active])
}

export function useEscapeKey(onClose: () => void, active = true): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!active) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [active])
}
