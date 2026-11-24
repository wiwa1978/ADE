import { Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { IconButton } from "./icon-button"
import { Input } from "./input"

export interface KeyValuePair {
  key: string
  value: string
}

export interface KeyValueListEditorProps {
  items: readonly KeyValuePair[]
  onChange: (items: KeyValuePair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
  removeLabel?: string
  emptyText?: string
  secretValues?: boolean
  disabled?: boolean
  className?: string
}

export function KeyValueListEditor({
  items,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
  addLabel = "Add entry",
  removeLabel = "Remove entry",
  emptyText,
  secretValues = false,
  disabled = false,
  className,
}: KeyValueListEditorProps) {
  const updateItem = (index: number, patch: Partial<KeyValuePair>) => {
    const next = items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    onChange(next)
  }

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  const addItem = () => {
    onChange([...items, { key: "", value: "" }])
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {items.length === 0 && emptyText ? (
        <p className="text-xs text-[rgb(var(--muted))]">{emptyText}</p>
      ) : null}
      {items.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            inputSize="sm"
            value={row.key}
            placeholder={keyPlaceholder}
            disabled={disabled}
            spellCheck={false}
            aria-label={`${keyPlaceholder} ${idx + 1}`}
            onChange={e => updateItem(idx, { key: e.target.value })}
            className="w-[160px] shrink-0 font-mono"
          />
          <Input
            inputSize="sm"
            type={secretValues ? "password" : "text"}
            value={row.value}
            placeholder={valuePlaceholder}
            disabled={disabled}
            spellCheck={false}
            aria-label={`${valuePlaceholder} ${idx + 1}`}
            onChange={e => updateItem(idx, { value: e.target.value })}
            className="flex-1 font-mono"
          />
          <IconButton
            aria-label={removeLabel}
            disabled={disabled}
            onClick={() => removeItem(idx)}
          >
            <Trash2 />
          </IconButton>
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={addItem}>
          <Plus /> {addLabel}
        </Button>
      </div>
    </div>
  )
}
