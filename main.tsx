import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./style.css"
import "./src/ade.css"
import "./src/settings.css"
import "./src/review.css"
import "./src/ui-controls.css"

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)

if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  (window.location.protocol === "https:" || window.location.protocol === "http:") &&
  !window.location.hostname.endsWith("tauri.localhost")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  })
}
