export function ProviderGlyph({ provider, size = 16 }: { provider: string; size?: number }) {
  if (provider === "anthropic" || provider === "claude") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <g stroke="#d97757" strokeWidth="2.1" strokeLinecap="round">
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
          <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
        </g>
      </svg>
    )
  }
  if (provider === "openai" || provider === "codex") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="2.2" />
        <rect x="8.5" y="7.5" width="7" height="9" rx="1" fill="currentColor" opacity="0.55" />
      </svg>
    )
  }
  if (provider === "github-copilot" || provider === "copilot") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path
          d="M6.5 10.5C6.5 7.5 8.8 5.5 12 5.5C15.2 5.5 17.5 7.5 17.5 10.5V15.5C17.5 17 16.3 18 14.8 18H9.2C7.7 18 6.5 17 6.5 15.5V10.5Z"
          stroke="currentColor"
          strokeWidth="1.9"
        />
        <circle cx="9.8" cy="12" r="1.4" fill="currentColor" />
        <circle cx="14.2" cy="12" r="1.4" fill="currentColor" />
        <path d="M4 11.5V14.5M20 11.5V14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (provider === "radius" || provider === "pi") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="shrink-0">
        <rect x="3" y="3" width="4.2" height="14" rx="0.6" />
        <rect x="3" y="3" width="10.5" height="4.2" rx="0.6" />
        <rect x="9.3" y="7.2" width="4.2" height="4.2" rx="0.6" />
        <rect x="13.5" y="12.5" width="3.5" height="4.5" rx="0.6" />
      </svg>
    )
  }
  if (provider === "oh-my-pi") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="shrink-0">
        <rect x="2.5" y="4" width="3.8" height="12.5" rx="0.6" />
        <rect x="2.5" y="4" width="9.5" height="3.8" rx="0.6" />
        <rect x="8.2" y="7.8" width="3.8" height="3.8" rx="0.6" />
        <circle cx="15.5" cy="5.5" r="2.1" fill="#d97757" />
        <rect x="12.8" y="12.2" width="3.8" height="4.3" rx="0.6" />
      </svg>
    )
  }
  if (provider === "opencode") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M8 9.5L11 12L8 14.5M12.5 14.5H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "antigravity") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M12 3.5L19 19.5H15.2L12 11.8L8.8 19.5H5L12 3.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "muse-code") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M4.5 18V6L12 13L19.5 6V18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "hermes") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M13 3L5.5 13H12L11 21L18.5 11H12L13 3Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "cursor") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M5.5 4L18.5 11.2L12.3 13.1L10.1 19.5L5.5 4Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "devin") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M6 5H12.5C16.2 5 18.5 7.7 18.5 12C18.5 16.3 16.2 19 12.5 19H6V5Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  )
}
