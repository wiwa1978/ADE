import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { resolveCaptainUrl } from "../../api"
import {
  EventStreamContext,
  type EventStreamContextValue,
  type EventStreamListener,
} from "./useEventStream"

export function EventStreamProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [epoch, setEpoch] = useState(0)

  const listenersRef = useRef<Map<string, Set<EventStreamListener>>>(new Map())
  const dispatchersRef = useRef<Map<string, EventListener>>(new Map())
  const sourceRef = useRef<EventSource | null>(null)

  const getDispatcher = useCallback((eventName: string): EventListener => {
    let dispatcher = dispatchersRef.current.get(eventName)
    if (!dispatcher) {
      dispatcher = (raw: Event) => {
        const set = listenersRef.current.get(eventName)
        if (!set) return
        for (const listener of Array.from(set)) {
          try {
            listener(raw as MessageEvent)
          } catch (error) {
            console.warn(
              `[ADE event stream] Listener error for "${eventName}":`,
              error instanceof Error ? error.message : String(error),
            )
          }
        }
      }
      dispatchersRef.current.set(eventName, dispatcher)
    }
    return dispatcher
  }, [])

  const subscribe = useCallback(
    (eventName: string, listener: EventStreamListener) => {
      let set = listenersRef.current.get(eventName)
      const isFirst = !set || set.size === 0
      if (!set) {
        set = new Set()
        listenersRef.current.set(eventName, set)
      }
      set.add(listener)
      if (isFirst && sourceRef.current) {
        sourceRef.current.addEventListener(eventName, getDispatcher(eventName))
      }
      return () => {
        const current = listenersRef.current.get(eventName)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) {
          listenersRef.current.delete(eventName)
          const dispatcher = dispatchersRef.current.get(eventName)
          if (dispatcher && sourceRef.current) {
            sourceRef.current.removeEventListener(eventName, dispatcher)
          }
        }
      }
    },
    [getDispatcher],
  )

  const reconnect = useCallback(() => {
    setEpoch(prev => prev + 1)
  }, [])

  useEffect(() => {
    if (typeof EventSource === "undefined") return
    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = 2500

    const connect = () => {
      if (closed) return
      let source: EventSource
      try {
        source = new EventSource(resolveCaptainUrl("/api/events"))
      } catch (error) {
        console.warn("[ADE event stream] Failed to open EventSource:", error instanceof Error ? error.message : String(error))
        return
      }
      sourceRef.current = source

      const onConnected = () => {
        retryDelay = 2500
        setConnected(true)
      }
      source.addEventListener("connected", onConnected)

      for (const eventName of listenersRef.current.keys()) {
        source.addEventListener(eventName, getDispatcher(eventName))
      }

      source.onerror = () => {
        setConnected(false)
        source.close()
        if (sourceRef.current === source) sourceRef.current = null
        if (!closed) {
          reconnectTimer = setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 15_000)
        }
      }
    }

    connect()
    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      const active = sourceRef.current
      if (active) {
        active.close()
        sourceRef.current = null
      }
      setConnected(false)
    }
  }, [epoch, getDispatcher])

  const value = useMemo<EventStreamContextValue>(
    () => ({ connected, subscribe, reconnect }),
    [connected, subscribe, reconnect],
  )

  return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>
}
