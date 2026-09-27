import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportDocx } from '../export/docx.ts'
import { parseDocx } from './docx.ts'
import { wordDiff } from '../review/diff.ts'
import type { Suggestion } from '../review/types.ts'

const manuscriptPath = 'testManuscript.docx'
const hasManuscript = existsSync(manuscriptPath)

describe.skipIf(!hasManuscript)('testManuscript.docx', () => {
  it('reads prose paragraphs and writes a revision back into the original package', async () => {
    const loaded = await parseDocx(manuscriptPath, toArrayBuffer(readFileSync(manuscriptPath)))
    const prose = loaded.paragraphs.filter((paragraph) => paragraph.kind === 'body' && paragraph.text.length > 80)
    expect(prose.length).toBeGreaterThan(5)

    const paragraph = prose[0]
    const sentence = paragraph.text.split(/(?<=\.)\s/)[0]
    expect(sentence.length).toBeGreaterThan(20)
    const insert = sentence.replace(/\s\S+$/, ' revised.')
    const start = paragraph.text.indexOf(sentence)
    const suggestion: Suggestion = {
      id: 'live-1',
      paraId: paragraph.id,
      find: sentence,
      insert,
      comment: 'Trial revision on the test manuscript.',
      author: 'AI-copyedit',
      status: 'pending',
      span: { start, end: start + sentence.length },
      segments: wordDiff(sentence, insert),
      grounded: false,
    }

    const edited = await exportDocx(loaded, [suggestion])
    const zip = await JSZip.loadAsync(edited)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('w:del')
    expect(xml).toContain('w:ins')
    expect(await zip.file('word/comments.xml')!.async('string')).toContain('Trial revision')
    expect(Object.keys(zip.files).length).toBeGreaterThan(4)
  })
})

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
