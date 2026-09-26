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
    // Loopback only by default. Use `npm run dev -- --host` to expose on your LAN
    // (then add that origin to CORS_ORIGINS in backend/.env).
    host: 'localhost',
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
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
