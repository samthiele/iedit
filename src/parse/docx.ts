import JSZip from 'jszip'
import {
  descendants,
  insideTable,
  parseXml,
  qattr,
  visiblePieces,
} from '../ooxml/xml.ts'
import { isEditable, paragraphId, type LoadedDocument, type Paragraph } from '../review/types.ts'

export async function parseDocx(fileName: string, buffer: ArrayBuffer): Promise<LoadedDocument> {
  const zip = await JSZip.loadAsync(buffer)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('This Word file has no word/document.xml.')
  const xml = await documentFile.async('string')
  const doc = parseXml(xml)
  const body = descendants(doc, 'body')[0]
  const paragraphElements = body ? directParagraphs(body) : descendants(doc, 'p')

  const paragraphs: Paragraph[] = []
  let section = 'Manuscript'
  paragraphElements.forEach((element, docxIndex) => {
    const text = visiblePieces(element).text
    if (!text.trim()) return
    const inTable = insideTable(element)
    const heading = isHeading(element)
    if (heading) section = text.trim()
    paragraphs.push({
      id: paragraphId(paragraphs.length),
      text,
      kind: inTable ? 'table' : heading ? 'heading' : 'body',
      section,
      inTable,
      docxIndex,
    })
  })

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

function directParagraphs(body: Element): Element[] {
  return descendants(body, 'p')
}

function isHeading(paragraph: Element): boolean {
  const style = descendants(paragraph, 'pStyle')[0]
  if (!style) return false
  const value = qattr(style, 'val')
  return /^Heading/i.test(value) || value === 'Title'
}
