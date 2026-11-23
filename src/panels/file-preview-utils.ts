import type { TimelineToolCall } from "../../app-types"

export type FilePreviewKind = "image" | "svg" | "markdown" | "html" | "pdf" | "code" | "text" | "binary"

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "avif"])
const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"])
const HTML_EXTS = new Set(["html", "htm"])
const TEXT_EXTS = new Set(["txt", "text", "log", "env", "gitignore", "editorconfig"])
const CODE_LANG_MAP: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  ini: "ini",
  csv: "csv",
}

export function getFileExtension(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return ""
  return base.slice(dot + 1).toLowerCase()
}

export function getFilePreviewKind(filePath: string, mimeType?: string, binary?: boolean): FilePreviewKind {
  const ext = getFileExtension(filePath)
  if (ext === "svg" || mimeType === "image/svg+xml") return "svg"
  if (IMAGE_EXTS.has(ext) || (mimeType?.startsWith("image/") ?? false)) return "image"
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf"
  if (MARKDOWN_EXTS.has(ext)) return "markdown"
  if (HTML_EXTS.has(ext)) return "html"
  if (binary) return "binary"
  if (CODE_LANG_MAP[ext]) return "code"
  if (TEXT_EXTS.has(ext) || !ext) return "text"
  return "text"
}

export function getHighlightLanguage(filePath: string, serverLang?: string): string {
  const ext = getFileExtension(filePath)
  if (CODE_LANG_MAP[ext]) return CODE_LANG_MAP[ext]
  if (serverLang && serverLang !== "text" && serverLang !== "binary") return serverLang
  return ""
}

export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type ArtefactFilterBucket = "all" | "plans" | "docs" | "code" | "images"

export function getFileFilterBucket(filePath: string, mimeType?: string): Exclude<ArtefactFilterBucket, "all" | "plans"> {
  const kind = getFilePreviewKind(filePath, mimeType)
  if (kind === "image" || kind === "svg") return "images"
  if (kind === "markdown" || kind === "text" || kind === "pdf" || kind === "html") return "docs"
  return "code"
}

/**
 * Resolves a Markdown link href to a workspace-relative path if it points to a local file
 * (e.g. `poem.txt`, `./src/app.py`, `file:///abs/workspace/poem.txt`, or `/abs/workspace/poem.txt`).
 * Returns null for external web/mailto/hash URLs.
 */
export function resolveLocalFileHref(href: string | undefined, workspacePath?: string | null): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith("#")) return null
  if (/^(https?:|mailto:|tel:|javascript:|data:)/i.test(trimmed)) return null

  let clean = trimmed
  // Strip query/hash fragments like `poem.txt#L1-L2`
  clean = clean.split(/[?#]/)[0] ?? ""
  if (!clean) return null

  try {
    clean = decodeURIComponent(clean)
  } catch {
    // Keep undecoded path if malformed percent-encoding.
  }

  if (clean.startsWith("file://")) {
    clean = clean.slice("file://".length)
  }

  if (workspacePath) {
    const normRoot = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "")
    const normClean = clean.replace(/\\/g, "/")
    if (normClean === normRoot) return null
    if (normClean.startsWith(`${normRoot}/`)) {
      return normClean.slice(normRoot.length + 1)
    }
  }

  // Relative workspace file path (e.g. `poem.txt`, `./docs/readme.md`, `src/app.py`)
  if (!clean.startsWith("/")) {
    return clean.replace(/^\.\//, "")
  }

  return null
}

const FILE_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "edit_files",
  "write_file",
  "create_file",
  "read_file",
  "patch_file",
  "apply_patch",
  "list_files",
  "Write",
  "Edit",
  "MultiEdit",
  "Read",
  "NotebookEdit",
])

export function isFileToolName(name: string): boolean {
  return FILE_TOOL_NAMES.has(name)
}

/**
 * Extracts one or more workspace file paths referenced in a tool call's arguments or details
 * (supports Pi, Claude Code, Codex `edit_files`, `apply_patch`, etc.).
 */
export function extractToolCallFilePaths(tool: TimelineToolCall, workspacePath?: string | null): string[] {
  const found: string[] = []
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return
    let p = raw.trim()
    if (!p) return
    if (workspacePath) {
      const normRoot = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "")
      const normP = p.replace(/\\/g, "/")
      if (normP.startsWith(`${normRoot}/`)) p = normP.slice(normRoot.length + 1)
    }
    p = p.replace(/^\.\//, "")
    if (p && !found.includes(p)) found.push(p)
  }

  const args = tool.arguments ?? {}
  push(args.path)
  push(args.file_path)
  push(args.filePath)
  push(args.target_file)
  push(args.targetFile)
  push(args.filename)

  for (const key of ["files", "edits", "changes", "paths"]) {
    const arr = args[key]
    if (!Array.isArray(arr)) continue
    for (const entry of arr) {
      if (typeof entry === "string") push(entry)
      else if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>
        push(obj.path ?? obj.file_path ?? obj.filePath ?? obj.target_file ?? obj.file)
      }
    }
  }

  // Parse unified patch / apply_patch headers like `*** Add File: poem.txt` or `+++ b/poem.txt`
  const patchText = typeof args.patch === "string"
    ? args.patch
    : typeof args.input === "string"
      ? args.input
      : typeof tool.output === "string" && tool.name === "edit_files"
        ? tool.output
        : ""
  if (patchText) {
    for (const match of patchText.matchAll(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+)$/gm)) {
      push(match[1])
    }
    for (const match of patchText.matchAll(/^\+\+\+\s+b\/(.+)$/gm)) {
      push(match[1])
    }
  }

  const details = tool.details && typeof tool.details === "object" ? (tool.details as Record<string, unknown>) : null
  if (details) {
    push(details.path)
    push(details.filePath)
    if (Array.isArray(details.files)) {
      for (const entry of details.files) {
        if (typeof entry === "string") push(entry)
        else if (entry && typeof entry === "object") {
          const obj = entry as Record<string, unknown>
          push(obj.path ?? obj.filePath)
        }
      }
    }
  }

  return found
}
