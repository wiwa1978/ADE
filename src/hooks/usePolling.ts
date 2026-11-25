import { useEffect, useRef } from "react"

export interface UsePollingOptions {
  /** Whether polling is currently active. Defaults to `true`. */
  enabled?: boolean
  /** Run immediately when enabled (or when `intervalMs` changes). Defaults to `true`. */
  immediate?: boolean
  /** Pause ticks while `document.visibilityState !== "visible"`, refreshing on return if stale. Defaults to `true`. */
  pauseWhenHidden?: boolean
}

/**
 * Visibility-aware polling hook that never stacks overlapping calls and aborts
 * in-flight requests on unmount, disable, or interval change.
 */
export function usePolling(
  fn: (signal: AbortSignal) => void | Promise<void>,
  intervalMs: number,
  options: UsePollingOptions = {},
): void {
  const { enabled = true, immediate = true, pauseWhenHidden = true } = options
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    if (!enabled || intervalMs <= 0 || !Number.isFinite(intervalMs)) return

    let disposed = false
    let inFlight = false
    let lastRunAt = 0
    let timer: ReturnType<typeof setInterval> | null = null
    let controller: AbortController | null = null

    const isHidden = () =>
      pauseWhenHidden && typeof document !== "undefined" && document.visibilityState !== "visible"

    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    const abortInFlight = () => {
      if (controller) {
        controller.abort()
        controller = null
      }
    }

    const tick = () => {
      if (disposed || inFlight || isHidden()) return
      inFlight = true
      lastRunAt = Date.now()
      const nextController = new AbortController()
      controller = nextController
      void Promise.resolve()
        .then(() => fnRef.current(nextController.signal))
        .catch(() => {
          // Callers handle their own errors; polling must stay alive across transient failures.
        })
        .finally(() => {
          if (controller === nextController) controller = null
          inFlight = false
        })
    }

    const startTimer = () => {
      stopTimer()
      if (disposed || isHidden()) return
      timer = setInterval(tick, intervalMs)
    }

    const handleVisibilityChange = () => {
      if (disposed) return
      if (isHidden()) {
        stopTimer()
        return
      }
      const stale = lastRunAt === 0 || Date.now() - lastRunAt >= intervalMs
      if (stale) tick()
      startTimer()
    }

    if (!isHidden()) {
      if (immediate) tick()
      startTimer()
    }

    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange)
    }

    return () => {
      disposed = true
      stopTimer()
      abortInFlight()
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange)
      }
    }
  }, [enabled, immediate, intervalMs, pauseWhenHidden])
}
