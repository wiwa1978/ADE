import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./style.css"
import "./src/ade.css"
import "./src/factory/factory.css"

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
