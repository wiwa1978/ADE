import { createContext, useContext, useEffect, useRef } from "react"
import { z } from "zod"
import {
  RuntimeEventPayloadSchemas,
  type RuntimeEventType,
  type TypedRuntimeEvent,
} from "../../packages/protocol/index.ts"

export type EventStreamListener = (event: MessageEvent) => void

export type TypedEventStreamListener<K extends RuntimeEventType = RuntimeEventType> = (
  event: TypedRuntimeEvent<K>,
) => void

export type EventStreamContextValue = {
  connected: boolean
  subscribe: (eventName: string, listener: EventStreamListener) => () => void
  subscribeTyped: <K extends RuntimeEventType>(
    eventName: K,
    listener: TypedEventStreamListener<K>,
  ) => () => void
  reconnect: () => void
}

const envelopeSchemaCache = new Map<RuntimeEventType, z.ZodTypeAny>()

function getEnvelopeSchema<K extends RuntimeEventType>(eventName: K) {
  let cached = envelopeSchemaCache.get(eventName)
  if (!cached) {
    cached = z.object({
      type: z.literal(eventName).optional(),
      sessionId: z.string().optional(),
      timestamp: z.number().optional(),
      payload: RuntimeEventPayloadSchemas[eventName],
    })
    envelopeSchemaCache.set(eventName, cached)
  }
  return cached as z.ZodType<{
    type?: K
    sessionId?: string
    timestamp?: number
    payload: TypedRuntimeEvent<K>["payload"]
  }>
}

/**
 * Safely decodes and Zod-validates an SSE MessageEvent for a known runtime event type.
 * Returns null and logs a warning if the JSON or payload shape is invalid.
 */
export function decodeRuntimeEvent<K extends RuntimeEventType>(
  eventName: K,
  raw: MessageEvent,
): TypedRuntimeEvent<K> | null {
  let json: unknown
  try {
    json = typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data
  } catch (error) {
    console.warn(
      `[ADE event stream] Invalid JSON for "${eventName}":`,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
  const result = getEnvelopeSchema(eventName).safeParse(json)
  if (!result.success) {
    console.warn(
      `[ADE event stream] Schema mismatch for "${eventName}":`,
      result.error.issues[0]?.message ?? "invalid payload",
    )
    return null
  }
  return {
    type: eventName,
    ...(result.data.sessionId !== undefined ? { sessionId: result.data.sessionId } : {}),
    payload: result.data.payload,
    timestamp: result.data.timestamp ?? Date.now(),
  } as TypedRuntimeEvent<K>
}

const noopUnsubscribe = () => {}

const DEFAULT_CONTEXT: EventStreamContextValue = {
  connected: false,
  subscribe: () => noopUnsubscribe,
  subscribeTyped: () => noopUnsubscribe,
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

export function useTypedEventStreamListener<K extends RuntimeEventType>(
  eventName: K,
  listener: TypedEventStreamListener<K>,
): void {
  const { subscribeTyped } = useEventStream()
  const listenerRef = useRef(listener)
  useEffect(() => {
    listenerRef.current = listener
  })

  useEffect(() => {
    return subscribeTyped(eventName, (ev) => listenerRef.current(ev))
  }, [eventName, subscribeTyped])
}
