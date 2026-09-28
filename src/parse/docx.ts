import JSZip from 'jszip'
import {
  descendants,
  parseXml,
  qattr,
  REL,
  visiblePieces,
} from '../ooxml/xml.ts'
import { isEditable, paragraphId, type InlineMark, type LoadedDocument, type Paragraph, type TableCellRef, type TextLink } from '../review/types.ts'

export async function parseDocx(fileName: string, buffer: ArrayBuffer): Promise<LoadedDocument> {
  const zip = await JSZip.loadAsync(buffer)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('This Word file has no word/document.xml.')
  const xml = await documentFile.async('string')
  const doc = parseXml(xml)
  const body = descendants(doc, 'body')[0]
  const relsFile = zip.file('word/_rels/document.xml.rels')
  const rels = hyperlinkTargets(relsFile ? await relsFile.async('string') : '')
  const paragraphElements = body ? descendants(body, 'p') : descendants(doc, 'p')

  const paragraphs: Paragraph[] = []
  let section = 'Manuscript'
  let index = 0
  while (index < paragraphElements.length) {
    const element = paragraphElements[index]
    const table = body ? outermostTable(element, body) : null
    if (!table) {
      const visible = visiblePieces(element, rels)
      const text = visible.text
      const level = headingLevel(element)
      if (text.trim()) {
        if (level) section = text.trim()
        paragraphs.push({
          id: paragraphId(paragraphs.length),
          text,
          kind: level ? 'heading' : 'body',
          section,
          inTable: false,
          docxIndex: index,
          level: level ?? undefined,
          marks: visible.marks.length > 0 ? visible.marks : undefined,
          links: visible.links.length > 0 ? visible.links : undefined,
        })
      }
      index += 1
      continue
    }

    let end = index + 1
    while (end < paragraphElements.length && outermostTable(paragraphElements[end], body!) === table) end += 1
    const pipe = pipeTable(table, paragraphElements, index, end, rels)
    if (pipe) {
      paragraphs.push({
        id: paragraphId(paragraphs.length),
        text: pipe.text,
        kind: 'table',
        section,
        inTable: true,
        docxIndex: pipe.cells[0].docxIndex,
        cells: pipe.cells,
        marks: pipe.marks.length > 0 ? pipe.marks : undefined,
        links: pipe.links.length > 0 ? pipe.links : undefined,
      })
    }
    index = end
  }

  if (!paragraphs.some((paragraph) => isEditable(paragraph.kind))) {
    throw new Error('No editable text was found in this Word file.')
  }

  return {
    fileName,
    kind: 'docx',
    paragraphs,
    docx: buffer,
  }
}

function outermostTable(paragraph: Element, body: Element): Element | null {
  let table: Element | null = null
  let node: Node | null = paragraph.parentNode
  while (node && node !== body) {
    if (node.nodeType === 1 && (node as Element).localName === 'tbl') table = node as Element
    node = node.parentNode
  }
  return table
}

function pipeTable(
  table: Element,
  paragraphs: Element[],
  start: number,
  end: number,
  rels: ReadonlyMap<string, string>,
): { text: string; cells: TableCellRef[]; marks: InlineMark[]; links: TextLink[] } | null {
  if (descendants(table, 'tbl').length > 0 || tableHasMerge(table)) return null
  const rows = childElements(table, 'tr')
  if (rows.length === 0) return null

  let cursor = start
  const grid: { text: string; docxIndex: number; marks: InlineMark[]; links: TextLink[] }[][][] = []
  for (const row of rows) {
    const line: { text: string; docxIndex: number; marks: InlineMark[]; links: TextLink[] }[][] = []
    for (const cell of childElements(row, 'tc')) {
      const sources: { text: string; docxIndex: number; marks: InlineMark[]; links: TextLink[] }[] = []
      for (const paragraph of descendants(cell, 'p')) {
        if (paragraphs[cursor] !== paragraph) return null
        const visible = visiblePieces(paragraph, rels)
        const text = visible.text.replace(/\r?\n/g, ' ')
        if (text) sources.push({ text, docxIndex: cursor, marks: visible.marks, links: visible.links })
        cursor += 1
      }
      line.push(sources)
    }
    grid.push(line)
  }
  if (cursor !== end) return null

  const width = Math.max(...grid.map((row) => row.length))
  if (!Number.isFinite(width) || width < 1) return null
  let markdown = ''
  const cells: TableCellRef[] = []
  const marks: InlineMark[] = []
  const links: TextLink[] = []
  grid.forEach((row, rowIndex) => {
    markdown += '|'
    for (let column = 0; column < width; column += 1) {
      markdown += ' '
      const sources = row[column] ?? []
      sources.forEach((source, sourceIndex) => {
        if (sourceIndex > 0) markdown += '<br>'
        const startAt = markdown.length
        markdown += source.text.replaceAll('|', '\\|')
        cells.push({
          docxIndex: source.docxIndex,
          text: source.text,
          start: startAt,
          end: markdown.length,
        })
        for (const mark of source.marks) {
          marks.push({
            style: mark.style,
            start: startAt + escapedOffset(source.text, mark.start),
            end: startAt + escapedOffset(source.text, mark.end),
          })
        }
        for (const link of source.links) {
          links.push({
            href: link.href,
            start: startAt + escapedOffset(source.text, link.start),
            end: startAt + escapedOffset(source.text, link.end),
          })
        }
      })
      markdown += ' |'
    }
    markdown += '\n'
    if (rowIndex === 0) markdown += `|${' --- |'.repeat(width)}\n`
  })
  if (cells.length === 0) return null
  return { text: markdown.trimEnd(), cells, marks, links }
}

function hyperlinkTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>()
  if (!xml.trim()) return targets
  const rels = parseXml(xml)
  for (const relationship of [...rels.getElementsByTagNameNS(REL, 'Relationship')]) {
    const type = relationship.getAttribute('Type') ?? ''
    if (!type.endsWith('/hyperlink')) continue
    const id = relationship.getAttribute('Id') ?? ''
    const target = relationship.getAttribute('Target') ?? ''
    if (id && target) targets.set(id, target)
  }
  return targets
}

function escapedOffset(plain: string, offset: number): number {
  let extra = 0
  const end = Math.min(offset, plain.length)
  for (let index = 0; index < end; index += 1) {
    if (plain[index] === '|') extra += 1
  }
  return offset + extra
}

function tableHasMerge(table: Element): boolean {
  for (const cell of descendants(table, 'tc')) {
    const props = childElements(cell, 'tcPr')[0]
    if (!props) continue
    const span = childElements(props, 'gridSpan')[0]
    if (span && Number(qattr(span, 'val') || '1') > 1) return true
    if (childElements(props, 'vMerge')[0]) return true
  }
  return false
}

function childElements(parent: Element, local: string): Element[] {
  return [...parent.childNodes].filter((node): node is Element => (
    node.nodeType === 1 && (node as Element).localName === local
  ))
}

function headingLevel(paragraph: Element): number | null {
  const style = descendants(paragraph, 'pStyle')[0]
  if (!style) return null
  const value = qattr(style, 'val')
  if (/^Title$/i.test(value)) return 1
  const heading = /^Heading\s*(\d)/i.exec(value)
  if (!heading) return null
  return Math.min(6, Math.max(1, Number(heading[1]) || 1))
}
