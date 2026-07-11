import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built index.html loads correctly under
  // Electron's file:// protocol, not just from an HTTP server root.
  base: './',
})
