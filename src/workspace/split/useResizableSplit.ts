import { useCallback, useEffect, useRef, useState } from "react"

function readNumber(key: string, min: number, max: number, fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(key))
    return saved >= min && saved <= max ? saved : fallback
  } catch {
    return fallback
  }
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)))
  } catch {
    // Storage can be unavailable in private browsing mode.
  }
}

export function useResizableSplit() {
  const [splitRatio, setSplitRatio] = useState(() => readNumber("ade.split-ratio", 30, 75, 52))
  const [bottomTerminalHeight, setBottomTerminalHeight] = useState(() => readNumber("ade.terminal-height", 140, 520, 240))
  const [narrowRatio, setNarrowRatio] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const bottomDraggingRef = useRef(false)
  const splitRatioRef = useRef(splitRatio)
  const bottomHeightRef = useRef(bottomTerminalHeight)

  useEffect(() => {
    splitRatioRef.current = splitRatio
  }, [splitRatio])

  useEffect(() => {
    bottomHeightRef.current = bottomTerminalHeight
  }, [bottomTerminalHeight])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        if (!rect.width) return
        const pct = Math.min(75, Math.max(30, ((e.clientX - rect.left) / rect.width) * 100))
        splitRatioRef.current = pct
        setSplitRatio(pct)
      }
      if (bottomDraggingRef.current) {
        const next = Math.min(520, Math.max(140, window.innerHeight - e.clientY))
        bottomHeightRef.current = next
        setBottomTerminalHeight(next)
      }
    }
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        writeNumber("ade.split-ratio", splitRatioRef.current)
      }
      if (bottomDraggingRef.current) {
        bottomDraggingRef.current = false
        writeNumber("ade.terminal-height", bottomHeightRef.current)
      }
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [])

  const startSplitDrag = useCallback(() => {
    draggingRef.current = true
  }, [])

  const startBottomDrag = useCallback(() => {
    bottomDraggingRef.current = true
  }, [])

  const widenForTeam = useCallback(() => {
    setNarrowRatio(prev => {
      if (prev !== null) return prev
      const current = splitRatioRef.current
      setSplitRatio(30)
      return current
    })
  }, [])

  const toggleAgentsWide = useCallback(() => {
    setNarrowRatio(prev => {
      if (prev !== null) {
        setSplitRatio(prev)
        return null
      }
      const current = splitRatioRef.current
      setSplitRatio(30)
      return current
    })
  }, [])

  return {
    containerRef,
    splitRatio,
    bottomTerminalHeight,
    agentsWide: narrowRatio !== null,
    startSplitDrag,
    startBottomDrag,
    widenForTeam,
    toggleAgentsWide,
  }
}
