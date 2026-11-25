import { createContext, useContext } from "react"

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface AlertOptions {
  title: string
  description?: string
  okLabel?: string
}

export interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  alert: (options: AlertOptions) => Promise<void>
}

export const ConfirmContext = createContext<ConfirmContextValue | null>(null)

const FALLBACK_CONFIRM: ConfirmContextValue = {
  async confirm(options) {
    const message = options.description ? `${options.title}\n\n${options.description}` : options.title
    return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : false
  },
  async alert(options) {
    const message = options.description ? `${options.title}\n\n${options.description}` : options.title
    if (typeof globalThis.alert === "function") globalThis.alert(message)
  },
}

export function useConfirm(): ConfirmContextValue {
  return useContext(ConfirmContext) ?? FALLBACK_CONFIRM
}
