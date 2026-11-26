import { HARNESS_CATALOG, harnessLabel, type TerminalHarness } from "@ade/protocol"

export type TerminalHarnessId = TerminalHarness

export const HARNESS_LABELS: Record<TerminalHarnessId, string> = Object.fromEntries(
  HARNESS_CATALOG.map(entry => [entry.id, entry.name]),
) as Record<TerminalHarnessId, string>

export { harnessLabel }

export function terminalPromptStorageKey(sessionId: string): string {
  return `ade-terminal-prompt:${sessionId}`
}
