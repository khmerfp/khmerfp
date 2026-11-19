import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config.js'

export default defineConfig({
  plugins: [react()],
  // resolve styles from the client folder even when a tool starts vite at the repo root.
  css: {
    postcss: {
      plugins: [tailwindcss({
        ...tailwindConfig,
        content: [
          fileURLToPath(new URL('./index.html', import.meta.url)),
          fileURLToPath(new URL('./src/**/*.{js,jsx}', import.meta.url)),
        ],
      }), autoprefixer()],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
  server: {
    // ngrok uses its public hostname as the Host header when forwarding to
    // Vite. This allowance applies only to the local dev server, never builds.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  
})
