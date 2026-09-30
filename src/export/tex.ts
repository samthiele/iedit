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
  return ensurePackages(next)
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
  const deleted = source.slice(start, end)
  if (suggestion.find && ranges.length === 1 && plainSlice(deleted, source, start)) {
    const marked = colorMarkup(deleted, suggestion.insert)
    const reason = suggestion.comment.trim()
    const body = source.slice(0, start) + marked + source.slice(end)
    if (fragileAt(source, start)) return reason ? insertLineNote(body, start, percentNote(author, reason)) : body
    return placeNote(source, start, pdfComment(author, reason), marked + source.slice(end))
  }
  const text = suggestion.find ? noteWithSuggestion(suggestion) : suggestion.comment.trim()
  if (!text) return source
  if (fragileAt(source, start)) return insertLineNote(source, start, percentNote(author, text))
  return placeNote(source, start, pdfComment(author, text), source.slice(start))
}

function plainSlice(deleted: string, source: string, start: number): boolean {
  if (!deleted || /[\\{}%&#$_^~\n\r]/.test(deleted)) return false
  return !inMath(source, start)
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

function colorMarkup(deleted: string, insert: string): string {
  const struck = `{\\color{red}\\sout{${deleted}}}`
  const text = insert.trim()
  return text ? `${struck}{\\color{blue}${escapeTex(text)}}` : struck
}

function noteWithSuggestion(suggestion: Suggestion): string {
  const parts = [suggestion.comment.trim()]
  if (suggestion.insert.trim()) parts.push(`Suggested: ${suggestion.insert.trim()}`)
  return parts.filter(Boolean).join(' ')
}

function placeNote(source: string, start: number, note: string, rest: string): string {
  if (!note) return source.slice(0, start) + rest
  const pad = start > 0 && !/\s/.test(source[start - 1]) ? ' ' : ''
  return source.slice(0, start) + pad + note + rest
}

const FRAGILE = /^(?:itemize|enumerate|description|tabular|table|figure)\*?$/

function fragileAt(source: string, index: number): boolean {
  const stack: string[] = []
  for (let cursor = 0; cursor < index; cursor += 1) {
    const ch = source[cursor]
    if (ch === '\\') {
      const begin = /^\\begin\{([^{}]+)\}/.exec(source.slice(cursor))
      if (begin && cursor + begin[0].length <= index) {
        stack.push(begin[1])
        cursor += begin[0].length - 1
        continue
      }
      const end = /^\\end\{([^{}]+)\}/.exec(source.slice(cursor))
      if (end && cursor + end[0].length <= index) {
        const at = stack.lastIndexOf(end[1])
        if (at >= 0) stack.splice(at, 1)
        cursor += end[0].length - 1
        continue
      }
      cursor += 1
      continue
    }
    if (ch === '%') {
      const line = source.indexOf('\n', cursor)
      cursor = line < 0 ? index : line
    }
  }
  return stack.some((name) => FRAGILE.test(name))
}

function percentNote(author: string, text: string): string {
  return `% iEdit (${author}): ${text.replace(/\s+/g, ' ').trim()}`
}

function insertLineNote(source: string, at: number, line: string): string {
  const newline = source.indexOf('\n', at)
  if (newline < 0) return `${source}\n${line}\n`
  return `${source.slice(0, newline)}\n${line}${source.slice(newline)}`
}

function pdfComment(author: string, comment: string): string {
  const text = comment.trim()
  if (!text) return ''
  return `\\pdfcomment[author={${escapeTex(author)}},icon=Comment]{${escapeTex(text)}}`
}

function ensurePackages(source: string): string {
  const lines: string[] = []
  if (source.includes('{\\color{') && !hasPackage(source, 'xcolor') && !hasPackage(source, 'color')) {
    lines.push('\\usepackage{xcolor}')
  }
  if (source.includes('\\sout{') && !hasPackage(source, 'ulem')) lines.push('\\usepackage[normalem]{ulem}')
  if ((source.includes('\\pdfcomment') || source.includes('\\pdfmarkupcomment')) && !hasPackage(source, 'pdfcomment')) {
    lines.push('\\usepackage{pdfcomment}')
  }
  if (lines.length === 0) return source
  const block = `${lines.join('\n')}\n`
  const marker = '\\begin{document}'
  const at = source.indexOf(marker)
  if (at < 0) return block + source
  return source.slice(0, at) + block + source.slice(at)
}

function hasPackage(source: string, name: string): boolean {
  const pattern = new RegExp(`^\\\\(?:usepackage|RequirePackage)(?:\\[[^\\]]*\\])?\\{[^}]*\\b${name}\\b`)
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const ch = source[cursor]
    if (ch === '\\') {
      if (pattern.test(source.slice(cursor))) return true
      cursor += 1
      continue
    }
    if (ch === '%') {
      const line = source.indexOf('\n', cursor)
      cursor = line < 0 ? source.length : line
    }
  }
  return false
}

function escapeTex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}
