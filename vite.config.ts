/// <reference types="vitest/config" />
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

function testFixtures(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const name = fixtureName(req.url)
    if (!name) {
      next()
      return
    }
    const file = path.join(root, 'test', name)
    if (!existsSync(file)) {
      res.statusCode = 404
      res.end('Fixture not found')
      return
    }
    res.setHeader('Content-Type', name.endsWith('.txt')
      ? 'text/plain; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    createReadStream(file).pipe(res)
  }
  return {
    name: 'iedit-test-fixtures',
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
  }
}

function fixtureName(url: string | undefined): 'chatLog.txt' | 'testManuscript.docx' | null {
  const pathOnly = url?.split('?')[0] ?? ''
  if (pathOnly.endsWith('/__fixtures/chatLog.txt')) return 'chatLog.txt'
  if (pathOnly.endsWith('/__fixtures/testManuscript.docx')) return 'testManuscript.docx'
  return null
}

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/iedit/' : '/',
  plugins: [react(), testFixtures()],
  test: {
    environment: 'happy-dom',
  },
}))
