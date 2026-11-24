import { useEffect, useState } from "react"

function checkMobileViewport(): boolean {
  if (typeof window === "undefined") return false
  try {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get("mobile") === "1") return true
    if (sp.get("mobile") === "0") return false
  } catch {
    // Ignore URL parse errors.
  }
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(max-width: 768px)").matches
  }
  return window.innerWidth > 0 && window.innerWidth <= 768
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(checkMobileViewport)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mq = window.matchMedia("(max-width: 768px)")
    const onChange = () => setMobile(checkMobileViewport())
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return mobile
}
