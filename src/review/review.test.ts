import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportDocx } from '../export/docx.ts'
import { exportTex } from '../export/tex.ts'
import { parseDocx } from '../parse/docx.ts'
import { parseTex } from '../parse/tex.ts'
import { bindEdits, extractEditFence, parseEditBody } from '../review/edits.ts'
import { locateFormatted } from '../review/richText.ts'
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

  it('binds a repeated phrase to the next occurrence', () => {
    const paragraphs = [{
      id: 'p-001',
      text: 'the cat and the dog',
      kind: 'body' as const,
      section: 'Introduction',
      inTable: false,
    }]
    const edits = [
      { paraId: 'p-001', find: 'the', insert: 'a', comment: 'First.', author: 'AI-copyedit' as const },
      { paraId: 'p-001', find: 'the', insert: 'that', comment: 'Second.', author: 'AI-copyedit' as const },
    ]
    const bound = bindEdits(edits, paragraphs, { idPrefix: 'c', grounded: false })
    expect(bound.unmatched).toEqual([])
    expect(bound.suggestions.map((suggestion) => suggestion.span)).toEqual([
      { start: 0, end: 3 },
      { start: 12, end: 15 },
    ])
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
    expect(marked).toContain('The \\pdfcomment[author={AI-copyedit},icon=Comment]{Capitalise the formal time unit.}{\\color{red}\\sout{late cretaceous}}{\\color{blue}Upper Cretaceous} sandstone is thick.')
    expect(marked).not.toContain('Suggested:')
    expect(marked).not.toContain('\\pdfmarkupcomment')
    expect(marked.indexOf('\\usepackage{xcolor}')).toBeLessThan(marked.indexOf('\\begin{document}'))
    expect(marked.indexOf('\\usepackage[normalem]{ulem}')).toBeLessThan(marked.indexOf('\\begin{document}'))
    expect(marked.indexOf('\\usepackage{pdfcomment}')).toBeLessThan(marked.indexOf('\\begin{document}'))
    expect(marked).toContain('\\documentclass{article}')

    const applied = exportTex(loaded, [{ ...pending, status: 'accepted' }])
    expect(applied).toContain('The Upper Cretaceous sandstone is thick.')
    expect(applied).not.toContain('late cretaceous')
    expect(applied).not.toContain('\\pdfcomment')
    expect(applied).not.toContain('\\pdfmarkupcomment')
    expect(applied).not.toContain('\\usepackage{pdfcomment}')

    const percentEdit = exportTex(loaded, [{ ...pending, status: 'accepted', insert: '50% of the unit' }])
    expect(percentEdit).toContain('50\\% of the unit')
    expect(percentEdit).not.toContain('\\pdfcomment')

    const note = accepted({
      paraId,
      find: '',
      insert: '',
      comment: 'The age is not tied to a cited source.',
      author: 'AI-science',
    })
    note.status = 'pending'
    const commented = exportTex(loaded, [note])
    expect(commented).toContain('\\pdfcomment[author={AI-science},icon=Comment]{The age is not tied to a cited source.}')
    expect(commented).toContain('The late cretaceous sandstone is thick.')

    const percent = { ...note, comment: 'About 50% of the variance.' }
    const escaped = exportTex(loaded, [percent])
    expect(escaped).toContain('\\pdfcomment[author={AI-science},icon=Comment]{About 50\\% of the variance.}')
    expect(escaped).toContain('sandstone is thick.')

    const prior = parseTex('paper.tex', source.replace('\\begin{document}', '\\usepackage{pdfcomment}\n\\begin{document}'))
    const priorId = prior.paragraphs.find((item) => item.text.includes('cretaceous'))!.id
    const kept = exportTex(prior, [{ ...pending, paraId: priorId }])
    expect(kept.match(/\\usepackage\{pdfcomment\}/g)).toHaveLength(1)
  })

  it('shows prose and headings, and writes an accepted edit back inside the command', () => {
    const source = [
      '\\documentclass{article}',
      '\\begin{document}',
      '',
      '\\begin{comment}',
      '\\section*{Hidden}',
      'secret highlight',
      '\\end{comment}',
      '',
      '\\pagenumbering{arabic}',
      '',
      '\\title{Forest mapping}',
      '',
      '\\section{The \\textbf{offset}}',
      '',
      '\\textbf{The late} cretaceous sandstone is thick \\citep{heap2021}.',
      '',
      '\\end{document}',
      '',
    ].join('\n')
    const loaded = parseTex('paper.tex', source)
    const visible = loaded.paragraphs.filter((item) => item.kind !== 'preamble').map((item) => item.text)
    expect(visible.join('\n')).not.toContain('secret')
    expect(visible.join('\n')).not.toContain('Hidden')
    expect(visible.join('\n')).not.toContain('arabic')
    expect(visible.join('\n')).not.toContain('\\')
    const title = loaded.paragraphs.find((item) => item.text === 'Forest mapping')
    const heading = loaded.paragraphs.find((item) => item.text === 'The offset')
    const sentence = loaded.paragraphs.find((item) => item.text.includes('cretaceous'))
    expect(title?.kind).toBe('heading')
    expect(title?.level).toBe(1)
    expect(heading?.kind).toBe('heading')
    expect(heading?.marks?.[0]).toMatchObject({ style: 'bold', start: 4, end: 10 })
    expect(sentence?.text).toBe('The late cretaceous sandstone is thick.')
    expect(sentence?.marks?.[0]).toMatchObject({ style: 'bold', start: 0, end: 8 })
    const located = locateFormatted(sentence!, 'late')
    expect(located?.actual).toBe('late')
    const suggestion = accepted({
      paraId: sentence!.id,
      find: 'late',
      insert: 'Upper',
      comment: 'Capitalise the time word.',
      author: 'AI-copyedit',
    })
    suggestion.span = { start: located!.start, end: located!.end }
    const applied = exportTex(loaded, [{ ...suggestion, status: 'accepted' }])
    expect(applied).toContain('\\textbf{The Upper} cretaceous sandstone is thick \\citep{heap2021}.')
    expect(applied).not.toContain('\\pdfcomment')

    const crossed = accepted({
      paraId: sentence!.id,
      find: 'late cretaceous',
      insert: 'Upper Cretaceous',
      comment: 'Capitalise the formal time unit.',
      author: 'AI-copyedit',
    })
    const crossedAt = locateFormatted(sentence!, 'late cretaceous')
    crossed.span = { start: crossedAt!.start, end: crossedAt!.end }
    const crossedFile = exportTex(loaded, [crossed])
    expect(crossedFile).toContain('\\textbf{The Upper Cretaceous} sandstone is thick \\citep{heap2021}.')
    expect(crossedFile).not.toContain('\\pdfcomment')
    expect(crossedFile).not.toContain('late')

    const inside = { ...suggestion, status: 'pending' as const }
    const pendingInside = exportTex(loaded, [inside])
    expect(pendingInside).toContain('\\textbf{The \\pdfcomment[author={AI-copyedit},icon=Comment]{Capitalise the time word.}{\\color{red}\\sout{late}}{\\color{blue}Upper}}')
    expect(pendingInside).not.toContain('Suggested:')
    expect(pendingInside).not.toContain('\\pdfmarkupcomment')
    const headingEdit = accepted({
      paraId: heading!.id,
      find: 'offset',
      insert: 'shift',
      comment: 'Use the plainer noun.',
      author: 'AI-copyedit',
    })
    const headingAt = locateFormatted(heading!, 'offset')
    headingEdit.span = { start: headingAt!.start, end: headingAt!.end }
    const headed = exportTex(loaded, [{ ...headingEdit, status: 'accepted' }])
    expect(headed).toContain('\\section{The \\textbf{shift}}')

    const across = accepted({
      paraId: sentence!.id,
      find: 'thick.',
      insert: 'massive.',
      comment: 'Prefer the plainer adjective.',
      author: 'AI-copyedit',
    })
    across.status = 'pending'
    const acrossAt = locateFormatted(sentence!, 'thick.')
    across.span = { start: acrossAt!.start, end: acrossAt!.end }
    const noted = exportTex(loaded, [across])
    expect(noted).toContain('\\pdfcomment[author={AI-copyedit},icon=Comment]{Prefer the plainer adjective. Suggested: massive.}thick \\citep{heap2021}.')
    expect(noted).not.toContain('\\pdfmarkupcomment')
  })

  it('writes a percent note inside a list and a table', () => {
    const source = [
      '\\documentclass{article}',
      '\\begin{document}',
      '',
      '\\begin{itemize}',
      '\\item The late sandstone is thick.',
      '\\end{itemize}',
      '',
      '\\begin{tabular}{ll}',
      'sandstone & thick \\\\',
      '\\end{tabular}',
      '',
      '\\end{document}',
      '',
    ].join('\n')
    const loaded = parseTex('paper.tex', source)
    const item = loaded.paragraphs.find((paragraph) => paragraph.text.includes('late sandstone'))
    const cell = loaded.paragraphs.find((paragraph) => paragraph.text.includes('thick') && paragraph.kind === 'table')
      ?? loaded.paragraphs.find((paragraph) => paragraph.text.includes('sandstone') && paragraph.text.includes('thick') && paragraph !== item)
    expect(item).toBeTruthy()
    expect(cell).toBeTruthy()
    const itemEdit = accepted({
      paraId: item!.id,
      find: 'late',
      insert: 'Upper',
      comment: 'Capitalise the time word.',
      author: 'AI-copyedit',
    })
    itemEdit.status = 'pending'
    const itemAt = item!.text.indexOf('late')
    itemEdit.span = { start: itemAt, end: itemAt + 'late'.length }
    const listed = exportTex(loaded, [itemEdit])
    expect(listed).toContain('\\item The {\\color{red}\\sout{late}}{\\color{blue}Upper} sandstone is thick.\n% iEdit (AI-copyedit): Capitalise the time word.')
    expect(listed).not.toContain('Suggested:')
    expect(listed).not.toContain('\\pdfcomment')
    expect(listed).not.toContain('\\usepackage{pdfcomment}')
    expect(listed).toContain('\\usepackage{xcolor}')
    expect(listed).toContain('\\usepackage[normalem]{ulem}')

    const cellEdit = accepted({
      paraId: cell!.id,
      find: 'thick',
      insert: 'massive',
      comment: 'Prefer the plainer adjective.',
      author: 'AI-science',
    })
    cellEdit.status = 'pending'
    const cellAt = cell!.text.indexOf('thick')
    cellEdit.span = { start: cellAt, end: cellAt + 'thick'.length }
    const tabled = exportTex(loaded, [cellEdit])
    expect(tabled).toContain('sandstone & {\\color{red}\\sout{thick}}{\\color{blue}massive} \\\\\n% iEdit (AI-science): Prefer the plainer adjective.')
    expect(tabled).not.toContain('Suggested:')
    expect(tabled).not.toContain('\\pdfcomment')
  })

  it('loads a package that is only named inside a comment', () => {
    const source = [
      '\\documentclass{article}',
      '% This uses \\usepackage{xcolor}, \\usepackage[normalem]{ulem}, and \\usepackage{pdfcomment}',
      '\\begin{document}',
      'The late cretaceous sandstone is thick.',
      '\\end{document}',
      '',
    ].join('\n')
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
    const code = marked.split('\n').filter((line) => !line.trimStart().startsWith('%'))
    expect(code.some((line) => line.includes('\\usepackage{xcolor}'))).toBe(true)
    expect(code.some((line) => line.includes('\\usepackage[normalem]{ulem}'))).toBe(true)
    expect(code.some((line) => line.includes('\\usepackage{pdfcomment}'))).toBe(true)
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

  it('anchors a comment that starts inside a link and ends in the following run', async () => {
    const buffer = await docxBody(`<w:p>
      <w:hyperlink><w:r><w:t>See the paper</w:t></w:r></w:hyperlink>
      <w:r><w:t> for the age of the sandstone.</w:t></w:r>
    </w:p>`)
    const loaded = await parseDocx('paper.docx', buffer)
    const suggestion = accepted({
      paraId: loaded.paragraphs[0].id,
      find: '',
      insert: '',
      comment: 'Check the citation.',
      author: 'AI-science',
    })
    suggestion.status = 'pending'
    suggestion.span = null
    suggestion.segments = []
    const edited = await exportDocx(loaded, [suggestion])
    const zip = await JSZip.loadAsync(edited)
    const xml = await zip.file('word/document.xml')!.async('string')
    const comments = await zip.file('word/comments.xml')!.async('string')
    expect(xml).toContain('commentRangeStart')
    expect(xml).toContain('See the paper')
    expect(comments).toContain('Check the citation.')
  })

  it('reads a rectangular table as a pipe table and writes a cell edit back', async () => {
    const buffer = await docxBody(`
      <w:p><w:r><w:t>Before the table.</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Short name</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>Target</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>H2O</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:t>After the table.</w:t></w:r></w:p>
    `)
    const loaded = await parseDocx('table.docx', buffer)
    expect(loaded.paragraphs.map((paragraph) => paragraph.kind)).toEqual(['body', 'table', 'body'])
    const table = loaded.paragraphs[1]
    expect(table.text).toBe([
      '| Short name | Target |',
      '| --- | --- |',
      '| H2O | a\\|b |',
    ].join('\n'))

    const find = 'a\\|b'
    const start = table.text.indexOf(find)
    const suggestion = accepted({
      paraId: table.id,
      find,
      insert: 'hydroxyl',
      comment: 'Name the absorption.',
      author: 'AI-copyedit',
    })
    suggestion.span = { start, end: start + find.length }
    suggestion.segments = wordDiff(find, 'hydroxyl')
    const edited = await exportDocx(loaded, [suggestion])
    const xml = await JSZip.loadAsync(edited).then((zip) => zip.file('word/document.xml')!.async('string'))
    expect(xml).toContain('hydroxyl')
    expect(xml).not.toContain('a|b')
    expect(xml).toContain('Short name')
    expect(xml).toContain('Before the table.')
    expect(xml).toContain('After the table.')
  })

  it('writes a cell edit that starts on an escaped pipe', async () => {
    const buffer = await docxBody(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `)
    const loaded = await parseDocx('pipe.docx', buffer)
    const table = loaded.paragraphs[0]
    const find = '|b'
    const start = table.text.indexOf(find)
    const suggestion = accepted({
      paraId: table.id,
      find,
      insert: 'x',
      comment: 'Drop the pipe.',
      author: 'AI-copyedit',
    })
    suggestion.span = { start, end: start + find.length }
    suggestion.segments = wordDiff(find, 'x')
    const xml = await exportDocx(loaded, [suggestion]).then((edited) => (
      JSZip.loadAsync(edited).then((zip) => zip.file('word/document.xml')!.async('string'))
    ))
    expect(xml).toContain('>a</w:t>')
    expect(xml).toContain('>x</w:t>')
    expect(xml).not.toContain('|')
  })

  it('keeps an older comment on its words when a later edit lands in that paragraph', async () => {
    const buffer = await withComments(await docxBody(`
      <w:p>
        <w:commentRangeStart w:id="0"/>
        <w:r><w:t xml:space="preserve">The </w:t></w:r>
        <w:commentRangeEnd w:id="0"/>
        <w:r><w:commentReference w:id="0"/></w:r>
        <w:r><w:t xml:space="preserve">late sandstone.</w:t></w:r>
      </w:p>
    `), 'Look at the article.')
    const loaded = await parseDocx('commented.docx', buffer)
    const paragraph = loaded.paragraphs[0]
    const find = 'late'
    const suggestion = pendingEdit(paragraph, find, 'Upper')
    const edited = await exportDocx(loaded, [suggestion])
    const zip = await JSZip.loadAsync(edited)
    const xml = await zip.file('word/document.xml')!.async('string')
    const comments = await zip.file('word/comments.xml')!.async('string')
    expect(comments).toContain('Look at the article.')
    expect(textInsideComment(xml, '0')).toContain('The')
    expect(textInsideComment(xml, '0')).not.toContain('Upper')
    expect(xml).toContain('Upper')
  })

  it('does not nest a new tracked change inside an older one', async () => {
    const buffer = await docxBody(`
      <w:p>
        <w:r><w:t xml:space="preserve">The </w:t></w:r>
        <w:ins w:id="4" w:author="Ada" w:date="2024-01-01T00:00:00Z"><w:r><w:t>late</w:t></w:r></w:ins>
        <w:del w:id="5" w:author="Ada" w:date="2024-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve"> old</w:delText></w:r></w:del>
        <w:r><w:t xml:space="preserve"> sandstone.</w:t></w:r>
      </w:p>
    `)
    const loaded = await parseDocx('revised.docx', buffer)
    const paragraph = loaded.paragraphs[0]
    const suggestion = pendingEdit(paragraph, 'late', 'Upper')
    const xml = await exportDocx(loaded, [suggestion]).then((edited) => (
      JSZip.loadAsync(edited).then((zip) => zip.file('word/document.xml')!.async('string'))
    ))
    expect(xml).toContain('Upper')
    expect(xml).toContain('late')
    expect(xml).toContain('old')
    expect(nestedRevision(xml)).toBe(false)
  })

  it('leaves a merged table out of the review and in the downloaded file', async () => {
    const buffer = await docxBody(`
      <w:p><w:r><w:t>Before.</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:tcPr><w:gridSpan w:val="2"/></w:tcPr>
            <w:p><w:r><w:t>Merged header</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Left</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>Right</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:t>After the merged table.</w:t></w:r></w:p>
    `)
    const loaded = await parseDocx('merged.docx', buffer)
    expect(loaded.paragraphs.map((paragraph) => paragraph.text)).toEqual(['Before.', 'After the merged table.'])
    const after = loaded.paragraphs[1]
    const suggestion = accepted({
      paraId: after.id,
      find: 'merged',
      insert: 'combined',
      comment: 'Prefer combined.',
      author: 'AI-copyedit',
    })
    suggestion.span = { start: after.text.indexOf('merged'), end: after.text.indexOf('merged') + 'merged'.length }
    suggestion.segments = wordDiff('merged', 'combined')
    const xml = await exportDocx(loaded, [suggestion]).then((edited) => (
      JSZip.loadAsync(edited).then((zip) => zip.file('word/document.xml')!.async('string'))
    ))
    expect(xml).toContain('Merged header')
    expect(xml).toContain('Left')
    expect(xml).toContain('Right')
    expect(xml).toContain('After the ')
    expect(xml).toContain('combined')
  })

  it.skipIf(!existsSync('test/testManuscript.docx'))('turns the demo manuscript tables into pipe tables', async () => {
    const bytes = readFileSync('test/testManuscript.docx')
    const loaded = await parseDocx(
      'testManuscript.docx',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    const tables = loaded.paragraphs.filter((paragraph) => paragraph.kind === 'table')
    expect(tables).toHaveLength(2)
    expect(tables[0].text).toContain('| Short name | Target | Spectral range (nm) | Indicator for |')
    expect(tables[0].text).toContain('| H2O |')
    expect(loaded.paragraphs.some((paragraph) => paragraph.text === 'H2O')).toBe(false)
  })
})

function pendingEdit(paragraph: { id: string; text: string }, find: string, insert: string): Suggestion {
  const start = paragraph.text.indexOf(find)
  const suggestion = accepted({
    paraId: paragraph.id,
    find,
    insert,
    comment: 'Capitalise the formal time unit.',
    author: 'AI-copyedit',
  })
  suggestion.status = 'pending'
  suggestion.span = { start, end: start + find.length }
  suggestion.segments = wordDiff(find, insert)
  return suggestion
}

function markupId(element: Element): string {
  return element.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'id')
    || element.getAttribute('w:id')
    || ''
}

function nestedRevision(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return [...doc.getElementsByTagName('*')].some((element) => (
    (element.localName === 'ins' || element.localName === 'del')
    && [...element.getElementsByTagName('*')].some((child) => child.localName === 'ins' || child.localName === 'del')
  ))
}

function textInsideComment(xml: string, id: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const start = [...doc.getElementsByTagName('*')].find((element) => (
    element.localName === 'commentRangeStart' && markupId(element) === id
  ))
  const end = [...doc.getElementsByTagName('*')].find((element) => (
    element.localName === 'commentRangeEnd' && markupId(element) === id
  ))
  if (!start || !end) return ''
  let text = ''
  const stop = new Set<Node>([end])
  const walk = (node: Node) => {
    if (stop.has(node)) return true
    if (node.nodeType === 3) text += node.textContent ?? ''
    for (const child of node.childNodes) {
      if (walk(child)) return true
    }
    return false
  }
  let cursor: Node | null = start.nextSibling
  while (cursor) {
    if (walk(cursor)) break
    cursor = cursor.nextSibling
  }
  return text
}

async function withComments(buffer: ArrayBuffer, body: string): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer)
  zip.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="0" w:author="Ada" w:date="2024-01-01T00:00:00Z"><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:comment>
</w:comments>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}

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
  const body = `<w:p>${runs.map((run) => `<w:r><w:t xml:space="preserve">${run}</w:t></w:r>`).join('')}</w:p>`
  return docxBody(body)
}

async function docxBody(body: string): Promise<ArrayBuffer> {
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
    ${body}
  </w:body>
</w:document>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}
