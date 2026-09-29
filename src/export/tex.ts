import type { LoadedDocument, Paragraph, Suggestion } from '../review/types.ts'
import { editedStem } from '../review/types.ts'

type Range = { start: number; end: number }

export function exportTex(document: LoadedDocument, suggestions: Suggestion[]): string {
  const source = document.tex ?? ''
  const included = suggestions.filter((item) => item.status !== 'rejected')
  const placed = included.flatMap((suggestion) => {
    const paragraph = document.paragraphs.find((item) => item.id === suggestion.paraId)
    const ranges = sourceRanges(paragraph, suggestion)
    return ranges ? [{ suggestion, ranges }] : []
  })
  const kept = dropOverlaps(placed).sort((a, b) => b.ranges[0].start - a.ranges[0].start)

  let next = source
  for (const item of kept) {
    next = applyAt(next, item.ranges, item.suggestion)
  }
  return ensurePdfcomment(next)
}

export function texFileName(fileName: string): string {
  return `${editedStem(fileName)}.tex`
}

function sourceRanges(paragraph: Paragraph | undefined, suggestion: Suggestion): Range[] | null {
  if (!paragraph || paragraph.texStart === undefined || paragraph.texEnd === undefined) return null
  if (!suggestion.find) {
    if (suggestion.status === 'accepted') return null
    return [{ start: paragraph.texEnd, end: paragraph.texEnd }]
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
    const ranges = mappedRanges(map, local.start, local.end)
    return ranges.length > 0 ? ranges : null
  }
  if (!map) {
    const at = paragraph.text.indexOf(suggestion.find)
    if (at < 0) return null
    return [{ start: paragraph.texStart + at, end: paragraph.texStart + at + suggestion.find.length }]
  }
  return null
}

function mappedRanges(map: { start: number; end: number }[], start: number, end: number): Range[] {
  const ranges: Range[] = []
  for (let index = start; index < end; index += 1) {
    const char = map[index]
    const last = ranges[ranges.length - 1]
    if (last && char.start <= last.end) last.end = Math.max(last.end, char.end)
    else ranges.push({ start: char.start, end: char.end })
  }
  return ranges
}

function dropOverlaps(items: { suggestion: Suggestion; ranges: Range[] }[]): { suggestion: Suggestion; ranges: Range[] }[] {
  const sorted = [...items].sort((a, b) => a.ranges[0].start - b.ranges[0].start)
  const kept: { suggestion: Suggestion; ranges: Range[] }[] = []
  let end = -1
  for (const item of sorted) {
    const start = item.ranges[0].start
    const itemEnd = item.ranges[item.ranges.length - 1].end
    if (start < end) continue
    kept.push(item)
    end = Math.max(end, itemEnd)
  }
  return kept
}

function applyAt(source: string, ranges: Range[], suggestion: Suggestion): string {
  if (suggestion.status === 'accepted') {
    if (!suggestion.find) return source
    const text = escapeTex(suggestion.insert)
    const ordered = [...ranges].sort((a, b) => b.start - a.start)
    return ordered.reduce((next, range, index) => {
      const replacement = index === ordered.length - 1 ? text : ''
      return next.slice(0, range.start) + replacement + next.slice(range.end)
    }, source)
  }
  const author = suggestion.author.trim() || 'iEdit'
  const start = ranges[0].start
  const end = ranges[ranges.length - 1].end
  if (!suggestion.find) {
    const note = pdfComment(author, suggestion.comment)
    if (!note) return source
    return `${source.slice(0, start)}${note}${source.slice(start)}`
  }
  const deleted = source.slice(start, end)
  if (!canStrikeout(source, start, deleted)) {
    const parts = [suggestion.comment.trim()]
    if (suggestion.insert.trim()) parts.push(`Suggested: ${suggestion.insert.trim()}`)
    const note = pdfComment(author, parts.filter(Boolean).join(' '))
    return source.slice(0, start) + note + source.slice(start)
  }
  const marked = `\\pdfmarkupcomment[markup=StrikeOut,author={${escapeTex(author)}}]{${deleted}}{${escapeTex(suggestion.comment.trim())}}`
  const replacement = suggestion.insert ? escapeTex(suggestion.insert) : ''
  const body = replacement ? `${marked}\n${replacement}` : marked
  return source.slice(0, start) + body + source.slice(end)
}

function canStrikeout(source: string, start: number, deleted: string): boolean {
  if (/[\\{}%&#$_^~\n\r]/.test(deleted)) return false
  return braceDepth(source, start) === 0 && !inMath(source, start)
}

function braceDepth(source: string, index: number): number {
  let depth = 0
  for (let cursor = 0; cursor < index; cursor += 1) {
    const ch = source[cursor]
    if (ch === '\\') {
      cursor += 1
      continue
    }
    if (ch === '%') {
      const line = source.indexOf('\n', cursor)
      cursor = line < 0 ? index : line
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') depth = Math.max(0, depth - 1)
  }
  return depth
}

function inMath(source: string, index: number): boolean {
  let math = false
  for (let cursor = 0; cursor < index; cursor += 1) {
    const ch = source[cursor]
    if (ch === '\\') {
      cursor += 1
      continue
    }
    if (ch === '%') {
      const line = source.indexOf('\n', cursor)
      cursor = line < 0 ? index : line
      continue
    }
    if (ch === '$' && source[cursor + 1] === '$') {
      math = !math
      cursor += 1
      continue
    }
    if (ch === '$') math = !math
  }
  return math
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
