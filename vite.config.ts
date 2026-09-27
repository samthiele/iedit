/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/iedit/' : '/',
  plugins: [react()],
  test: {
    environment: 'happy-dom',
  },
}))
