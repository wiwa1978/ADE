import type { SkillsAndRulesCatalog } from "../../app-types"

export function filterSlashCommands(draft: string, commands: SkillsAndRulesCatalog["commands"]) {
  const slashMatch = /^\/([a-z0-9-_]*)$/i.exec(draft.trim())
  if (!slashMatch) return []
  const q = slashMatch[1].toLowerCase()
  return commands.filter(c => c.name.toLowerCase().includes(q))
}

export function resolveSubmittedPrompt(
  trimmed: string,
  commands: SkillsAndRulesCatalog["commands"],
): { kind: "compact" } | { kind: "prompt"; text: string } {
  const leadMatch = /^\/([a-z0-9-_]+)(?:\s+([\s\S]*))?$/i.exec(trimmed)
  if (!leadMatch) return { kind: "prompt", text: trimmed }
  const cmd = commands.find(c => c.name.toLowerCase() === leadMatch[1].toLowerCase())
  if (!cmd) return { kind: "prompt", text: trimmed }
  if (cmd.prompt === "__ADE_COMPACT__") return { kind: "compact" }
  const rest = (leadMatch[2] ?? "").trim()
  return { kind: "prompt", text: rest ? `${cmd.prompt}\n\nUser request: ${rest}` : cmd.prompt }
}
