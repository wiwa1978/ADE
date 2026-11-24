/**
 * Dynamic spinning orbital indicator shown on active ("working") threads
 * across the sidebar, inbox, project session list, and mobile shell.
 */
export function ActiveThreadSpinner({
  size = 14,
  className = "",
  title = "Working",
  decorative = false,
}: {
  size?: number
  className?: string
  title?: string
  /** Set true when adjacent visible text already announces the state (e.g. "Working"). */
  decorative?: boolean
}) {
  return (
    <span
      className={`ade-thread-spinner ${className}`.trim()}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="ade-thread-spinner-svg"
      >
        <g className="ade-thread-spinner-ring">
          <path
            d="M 8 2.4 A 5.6 5.6 0 0 1 13.33 6.27"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            opacity="1"
          />
          <path
            d="M 8 2.4 A 5.6 5.6 0 0 1 13.33 6.27"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            opacity="0.65"
            transform="rotate(120 8 8)"
          />
          <path
            d="M 8 2.4 A 5.6 5.6 0 0 1 13.33 6.27"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            opacity="0.32"
            transform="rotate(240 8 8)"
          />
        </g>
        <circle
          cx="8"
          cy="8"
          r="1.45"
          fill="currentColor"
          className="ade-thread-spinner-core"
        />
      </svg>
    </span>
  )
}
