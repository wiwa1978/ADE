import { AtSign, Slash } from "lucide-react"
import { Badge } from "../../../components/ui/index.ts"
import type { SkillsAndRulesCatalog } from "../../../app-types"

interface ComposerAutocompleteMenuProps {
  showSlashMenu: boolean
  filteredCommands: SkillsAndRulesCatalog["commands"]
  slashIndex: number
  onHoverSlash: (index: number) => void
  onSelectSlash: (name: string) => void
  showMentionMenu: boolean
  mentionFiles: string[]
  mentionIndex: number
  onHoverMention: (index: number) => void
  onSelectMention: (path: string) => void
}

export function ComposerAutocompleteMenu({
  showSlashMenu,
  filteredCommands,
  slashIndex,
  onHoverSlash,
  onSelectSlash,
  showMentionMenu,
  mentionFiles,
  mentionIndex,
  onHoverMention,
  onSelectMention,
}: ComposerAutocompleteMenuProps) {
  return (
    <>
      {showSlashMenu ? (
        <div className="ade-slash-menu" role="listbox" aria-label="Slash commands">
          {filteredCommands.map((cmd, idx) => (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={idx === slashIndex}
              className={`ade-slash-item ${idx === slashIndex ? "is-selected" : ""}`}
              onMouseEnter={() => onHoverSlash(idx)}
              onClick={() => onSelectSlash(cmd.name)}
            >
              <span className="ade-slash-name"><Slash className="size-3" />{cmd.name}</span>
              <span className="ade-slash-desc">{cmd.description}</span>
              <Badge>{cmd.scope}</Badge>
            </button>
          ))}
        </div>
      ) : null}

      {showMentionMenu ? (
        <div className="ade-slash-menu" role="listbox" aria-label="Files">
          {mentionFiles.map((file, idx) => {
            const slash = file.lastIndexOf("/")
            return (
              <button
                key={file}
                type="button"
                role="option"
                aria-selected={idx === mentionIndex}
                className={`ade-slash-item ${idx === mentionIndex ? "is-selected" : ""}`}
                onMouseEnter={() => onHoverMention(idx)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => onSelectMention(file)}
              >
                <span className="ade-slash-name"><AtSign className="size-3" />{file.slice(slash + 1)}</span>
                <span className="ade-slash-desc">{slash > 0 ? file.slice(0, slash) : ""}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
