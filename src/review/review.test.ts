import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportDocx } from '../export/docx.ts'
import { exportTex } from '../export/tex.ts'
import { parseDocx } from '../parse/docx.ts'
import { parseTex } from '../parse/tex.ts'
import { bindEdits, extractEditFence, parseEditBody } from '../review/edits.ts'
import { locateSpan } from '../review/span.ts'
import { wordDiff } from '../review/diff.ts'
import type { Suggestion } from '../review/types.ts'

describe('locateSpan', () => {
  it('matches across line breaks', () => {
    const found = locateSpan('The late\ncretaceous sandstone.', 'The late cretaceous')
    expect(found?.actual).toBe('The late\ncretaceous')
  })
})

describe('edit fence', () => {
  it('binds a verbatim replacement and a science note', () => {
    const text = `Tightened the age term.

\`\`\`iedit-edits
### p-001
~~late cretaceous~~
**<u>Upper Cretaceous</u>**
[COMMENT-COPYEDIT: Capitalise the formal time unit.]

### p-001
[COMMENT-SCIENCE: The age is not tied to a cited source.]
\`\`\`
`
    const extracted = extractEditFence(text)
    const paragraphs = [{
      id: 'p-001',
      text: 'The late cretaceous sandstone is thick.',
      kind: 'body' as const,
      section: 'Introduction',
      inTable: false,
    }]
    const bound = bindEdits(parseEditBody(extracted.body), paragraphs, { idPrefix: 'c1', grounded: false })
    expect(extracted.summary).toContain('Tightened')
    expect(bound.suggestions).toHaveLength(2)
    expect(bound.suggestions[0].find).toBe('late cretaceous')
    expect(bound.suggestions[0].segments.some((segment) => segment.type === 'insert' && segment.text.includes('Upper'))).toBe(true)
    expect(bound.suggestions[1].author).toBe('AI-science')
    expect(bound.unmatched).toEqual([])
  })
})

describe('tex export', () => {
  it('keeps a pending sentence as a change and writes an accepted one into the source', () => {
    const source = '\\documentclass{article}\n\\begin{document}\nThe late cretaceous sandstone is thick.\n\\end{document}\n'
    const loaded = parseTex('paper.tex', source)
    const paraId = loaded.paragraphs.find((item) => item.text.includes('cretaceous'))!.id
    const pending = accepted({
      paraId,
      find: 'late cretaceous',
      insert: 'Upper Cretaceous',
      comment: 'Capitalise the formal time unit.',
      author: 'AI-copyedit',
    })
    pending.status = 'pending'
    const marked = exportTex(loaded, [pending])
    expect(marked).toContain('\\replaced[id=AI-copyedit]{Upper Cretaceous}{late cretaceous}')
    expect(marked).toContain('\\pdfcomment')
    expect(marked.indexOf('\\usepackage[markup=default]{changes}')).toBeLessThan(marked.indexOf('\\begin{document}'))

    const applied = exportTex(loaded, [{ ...pending, status: 'accepted' }])
    expect(applied).toContain('The Upper Cretaceous sandstone is thick.')
    expect(applied).not.toContain('\\replaced')
    expect(applied).not.toContain('\\pdfcomment')
  })
})

describe('docx export', () => {
  it('writes a pending edit as a revision and an accepted edit as plain text', async () => {
    const buffer = await sampleDocx(['The late ', 'cretaceous sandstone is thick.'])
    const loaded = await parseDocx('paper.docx', buffer)
    const find = 'late cretaceous'
    const insert = 'Upper Cretaceous'
    const start = loaded.paragraphs[0].text.indexOf(find)
    const suggestion = accepted({
      paraId: 'p-001',
      find,
      insert,
      comment: 'Capitalise the formal time unit.',
      author: 'AI-copyedit',
    })
    suggestion.status = 'pending'
    suggestion.span = { start, end: start + find.length }
    suggestion.segments = wordDiff(find, insert)
    const edited = await exportDocx(loaded, [suggestion])
    const zip = await JSZip.loadAsync(edited)
    const xml = await zip.file('word/document.xml')!.async('string')
    const comments = await zip.file('word/comments.xml')!.async('string')
    expect(xml).toContain('late cretaceous')
    expect(xml).toContain('Upper Cretaceous')
    expect(xml).toMatch(/<w:del[\s>]/)
    expect(xml).toMatch(/<w:ins[\s>]/)
    expect(xml).toContain('commentRangeStart')
    expect(comments).toContain('AI-copyedit')
    expect(comments).toContain('Capitalise the formal time unit.')

    const applied = await exportDocx(loaded, [{ ...suggestion, status: 'accepted' }])
    const appliedZip = await JSZip.loadAsync(applied)
    const appliedXml = await appliedZip.file('word/document.xml')!.async('string')
    expect(appliedXml).toContain('Upper Cretaceous')
    expect(appliedXml).not.toContain('late cretaceous')
    expect(appliedXml).not.toMatch(/<w:del[\s>]/)
    expect(appliedXml).not.toMatch(/<w:ins[\s>]/)
    expect(appliedZip.file('word/comments.xml')).toBeNull()
  })
})

function accepted(partial: Pick<Suggestion, 'paraId' | 'find' | 'insert' | 'comment' | 'author'>): Suggestion {
  return {
    id: 't1',
    status: 'accepted',
    span: { start: 4, end: 19 },
    segments: [],
    grounded: false,
    ...partial,
  }
}

async function sampleDocx(runs: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>${runs.map((run) => `<w:r><w:t xml:space="preserve">${run}</w:t></w:r>`).join('')}</w:p>
  </w:body>
</w:document>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}
