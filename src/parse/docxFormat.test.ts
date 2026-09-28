import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportDocx } from '../export/docx.ts'
import { parseDocx } from './docx.ts'

describe('docx formatting', () => {
  it('turns a plain table into a pipe table and keeps bold on the cell text', async () => {
    const loaded = await parseDocx('paper.docx', await sample(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>H2O</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>1800–2120</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>OH</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>1350–1600</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Introduction</w:t></w:r></w:p>
    `))
    const table = loaded.paragraphs.find((paragraph) => paragraph.kind === 'table')
    const heading = loaded.paragraphs.find((paragraph) => paragraph.kind === 'heading')
    expect(table?.text).toBe('| H2O | 1800–2120 |\n| --- | --- |\n| OH | 1350–1600 |')
    expect(table?.marks).toEqual([{ start: 2, end: 5, style: 'bold' }])
    expect(heading?.level).toBe(1)
    expect(heading?.marks).toEqual([{ start: 0, end: 'Introduction'.length, style: 'italic' }])
  })

  it('omits a merged table from the review and leaves it in the Word download', async () => {
    const loaded = await parseDocx('paper.docx', await sample(`
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:tcPr><w:gridSpan w:val="2"/></w:tcPr>
            <w:p><w:r><w:t>Merged label</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:t>After the table.</w:t></w:r></w:p>
    `))
    expect(loaded.paragraphs.map((paragraph) => paragraph.text)).toEqual(['After the table.'])
    const edited = await exportDocx(loaded, [])
    const zip = await JSZip.loadAsync(edited)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Merged label')
    expect(xml).toContain('After the table.')
  })
})

async function sample(body: string): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}
