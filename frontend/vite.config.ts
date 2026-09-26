import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Fail if 5173 is taken instead of silently moving to a port the backend's
    // CORS_ORIGINS doesn't allow. Use `npm run dev -- --port 5174` and add that
    // origin to CORS_ORIGINS in backend/.env if you need another port.
    strictPort: true,
    // Loopback only by default. Use `npm run dev -- --host` to expose on your LAN
    // (then add that origin to CORS_ORIGINS in backend/.env).
    host: 'localhost',
    // The bundled examples live in ../examples (outside the frontend root).
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, '..')],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          flow: ['@xyflow/react'],
          markdown: ['react-markdown'],
          ui: ['@iconify/react', 'lucide-react', 'jszip', 'zustand'],
        },
      },
    },
  },
})
