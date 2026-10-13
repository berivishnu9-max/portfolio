import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://berivishnu9-max.github.io/portfolio/
export default defineConfig({
  base: '/portfolio/',
  plugins: [react()],
})
