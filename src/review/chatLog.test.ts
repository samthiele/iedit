import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocx } from '../parse/docx.ts'
import { parseTex } from '../parse/tex.ts'
import { parseChatLog, sessionFromChatLog } from './chatLog.ts'
import { appRoute } from '../route.ts'

const logPath = 'test/wordChatLog.txt'
const manuscriptPath = 'test/testManuscript.docx'

describe('saved chat log', () => {
  const log = readFileSync(logPath, 'utf8')

  it('keeps the system prompt and the model reply', () => {
    const parsed = parseChatLog(log)
    expect(parsed.system).toContain('Scientific writing')
    expect(parsed.turns.filter((turn) => turn.role === 'model')).toHaveLength(1)
    expect(parsed.turns.at(-1)?.text).toContain('```iedit-edits')
  })

  it('recognises the test route under the site base', () => {
    expect(appRoute('/test')).toBe('test')
    expect(appRoute('/iedit/test', '/iedit/')).toBe('test')
    expect(appRoute('/iedit/', '/iedit/')).toBe('home')
  })

  it.skipIf(!existsSync(manuscriptPath))('binds the saved reply onto the manuscript', async () => {
    const bytes = readFileSync(manuscriptPath)
    const loaded = await parseDocx('testManuscript.docx', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const session = sessionFromChatLog(loaded, parseChatLog(log))
    const copy = session.suggestions.find((suggestion) => suggestion.paraId === 'p-010' && suggestion.author === 'AI-copyedit')
    const science = session.suggestions.find((suggestion) => suggestion.author === 'AI-science')
    expect(session.summary.toLowerCase()).toContain('clarity')
    expect(session.disciplineTitle).toBe('Geoscience')
    expect(copy?.span).not.toBeNull()
    expect(copy?.comment).toContain('Significantly')
    expect(science?.paraId).toBe('p-035')
    expect(science?.span).toBeNull()
  })
})

describe('saved latex chat log', () => {
  it('binds the saved reply onto the latex manuscript', () => {
    const loaded = parseTex('testLatex.tex', readFileSync('test/testLatex.tex', 'utf8'))
    const session = sessionFromChatLog(loaded, parseChatLog(readFileSync('test/latexChatLog.txt', 'utf8')))
    const copy = session.suggestions.filter((suggestion) => suggestion.author === 'AI-copyedit')
    const science = session.suggestions.find((suggestion) => suggestion.author === 'AI-science')
    expect(session.warnings).toEqual([])
    expect(copy.length).toBeGreaterThan(0)
    expect(copy.every((suggestion) => suggestion.span)).toBe(true)
    expect(science?.span).toBeNull()
    expect(session.disciplineTitle).toBe('Geoscience')
  })
})
