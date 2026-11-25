import { useState } from "react"
import { FolderOpen } from "lucide-react"
import { request } from "../../src/api"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { Input } from "./input"

export interface FolderPathInputProps {
  value: string
  onChange: (path: string) => void
  onPicked?: (path: string) => void | Promise<void>
  placeholder?: string
  browseLabel?: string
  browseTitle?: string
  disabled?: boolean
  id?: string
  "aria-label"?: string
  "aria-describedby"?: string
  className?: string
  inputClassName?: string
}

export function FolderPathInput({
  value,
  onChange,
  onPicked,
  placeholder = "/Users/you/Code/your-repository",
  browseLabel = "Browse",
  browseTitle = "Browse for a local folder",
  disabled = false,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  className,
  inputClassName,
}: FolderPathInputProps) {
  const [picking, setPicking] = useState(false)

  const handleBrowse = async () => {
    if (disabled || picking) return
    setPicking(true)
    try {
      const res = await request<{ path: string | null }>("/api/system/pick-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      if (res.path) {
        onChange(res.path)
        await onPicked?.(res.path)
      }
    } catch {
      // Native folder picker may be unavailable on headless hosts.
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        spellCheck={false}
        className={cn("flex-1 min-w-0", inputClassName)}
      />
      <Button
        variant="secondary"
        size="md"
        loading={picking}
        disabled={disabled}
        title={browseTitle}
        onClick={() => void handleBrowse()}
        className="shrink-0"
      >
        {!picking ? <FolderOpen /> : null}
        {browseLabel}
      </Button>
    </div>
  )
}
