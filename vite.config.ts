import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const uiPort = Number(process.env.ADE_UI_PORT ?? 1420)
const runtimePort = Number(process.env.ADE_RUNTIME_PORT ?? 4319)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  clearScreen: false,
  server: {
    port: uiPort,
    strictPort: true,
    proxy: {
      "/api/": {
        target: `http://127.0.0.1:${runtimePort}`,
        changeOrigin: true,
      },
    },
  },
})
