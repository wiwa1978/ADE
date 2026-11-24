import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "./button"
import {
  ConfirmContext,
  type AlertOptions,
  type ConfirmContextValue,
  type ConfirmOptions,
} from "./confirm-context"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog"

type PendingDialog =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "alert"; options: AlertOptions; resolve: () => void }

export interface ConfirmProviderProps {
  children: ReactNode
}

export function ConfirmProvider({ children }: ConfirmProviderProps) {
  const [current, setCurrent] = useState<PendingDialog | null>(null)
  const queueRef = useRef<PendingDialog[]>([])

  const advance = useCallback(() => {
    const next = queueRef.current.shift() ?? null
    setCurrent(next)
  }, [])

  const enqueue = useCallback((entry: PendingDialog) => {
    setCurrent(prev => {
      if (!prev) return entry
      queueRef.current.push(entry)
      return prev
    })
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        enqueue({ kind: "confirm", options, resolve })
      }),
    [enqueue],
  )

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>(resolve => {
        enqueue({ kind: "alert", options, resolve })
      }),
    [enqueue],
  )

  const settle = useCallback(
    (accepted: boolean) => {
      if (!current) return
      if (current.kind === "confirm") {
        current.resolve(accepted)
      } else {
        current.resolve()
      }
      advance()
    },
    [current, advance],
  )

  const value = useMemo<ConfirmContextValue>(() => ({ confirm, alert }), [confirm, alert])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={current !== null} onOpenChange={open => { if (!open) settle(false) }}>
        {current ? (
          <DialogContent size="sm" role={current.kind === "alert" ? "alertdialog" : "dialog"}>
            <DialogHeader>
              <DialogTitle>{current.options.title}</DialogTitle>
              {current.options.description ? (
                <DialogDescription>{current.options.description}</DialogDescription>
              ) : null}
            </DialogHeader>
            <DialogFooter>
              {current.kind === "confirm" ? (
                <>
                  <Button variant="outline" onClick={() => settle(false)}>
                    {current.options.cancelLabel ?? "Cancel"}
                  </Button>
                  <Button
                    variant={current.options.destructive ? "destructive" : "primary"}
                    onClick={() => settle(true)}
                    autoFocus
                  >
                    {current.options.confirmLabel ?? "Confirm"}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => settle(true)} autoFocus>
                  {current.options.okLabel ?? "OK"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </ConfirmContext.Provider>
  )
}
