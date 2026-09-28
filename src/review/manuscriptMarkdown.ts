import { htmlDecorated } from './richText.ts'
import type { InlineMark, Suggestion, TextLink } from './types.ts'

type Piece =
  | { kind: 'text'; text: string; start: number }
  | { kind: 'plain'; suggestion: Suggestion; text: string }
  | { kind: 'redline'; suggestion: Suggestion }

export function manuscriptSource(
  text: string,
  suggestions: Suggestion[],
  marks: InlineMark[] = [],
  hoverId: string | null = null,
  links: TextLink[] = [],
): string {
  return pieces(text, suggestions).map((piece) => {
    if (piece.kind === 'text') return htmlDecorated(piece.text, piece.start, marks, links)
    const hot = piece.suggestion.id === hoverId
    if (piece.kind === 'plain') {
      return suggestionHtml(piece.suggestion.id, hot, 'suggest-mark', escapeHtml(piece.text))
    }
    const inner = piece.suggestion.segments.map((segment) => {
      if (!segment.text) return ''
      const escaped = escapeHtml(segment.text)
      if (segment.type === 'delete') return `<span class="del">${escaped}</span>`
      if (segment.type === 'insert') return `<span class="ins">${escaped}</span>`
      return escaped
    }).join('')
    return suggestionHtml(piece.suggestion.id, hot, 'redline', inner)
  }).join('')
}

function suggestionHtml(id: string, hot: boolean, className: string, inner: string): string {
  const classes = hot ? `${className} is-hot` : className
  return `<span class="${classes}" data-suggestion="${escapeHtml(id)}">${inner}</span>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function pieces(text: string, suggestions: Suggestion[]): Piece[] {
  const ranged = suggestions
    .filter((suggestion) => suggestion.span)
    .sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0))
  const out: Piece[] = []
  let cursor = 0
  for (const suggestion of ranged) {
    const span = suggestion.span
    if (!span || span.start < cursor) continue
    if (span.start > cursor) out.push({ kind: 'text', text: text.slice(cursor, span.start), start: cursor })
    if (suggestion.status === 'pending') {
      out.push({ kind: 'redline', suggestion })
    } else if (suggestion.status === 'accepted') {
      const baked = suggestion.segments.filter((segment) => segment.type !== 'delete').map((segment) => segment.text).join('')
      out.push({ kind: 'plain', suggestion, text: baked || suggestion.insert })
    } else {
      out.push({ kind: 'plain', suggestion, text: text.slice(span.start, span.end) })
    }
    cursor = span.end
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor), start: cursor })
  if (out.length === 0) out.push({ kind: 'text', text, start: 0 })
  return out
}
