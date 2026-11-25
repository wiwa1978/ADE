import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { resolveLocalFileHref } from "./panels/file-preview-utils"

export function MessageContent({
  content,
  onOpenFile,
  workspacePath,
}: {
  content: string
  onOpenFile?: (path: string) => void
  workspacePath?: string | null
}) {
  return <div className="message-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      skipHtml
      components={{
        a: ({ children, href, title }) => {
          const localPath = onOpenFile ? resolveLocalFileHref(href, workspacePath) : null
          if (localPath && onOpenFile) {
            return (
              <a
                href={href}
                className="ade-inline-file-link"
                title={title || `Open ${localPath} in right sidebar`}
                onClick={e => {
                  e.preventDefault()
                  onOpenFile(localPath)
                }}
              >
                {children}
              </a>
            )
          }
          return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
        },
        img: ({ alt }) => <span>{alt ? `Image: ${alt}` : "Image"}</span>,
      }}
    >{content}</ReactMarkdown>
  </div>
}
