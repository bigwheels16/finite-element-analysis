import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // The AGPL requires offering users the source, so release builds must link to it
  if (command === 'build' && !process.env.VITE_SOURCE_URL) {
    throw new Error('Set VITE_SOURCE_URL to the public repository URL for release builds')
  }
  return {
    plugins: [react()],
    worker: {
      format: 'es',
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      watch: {
        usePolling: true,
      },
    },
  }
})
