import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['bot.localhost'],
    watch: { ignored: ['**/node_modules/**'] },
    // changeOrigin false conserva el Host que valida la API
    proxy: { '/api': { target: 'http://bot:3000', changeOrigin: false } },
  },
})
