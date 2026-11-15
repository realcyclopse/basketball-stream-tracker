import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // relative asset URLs so the build can be hosted at any path
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  }
})
