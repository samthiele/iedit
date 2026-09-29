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
    res.setHeader('Content-Type', name.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'text/plain; charset=utf-8')
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

const FIXTURES = ['wordChatLog.txt', 'latexChatLog.txt', 'testManuscript.docx', 'testLatex.tex'] as const

function fixtureName(url: string | undefined): (typeof FIXTURES)[number] | null {
  const pathOnly = url?.split('?')[0] ?? ''
  return FIXTURES.find((name) => pathOnly.endsWith(`/__fixtures/${name}`)) ?? null
}

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/iedit/' : '/',
  plugins: [react(), testFixtures()],
  test: {
    environment: 'happy-dom',
  },
}))
