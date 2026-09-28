import type { InlineMark, InlineStyle, TextLink } from '../review/types.ts'

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
export const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
export const XML_NS = 'http://www.w3.org/XML/1998/namespace'
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
export const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export function parseXml(xml: string): XMLDocument {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Could not parse XML from the Word file.')
  }
  return doc
}

export function serializeXml(doc: Document): string {
  const body = new XMLSerializer().serializeToString(doc)
  if (body.startsWith('<?xml')) return body
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`
}

export function wEl(doc: Document, name: string): Element {
  return doc.createElementNS(W, `w:${name}`)
}

export function qattr(el: Element, name: string): string {
  return el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`) ?? ''
}

export function setW(el: Element, name: string, value: string): void {
  el.setAttributeNS(W, `w:${name}`, value)
}

export function descendants(root: ParentNode, local: string): Element[] {
  const found: Element[] = []
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue
      const element = child as Element
      if (element.localName === local) found.push(element)
      walk(element)
    }
  }
  walk(root)
  return found
}

export function insideTable(node: Node): boolean {
  let parent = node.parentNode
  while (parent) {
    if (parent.nodeType === 1 && (parent as Element).localName === 'tbl') return true
    parent = parent.parentNode
  }
  return false
}

export type TextPiece = {
  textEl: Element
  run: Element
  start: number
  end: number
}

export function visiblePieces(
  paragraph: Element,
  rels: ReadonlyMap<string, string> = new Map(),
): { text: string; pieces: TextPiece[]; marks: InlineMark[]; links: TextLink[] } {
  const pieces: TextPiece[] = []
  const marks: InlineMark[] = []
  const links: TextLink[] = []
  let text = ''
  let fieldUrl: string | null = null
  let fieldResult = false

  const walk = (node: Node, inDeletion: boolean) => {
    if (node.nodeType !== 1) return
    const element = node as Element
    const name = element.localName
    if (name === 'del') {
      for (const child of element.childNodes) walk(child, true)
      return
    }
    if (inDeletion || name === 'delText') return
    if (name === 'instrText') {
      const match = /HYPERLINK\s+"([^"]+)"/i.exec(element.textContent ?? '')
      if (match) fieldUrl = match[1]
      return
    }
    if (name === 'fldChar') {
      const type = qattr(element, 'fldCharType')
      if (type === 'begin') {
        fieldUrl = null
        fieldResult = false
      } else if (type === 'separate') {
        fieldResult = Boolean(fieldUrl)
      } else if (type === 'end') {
        fieldUrl = null
        fieldResult = false
      }
      return
    }
    if (name === 't') {
      const run = nearestRun(element)
      if (!run) return
      const value = element.textContent ?? ''
      const start = text.length
      text += value
      pieces.push({ textEl: element, run, start, end: text.length })
      for (const style of runEmphasis(run)) marks.push({ start, end: text.length, style })
      const href = hyperlinkHref(element, rels) ?? (fieldResult ? fieldUrl : null)
      if (href) links.push({ start, end: text.length, href })
      return
    }
    for (const child of element.childNodes) walk(child, inDeletion)
  }

  walk(paragraph, false)
  return { text, pieces, marks: mergeMarks(marks), links: mergeLinks(links) }
}

function runEmphasis(run: Element): InlineStyle[] {
  const props = [...run.childNodes].find((node): node is Element => (
    node.nodeType === 1 && (node as Element).localName === 'rPr'
  ))
  if (!props) return []
  const styles: InlineStyle[] = []
  if (emphasisOn(props, 'b') || emphasisOn(props, 'bCs')) styles.push('bold')
  if (emphasisOn(props, 'i') || emphasisOn(props, 'iCs')) styles.push('italic')
  if (emphasisOn(props, 'u')) styles.push('underline')
  const align = [...props.childNodes].find((node): node is Element => (
    node.nodeType === 1 && (node as Element).localName === 'vertAlign'
  ))
  const vertical = align ? qattr(align, 'val') : ''
  if (vertical === 'subscript') styles.push('subscript')
  if (vertical === 'superscript') styles.push('superscript')
  return styles
}

function emphasisOn(props: Element, name: string): boolean {
  const node = [...props.childNodes].find((child): child is Element => (
    child.nodeType === 1 && (child as Element).localName === name
  ))
  if (!node) return false
  const value = qattr(node, 'val').toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off' && value !== 'none'
}

function mergeMarks(marks: InlineMark[]): InlineMark[] {
  const merged: InlineMark[] = []
  for (const style of ['bold', 'italic'] as const) {
    const group = marks.filter((mark) => mark.style === style && mark.end > mark.start).sort((a, b) => a.start - b.start)
    let current: InlineMark | null = null
    for (const mark of group) {
      if (current && mark.start <= current.end) {
        current.end = Math.max(current.end, mark.end)
      } else {
        if (current) merged.push(current)
        current = { style: mark.style, start: mark.start, end: mark.end }
      }
    }
    if (current) merged.push(current)
  }
  return merged
}

function mergeLinks(links: TextLink[]): TextLink[] {
  const sorted = links.filter((link) => link.href && link.end > link.start).sort((a, b) => a.start - b.start)
  const merged: TextLink[] = []
  for (const link of sorted) {
    const current = merged.at(-1)
    if (current && current.href === link.href && link.start <= current.end) {
      current.end = Math.max(current.end, link.end)
    } else {
      merged.push({ ...link })
    }
  }
  return merged
}

function hyperlinkHref(element: Element, rels: ReadonlyMap<string, string>): string | null {
  let node: Node | null = element
  while (node) {
    if (node.nodeType === 1 && (node as Element).localName === 'hyperlink') {
      const link = node as Element
      const anchor = qattr(link, 'anchor')
      if (anchor) return `#${anchor}`
      const id = link.getAttributeNS(OFFICE_REL, 'id') || link.getAttribute('r:id') || ''
      return rels.get(id) ?? null
    }
    node = node.parentNode
  }
  return null
}

function nearestRun(element: Element): Element | null {
  let node: Node | null = element
  while (node) {
    if (node.nodeType === 1 && (node as Element).localName === 'r') return node as Element
    node = node.parentNode
  }
  return null
}

export function splitAt(paragraph: Element, offset: number): void {
  const { pieces } = visiblePieces(paragraph)
  const piece = pieces.find((item) => offset > item.start && offset < item.end)
  if (!piece) return
  const value = piece.textEl.textContent ?? ''
  const local = offset - piece.start
  piece.textEl.textContent = value.slice(0, local)
  const clone = piece.run.cloneNode(true) as Element
  const clonedText = descendants(clone, 't').find((item) => item.textContent === value.slice(0, local))
    ?? descendants(clone, 't')[0]
  if (clonedText) clonedText.textContent = value.slice(local)
  piece.run.parentNode?.insertBefore(clone, piece.run.nextSibling)
}

export function wordDate(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function preserveSpace(textEl: Element, text: string): void {
  if (text.startsWith(' ') || text.endsWith(' ') || text.includes('  ')) {
    textEl.setAttributeNS(XML_NS, 'xml:space', 'preserve')
  }
}
