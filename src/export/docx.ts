import JSZip from 'jszip'
import {
  CT,
  OFFICE_REL,
  REL,
  W,
  W14,
  W15,
  descendants,
  insideTable,
  parseXml,
  preserveSpace,
  qattr,
  serializeXml,
  setW,
  splitAt,
  visiblePieces,
  wEl,
  wordDate,
  type TextPiece,
} from '../ooxml/xml.ts'
import type { Author, DiffSegment, LoadedDocument, Suggestion } from '../review/types.ts'
import { editedStem } from '../review/types.ts'

const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
const COMMENTS_EX_TYPE = 'application/vnd.ms-word.commentsExtended+xml'
const COMMENTS_REL = `${OFFICE_REL}/comments`
const COMMENTS_EX_REL = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'

export async function exportDocx(document: LoadedDocument, suggestions: Suggestion[]): Promise<ArrayBuffer> {
  if (!document.docx) throw new Error('The original Word file is missing.')
  const zip = await JSZip.loadAsync(document.docx)
  const documentXml = await required(zip, 'word/document.xml')
  const doc = parseXml(documentXml)
  const paragraphs = descendants(descendants(doc, 'body')[0] ?? doc, 'p')
  const included = suggestions.filter((item) => item.status !== 'rejected')
  const byParagraph = new Map<number, Suggestion[]>()

  for (const suggestion of included) {
    const paragraph = document.paragraphs.find((item) => item.id === suggestion.paraId)
    if (!paragraph || paragraph.docxIndex === undefined) continue
    const list = byParagraph.get(paragraph.docxIndex) ?? []
    list.push(suggestion)
    byParagraph.set(paragraph.docxIndex, list)
  }

  let revisionId = maxRevisionId(doc) + 1
  const notes: CommentNote[] = []

  for (const [index, items] of byParagraph) {
    const element = paragraphs[index]
    if (!element) continue
    const ordered = [...items].sort((a, b) => (b.span?.start ?? 0) - (a.span?.start ?? 0))
    for (const suggestion of ordered) {
      const note = applySuggestion(element, suggestion, revisionId)
      revisionId = note.nextId
      if (note.comment) notes.push(note.comment)
    }
  }

  await enableTracking(zip)
  if (notes.length > 0) await writeComments(zip, notes)
  zip.file('word/document.xml', serializeXml(doc))
  return zip.generateAsync({ type: 'arraybuffer' })
}

export function docxFileName(fileName: string): string {
  return `${editedStem(fileName)}.docx`
}

type CommentNote = {
  id: number
  author: Author
  body: string
  paraId: string
}

function applySuggestion(
  paragraph: Element,
  suggestion: Suggestion,
  nextId: number,
): { nextId: number; comment: CommentNote | null } {
  const visual = insideTable(paragraph)
  const author: Author = 'AI-copyedit'
  const commentId = nextId
  nextId += 1

  if (!suggestion.span || !suggestion.find) {
    if (suggestion.status === 'accepted') return { nextId, comment: null }
    const { text } = visiblePieces(paragraph)
    const end = Math.min(text.length, Math.max(1, Math.min(text.length, 160)))
    if (end > 0) {
      wrapComment(paragraph, 0, end, commentId)
    }
    return {
      nextId,
      comment: {
        id: commentId,
        author: suggestion.author,
        body: suggestion.comment,
        paraId: randomParaId(),
      },
    }
  }

  const { start, end } = suggestion.span
  splitAt(paragraph, start)
  splitAt(paragraph, end)
  const { pieces } = visiblePieces(paragraph)
  const inside = pieces.filter((piece) => piece.start >= start && piece.end <= end)
  if (inside.length === 0) {
    return { nextId, comment: null }
  }

  const runs = uniqueRuns(inside, pieces, start, end)
  const parent = runs[0]?.parentNode
  if (!parent) return { nextId, comment: null }
  const anchor = runs[runs.length - 1].nextSibling
  const rPr = descendants(runs[0], 'rPr')[0]?.cloneNode(true) as Element | null
  for (const run of runs) run.remove()

  const doc = paragraph.ownerDocument
  if (!doc) return { nextId, comment: null }
  if (suggestion.status === 'accepted') {
    const nodes = bakedNodes(doc, rPr, suggestion)
    for (const node of nodes) {
      if (anchor) parent.insertBefore(node, anchor)
      else parent.appendChild(node)
    }
    return { nextId, comment: null }
  }

  const nodes: Node[] = [commentMarker(doc, 'commentRangeStart', commentId)]
  for (const segment of suggestion.segments) {
    if (!segment.text) continue
    const revision = revisionNode(doc, rPr, segment, visual, author, nextId)
    nextId = revision.nextId
    nodes.push(revision.node)
  }
  nodes.push(commentMarker(doc, 'commentRangeEnd', commentId))
  nodes.push(commentReference(doc, commentId))
  for (const node of nodes) {
    if (anchor) parent.insertBefore(node, anchor)
    else parent.appendChild(node)
  }

  return {
    nextId,
    comment: {
      id: commentId,
      author: suggestion.author,
      body: suggestion.comment,
      paraId: randomParaId(),
    },
  }
}

function bakedNodes(doc: Document, rPr: Element | null, suggestion: Suggestion): Node[] {
  const segments = suggestion.segments.filter((segment) => segment.type !== 'delete' && segment.text)
  const text = segments.length > 0
    ? segments
    : (suggestion.insert ? [{ text: suggestion.insert }] : [])
  return text.map((segment) => textRun(doc, rPr, segment.text, 't'))
}

function uniqueRuns(inside: TextPiece[], pieces: TextPiece[], start: number, end: number): Element[] {
  const runs: Element[] = []
  for (const piece of inside) {
    const related = pieces.filter((item) => item.run === piece.run)
    const fullyInside = related.every((item) => item.start >= start && item.end <= end)
    if (fullyInside && !runs.includes(piece.run)) runs.push(piece.run)
  }
  return runs
}

function revisionNode(
  doc: Document,
  rPr: Element | null,
  segment: DiffSegment,
  visual: boolean,
  author: Author,
  nextId: number,
): { node: Node; nextId: number } {
  if (segment.type === 'equal') {
    return { node: textRun(doc, rPr, segment.text, 't'), nextId }
  }
  if (visual) {
    const mode = segment.type === 'delete' ? 'del' : 'ins'
    return { node: textRun(doc, visualRPr(doc, rPr, mode), segment.text, 't'), nextId }
  }
  const deleted = segment.type === 'delete'
  const run = textRun(doc, rPr, segment.text, deleted ? 'delText' : 't')
  const wrapper = wEl(doc, deleted ? 'del' : 'ins')
  setW(wrapper, 'id', String(nextId))
  setW(wrapper, 'author', author)
  setW(wrapper, 'date', wordDate())
  wrapper.appendChild(run)
  return { node: wrapper, nextId: nextId + 1 }
}

function textRun(doc: Document, rPr: Element | null, text: string, tag: 't' | 'delText'): Element {
  const run = wEl(doc, 'r')
  if (rPr) run.appendChild(rPr.cloneNode(true))
  const textEl = wEl(doc, tag)
  preserveSpace(textEl, text)
  textEl.textContent = text
  run.appendChild(textEl)
  return run
}

function visualRPr(doc: Document, rPr: Element | null, mode: 'del' | 'ins'): Element {
  const properties = rPr ? (rPr.cloneNode(true) as Element) : wEl(doc, 'rPr')
  for (const child of [...properties.childNodes]) {
    if (child.nodeType === 1) {
      const name = (child as Element).localName
      if (name === 'color' || name === 'strike') properties.removeChild(child)
    }
  }
  const color = wEl(doc, 'color')
  setW(color, 'val', mode === 'del' ? 'FF0000' : '0000FF')
  properties.appendChild(color)
  if (mode === 'del') properties.appendChild(wEl(doc, 'strike'))
  return properties
}

function wrapComment(paragraph: Element, start: number, end: number, commentId: number): void {
  splitAt(paragraph, start)
  splitAt(paragraph, end)
  const { pieces } = visiblePieces(paragraph)
  const inside = pieces.filter((piece) => piece.start >= start && piece.end <= end)
  if (inside.length === 0) return
  const doc = paragraph.ownerDocument
  const parent = inside[0].run.parentNode
  if (!doc || !parent) return
  parent.insertBefore(commentMarker(doc, 'commentRangeStart', commentId), inside[0].run)
  const last = inside[inside.length - 1].run
  const after = last.nextSibling
  const endMarker = commentMarker(doc, 'commentRangeEnd', commentId)
  const reference = commentReference(doc, commentId)
  if (after) {
    parent.insertBefore(endMarker, after)
    parent.insertBefore(reference, after)
  } else {
    parent.appendChild(endMarker)
    parent.appendChild(reference)
  }
}

function commentMarker(doc: Document, name: 'commentRangeStart' | 'commentRangeEnd', id: number): Element {
  const marker = wEl(doc, name)
  setW(marker, 'id', String(id))
  return marker
}

function commentReference(doc: Document, id: number): Element {
  const run = wEl(doc, 'r')
  const reference = wEl(doc, 'commentReference')
  setW(reference, 'id', String(id))
  run.appendChild(reference)
  return run
}

function maxRevisionId(doc: XMLDocument): number {
  let max = 999
  const walk = (node: Node) => {
    if (node.nodeType !== 1) return
    const element = node as Element
    if (element.localName === 'del' || element.localName === 'ins') {
      const id = Number(qattr(element, 'id'))
      if (Number.isFinite(id)) max = Math.max(max, id)
    }
    for (const child of element.childNodes) walk(child)
  }
  walk(doc)
  return max
}

async function enableTracking(zip: JSZip): Promise<void> {
  const settingsFile = zip.file('word/settings.xml')
  if (!settingsFile) return
  const settings = parseXml(await settingsFile.async('string'))
  if (!descendants(settings, 'trackRevisions')[0]) {
    const marker = wEl(settings, 'trackRevisions')
    settings.documentElement.insertBefore(marker, settings.documentElement.firstChild)
    zip.file('word/settings.xml', serializeXml(settings))
  }
}

async function writeComments(zip: JSZip, notes: CommentNote[]): Promise<void> {
  const existing = zip.file('word/comments.xml')
  const comments = existing
    ? parseXml(await existing.async('string'))
    : parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${W}" xmlns:w14="${W14}"></w:comments>`,
    )
  const extendedFile = zip.file('word/commentsExtended.xml')
  const extended = extendedFile
    ? parseXml(await extendedFile.async('string'))
    : parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:w15="${W15}"></w15:commentsEx>`,
    )

  for (const note of notes) {
    const comment = wEl(comments, 'comment')
    setW(comment, 'id', String(note.id))
    setW(comment, 'author', note.author)
    setW(comment, 'date', wordDate())
    setW(comment, 'initials', note.author === 'AI-science' ? 'AS' : 'AC')
    const lines = note.body.split('\n')
    lines.forEach((line, index) => {
      const paragraph = wEl(comments, 'p')
      if (index === 0) paragraph.setAttributeNS(W14, 'w14:paraId', note.paraId)
      const run = wEl(comments, 'r')
      const text = wEl(comments, 't')
      preserveSpace(text, line || ' ')
      text.textContent = line || ' '
      run.appendChild(text)
      paragraph.appendChild(run)
      comment.appendChild(paragraph)
    })
    comments.documentElement.appendChild(comment)

    const extra = extended.createElementNS(W15, 'w15:commentEx')
    extra.setAttributeNS(W15, 'w15:paraId', note.paraId)
    extra.setAttributeNS(W15, 'w15:done', '0')
    extended.documentElement.appendChild(extra)
  }

  zip.file('word/comments.xml', serializeXml(comments))
  zip.file('word/commentsExtended.xml', serializeXml(extended))
  await ensureContentType(zip, '/word/comments.xml', COMMENTS_TYPE)
  await ensureContentType(zip, '/word/commentsExtended.xml', COMMENTS_EX_TYPE)
  await ensureRelationship(zip, COMMENTS_REL, 'comments.xml')
  await ensureRelationship(zip, COMMENTS_EX_REL, 'commentsExtended.xml')
}

async function ensureContentType(zip: JSZip, partName: string, contentType: string): Promise<void> {
  const types = parseXml(await required(zip, '[Content_Types].xml'))
  const overrides = [...types.getElementsByTagNameNS(CT, 'Override')]
  if (overrides.some((item) => item.getAttribute('PartName') === partName)) return
  const override = types.createElementNS(CT, 'Override')
  override.setAttribute('PartName', partName)
  override.setAttribute('ContentType', contentType)
  types.documentElement.appendChild(override)
  zip.file('[Content_Types].xml', serializeXml(types))
}

async function ensureRelationship(zip: JSZip, type: string, target: string): Promise<void> {
  const path = 'word/_rels/document.xml.rels'
  const rels = zip.file(path)
    ? parseXml(await zip.file(path)!.async('string'))
    : parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL}"></Relationships>`,
    )
  const relationships = [...rels.getElementsByTagNameNS(REL, 'Relationship')]
  if (relationships.some((item) => item.getAttribute('Type') === type)) return
  const relationship = rels.createElementNS(REL, 'Relationship')
  relationship.setAttribute('Id', `rIdIedit${relationships.length + 1}`)
  relationship.setAttribute('Type', type)
  relationship.setAttribute('Target', target)
  rels.documentElement.appendChild(relationship)
  zip.file(path, serializeXml(rels))
}

async function required(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`The Word file is missing ${path}.`)
  return file.async('string')
}

function randomParaId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}
