import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exportDocx } from '../export/docx.ts'
import { parseDocx } from '../parse/docx.ts'
import { isEditable, type LoadedDocument } from '../review/types.ts'
import { systemInstruction, BUILTIN_DISCIPLINES } from '../skills/index.ts'
import { runReview } from './runReview.ts'

const apiKey = process.env.GEMINI_API_KEY ?? ''
const model = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite'

describe.skipIf(!apiKey)('live Gemini review', () => {
  it('copyedits a slice of the test manuscript and can write those edits back', async () => {
    const bytes = readFileSync('testManuscript.docx')
    const loaded = await parseDocx('testManuscript.docx', toArrayBuffer(bytes))
    const slice = pickSlice(loaded)
    const includeScience = process.env.GEMINI_SCIENCE === '1'
    const session = await runReview({
      provider: 'gemini',
      apiKey,
      model,
      systemInstruction: systemInstruction(BUILTIN_DISCIPLINES[0].body),
      document: { ...loaded, paragraphs: slice },
      includeScience,
      chunkChars: 36000,
      disciplineTitle: 'Geoscience',
      onProgress: () => undefined,
    })

    if (process.env.GEMINI_DEBUG === '1') {
      const first = session.suggestions[0]
      console.log(JSON.stringify({
        suggestions: session.suggestions.length,
        wording: session.suggestions.filter((item) => item.find).length,
        science: session.suggestions.filter((item) => item.author === 'AI-science').length,
        sources: session.sources.length,
        scienceError: session.scienceError,
        summary: session.summary.slice(0, 500),
        first: first ? { paraId: first.paraId, author: first.author, find: first.find.slice(0, 120), comment: first.comment.slice(0, 240) } : null,
      }, null, 2))
    }

    const accepted = session.suggestions.map((suggestion) => ({ ...suggestion, status: 'accepted' as const }))
    const wording = accepted.filter((suggestion) => suggestion.find)
    expect(wording.length, session.warnings.join('\n') || session.summary).toBeGreaterThan(0)
    const edited = await exportDocx({ ...loaded, paragraphs: slice }, wording)
    expect(edited.byteLength).toBeGreaterThan(1000)
    if (includeScience) {
      expect(session.scienceError, session.warnings.join('\n')).toBeNull()
      expect(session.suggestions.some((item) => item.author === 'AI-science')).toBe(true)
    }
  }, 180_000)
})

function pickSlice(document: LoadedDocument) {
  const editable = document.paragraphs.filter((paragraph) => isEditable(paragraph.kind))
  const focused = editable.filter((paragraph) => /abstract|introduction/i.test(paragraph.section))
  const source = focused.length >= 3 ? focused : editable
  const picked = []
  let size = 0
  for (const paragraph of source) {
    if (picked.length >= 4 || size > 2500) break
    picked.push(paragraph)
    size += paragraph.text.length
  }
  return picked
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
