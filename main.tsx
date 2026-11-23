import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./style.css"
import "./src/ade.css"
import "./src/factory/factory.css"
import "./src/settings.css"
import "./src/review.css"

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
