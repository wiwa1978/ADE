import { createContext, useContext, useEffect, useRef } from "react"

export type EventStreamListener = (event: MessageEvent) => void

export type EventStreamContextValue = {
  connected: boolean
  subscribe: (eventName: string, listener: EventStreamListener) => () => void
  reconnect: () => void
}

const noopUnsubscribe = () => {}

const DEFAULT_CONTEXT: EventStreamContextValue = {
  connected: false,
  subscribe: () => noopUnsubscribe,
  reconnect: () => {},
}

export const EventStreamContext = createContext<EventStreamContextValue>(DEFAULT_CONTEXT)

export function useEventStream(): EventStreamContextValue {
  return useContext(EventStreamContext)
}

export function useEventStreamListener(eventName: string, listener: EventStreamListener): void {
  const { subscribe } = useEventStream()
  const listenerRef = useRef(listener)
  useEffect(() => {
    listenerRef.current = listener
  })

  useEffect(() => {
    return subscribe(eventName, (ev) => listenerRef.current(ev))
  }, [eventName, subscribe])
}
