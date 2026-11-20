import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"

export function MessageContent({ content }: { content: string }) {
  return <div className="message-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      skipHtml
      components={{
        a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
        img: ({ alt }) => <span>{alt ? `Image: ${alt}` : "Image"}</span>,
      }}
    >{content}</ReactMarkdown>
  </div>
}
