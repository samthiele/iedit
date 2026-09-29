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
import { wordDiff } from '../review/diff.ts'
import type { Author, DiffSegment, LoadedDocument, Paragraph, Suggestion, TableCellRef } from '../review/types.ts'
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
    const target = paragraph ? tableTarget(paragraph, suggestion) : null
    if (!target) continue
    const list = byParagraph.get(target.docxIndex) ?? []
    list.push(target.suggestion)
    byParagraph.set(target.docxIndex, list)
  }

  let revisionId = maxMarkupId(doc) + 1
  const existingComments = zip.file('word/comments.xml')
  if (existingComments) revisionId = Math.max(revisionId, maxMarkupId(parseXml(await existingComments.async('string'))) + 1)
  const notes: CommentNote[] = []

  for (const [index, items] of byParagraph) {
    const element = paragraphs[index]
    if (!element) continue
    const ordered = dropOverlaps(items)
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

function tableTarget(
  paragraph: Paragraph,
  suggestion: Suggestion,
): { docxIndex: number; suggestion: Suggestion } | null {
  if (!paragraph.cells || paragraph.cells.length === 0) {
    if (paragraph.docxIndex === undefined) return null
    return { docxIndex: paragraph.docxIndex, suggestion }
  }
  if (!suggestion.span || !suggestion.find) {
    return { docxIndex: paragraph.cells[0].docxIndex, suggestion: { ...suggestion, span: null, segments: [] } }
  }
  const cell = paragraph.cells.find((item) => suggestion.span!.start >= item.start && suggestion.span!.end <= item.end)
  if (!cell) return null
  const localStart = plainOffset(cell, suggestion.span.start - cell.start)
  const localEnd = plainOffset(cell, suggestion.span.end - cell.start)
  const find = cell.text.slice(localStart, localEnd)
  if (!find) return null
  const insert = suggestion.insert.replaceAll('\\|', '|')
  return {
    docxIndex: cell.docxIndex,
    suggestion: {
      ...suggestion,
      find,
      insert,
      span: { start: localStart, end: localEnd },
      segments: wordDiff(find, insert),
    },
  }
}

function plainOffset(cell: TableCellRef, escapedOffset: number): number {
  let plainIndex = 0
  let index = 0
  while (plainIndex < cell.text.length) {
    const step = cell.text[plainIndex] === '|' ? 2 : 1
    if (index + step > escapedOffset) break
    index += step
    plainIndex += 1
  }
  return plainIndex
}

function dropOverlaps(items: Suggestion[]): Suggestion[] {
  const sorted = [...items].sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0))
  const kept: Suggestion[] = []
  let end = -1
  for (const item of sorted) {
    const start = item.span?.start ?? 0
    const itemEnd = item.span?.end ?? start
    if (item.span && start < end) continue
    kept.push(item)
    end = Math.max(end, itemEnd)
  }
  return kept.sort((a, b) => (b.span?.start ?? 0) - (a.span?.start ?? 0))
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
    if (text.length === 0) {
      const doc = paragraph.ownerDocument
      if (doc) {
        paragraph.appendChild(commentMarker(doc, 'commentRangeStart', commentId))
        paragraph.appendChild(commentMarker(doc, 'commentRangeEnd', commentId))
        paragraph.appendChild(commentReference(doc, commentId))
      }
    } else {
      wrapComment(paragraph, 0, Math.min(text.length, 160), commentId)
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
  const doc = paragraph.ownerDocument
  if (!doc) return { nextId, comment: null }
  let placed = false
  const applied = spliceVisibleSpan(paragraph, start, end, (properties) => {
    placed = true
    if (suggestion.status === 'accepted') return bakedNodes(doc, properties, suggestion)
    const nodes: Node[] = [commentMarker(doc, 'commentRangeStart', commentId)]
    for (const segment of suggestion.segments) {
      if (!segment.text) continue
      const revision = revisionNode(doc, properties, segment, visual, author, nextId)
      nextId = revision.nextId
      nodes.push(revision.node)
    }
    nodes.push(commentMarker(doc, 'commentRangeEnd', commentId))
    nodes.push(commentReference(doc, commentId))
    return nodes
  })
  if (!applied || !placed || suggestion.status === 'accepted') return { nextId, comment: null }

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

function spliceVisibleSpan(
  paragraph: Element,
  start: number,
  end: number,
  build: (properties: Element | null) => Node[],
): boolean {
  splitAt(paragraph, start)
  splitAt(paragraph, end)
  const { pieces } = visiblePieces(paragraph)
  const inside = pieces.filter((piece) => piece.start >= start && piece.end <= end)
  const runs = uniqueRuns(inside, pieces, start, end)
  if (runs.length === 0) return false
  const isolated = runs.map((run) => isolateRevision(run, paragraph))
  const blocks = isolated.every((block) => block.parentNode === isolated[0].parentNode)
    ? isolated
    : [...new Set(isolated.map((block) => paragraphChild(block, paragraph)))]
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  const parent = first.parentNode
  if (!parent || last.parentNode !== parent) return false
  const carried = nodesBetween(first, last).filter(isCommentFurniture)
  for (const marker of carried) (marker as Element).remove()
  const properties = descendants(runs[0], 'rPr')[0]?.cloneNode(true) as Element | null
  const doc = paragraph.ownerDocument
  if (!doc) return false
  for (const node of wrapCarriedMarkers(build(properties), carried)) parent.insertBefore(node, first)
  for (const run of runs) run.remove()
  for (const block of blocks) removeEmptyRevision(block, paragraph)
  return true
}

function paragraphChild(node: Element, paragraph: Element): Element {
  let current = node
  while (current.parentElement && current.parentElement !== paragraph) current = current.parentElement
  return current
}

function isolateRevision(run: Element, paragraph: Element): Element {
  let node = run
  while (node.parentElement && node.parentElement !== paragraph) {
    const parent = node.parentElement
    if (parent.localName !== 'ins' && parent.localName !== 'del') break
    splitRevisionAfter(parent, node)
    splitRevisionBefore(parent, node)
    node = parent
  }
  return node
}

function splitRevisionAfter(revision: Element, run: Element) {
  const following: Node[] = []
  let sibling = run.nextSibling
  while (sibling) {
    following.push(sibling)
    sibling = sibling.nextSibling
  }
  if (following.length === 0 || !revision.parentNode) return
  const clone = revision.cloneNode(false) as Element
  for (const item of following) clone.appendChild(item)
  revision.parentNode.insertBefore(clone, revision.nextSibling)
}

function splitRevisionBefore(revision: Element, run: Element) {
  if (!revision.parentNode || ![...revision.childNodes].some((child) => child !== run)) return
  const clone = revision.cloneNode(false) as Element
  revision.parentNode.insertBefore(clone, revision.nextSibling)
  clone.appendChild(run)
}

function nodesBetween(first: Node, last: Node): Node[] {
  const found: Node[] = []
  let cursor = first.nextSibling
  while (cursor && cursor !== last) {
    found.push(cursor)
    cursor = cursor.nextSibling
  }
  return found
}

function isCommentFurniture(node: Node): boolean {
  if (node.nodeType !== 1) return false
  const element = node as Element
  if (element.localName === 'commentRangeStart' || element.localName === 'commentRangeEnd') return true
  return element.localName === 'r'
    && descendants(element, 'commentReference').length > 0
    && descendants(element, 't').length === 0
    && descendants(element, 'delText').length === 0
}

function wrapCarriedMarkers(nodes: Node[], carried: Node[]): Node[] {
  const starts: Node[] = []
  const ends: Node[] = []
  const references: Node[] = []
  for (const marker of carried) {
    const name = (marker as Element).localName
    if (name === 'commentRangeStart') starts.push(marker)
    else if (name === 'commentRangeEnd') ends.push(marker)
    else references.push(marker)
  }
  return [...starts, ...nodes, ...ends.reverse(), ...references]
}

function removeEmptyRevision(block: Element, paragraph: Element) {
  if (block === paragraph || (block.localName !== 'ins' && block.localName !== 'del')) return
  const hasText = descendants(block, 't').some((item) => item.textContent)
    || descendants(block, 'delText').some((item) => item.textContent)
  if (!hasText) block.remove()
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
  const first = inside[0].run
  const last = inside[inside.length - 1].run
  const startParent = first.parentNode
  const endParent = last.parentNode
  if (!doc || !startParent || !endParent) return
  startParent.insertBefore(commentMarker(doc, 'commentRangeStart', commentId), first)
  const after = last.nextSibling
  const endMarker = commentMarker(doc, 'commentRangeEnd', commentId)
  const reference = commentReference(doc, commentId)
  if (after && after.parentNode === endParent) {
    endParent.insertBefore(endMarker, after)
    endParent.insertBefore(reference, after)
  } else {
    endParent.appendChild(endMarker)
    endParent.appendChild(reference)
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

function maxMarkupId(doc: XMLDocument): number {
  let max = 999
  const walk = (node: Node) => {
    if (node.nodeType !== 1) return
    const element = node as Element
    const name = element.localName
    if (
      name === 'del' || name === 'ins' || name === 'comment'
      || name === 'commentRangeStart' || name === 'commentRangeEnd' || name === 'commentReference'
    ) {
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
