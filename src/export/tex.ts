import type { LoadedDocument, Paragraph, Suggestion } from '../review/types.ts'
import { editedStem } from '../review/types.ts'

export function exportTex(document: LoadedDocument, suggestions: Suggestion[]): string {
  const source = document.tex ?? ''
  const included = suggestions.filter((item) => item.status !== 'rejected')
  const placed = included.flatMap((suggestion) => {
    const paragraph = document.paragraphs.find((item) => item.id === suggestion.paraId)
    const range = sourceRange(paragraph, suggestion)
    return range ? [{ suggestion, ...range }] : []
  }).sort((a, b) => b.start - a.start)

  let next = source
  for (const item of placed) {
    next = applyAt(next, item.start, item.end, item.suggestion)
  }
  return ensurePdfcomment(next)
}

export function texFileName(fileName: string): string {
  return `${editedStem(fileName)}.tex`
}

function sourceRange(
  paragraph: Paragraph | undefined,
  suggestion: Suggestion,
): { start: number; end: number } | null {
  if (!paragraph || paragraph.texStart === undefined || paragraph.texEnd === undefined) return null
  if (!suggestion.find) {
    if (suggestion.status === 'accepted') return null
    return { start: paragraph.texEnd, end: paragraph.texEnd }
  }
  const map = paragraph.texMap
  const span = suggestion.span
  const local = span && span.end > span.start
    ? span
    : (() => {
      const at = paragraph.text.indexOf(suggestion.find)
      return at < 0 ? null : { start: at, end: at + suggestion.find.length }
    })()
  if (map && local && local.end <= map.length && local.end > local.start) {
    const start = map[local.start].start
    const end = map[local.end - 1].end
    if (end > start) return { start, end }
  }
  if (!map) {
    const at = paragraph.text.indexOf(suggestion.find)
    if (at < 0) return null
    return { start: paragraph.texStart + at, end: paragraph.texStart + at + suggestion.find.length }
  }
  return null
}

function applyAt(source: string, start: number, end: number, suggestion: Suggestion): string {
  if (suggestion.status === 'accepted') {
    if (!suggestion.find) return source
    return source.slice(0, start) + suggestion.insert + source.slice(end)
  }
  const author = suggestion.author.trim() || 'iEdit'
  if (!suggestion.find) {
    const note = pdfComment(author, suggestion.comment)
    if (!note) return source
    return `${source.slice(0, start)}${note}${source.slice(start)}`
  }
  const deleted = source.slice(start, end)
  return source.slice(0, start) + pendingWording(deleted, suggestion.insert, suggestion.comment, author) + source.slice(end)
}

function pendingWording(deleted: string, insert: string, comment: string, author: string): string {
  if (deleted.includes('\\')) {
    const parts = [comment.trim()]
    if (insert.trim()) parts.push(`Suggested: ${insert.trim()}`)
    const note = pdfComment(author, parts.filter(Boolean).join(' '))
    return deleted + note
  }
  const marked = `\\pdfmarkupcomment[markup=StrikeOut,author={${escapeTex(author)}}]{${deleted}}{${escapeTex(comment.trim())}}`
  const replacement = insert ? escapeTex(insert) : ''
  return replacement ? `${marked}\n${replacement}` : marked
}

function pdfComment(author: string, comment: string): string {
  const text = comment.trim()
  if (!text) return ''
  return ` \\pdfcomment[author={${escapeTex(author)}},icon=Comment]{${escapeTex(text)}}`
}

function ensurePdfcomment(source: string): string {
  if (!source.includes('\\pdfmarkupcomment') && !source.includes('\\pdfcomment')) return source
  if (/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\bpdfcomment\b/.test(source)) return source
  const marker = '\\begin{document}'
  const at = source.indexOf(marker)
  const line = '\\usepackage{pdfcomment}\n'
  if (at < 0) return line + source
  return source.slice(0, at) + line + source.slice(at)
}

function escapeTex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}
