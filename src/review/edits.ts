import { wordDiff } from './diff.ts'
import { locateFormatted, plainInsert } from './richText.ts'
import type { Author, Paragraph, Suggestion } from './types.ts'

export type RawEdit = {
  paraId: string
  find: string
  insert: string
  comment: string
  author: Author
}

const FENCE = /```iedit-edits\s*\n([\s\S]*?)```/gi
const HEADING = /^###\s+(p-\d+)\s*$/gm
const COMMENT = /\[COMMENT(?:-(COPYEDIT|SCIENCE))?:\s*([\s\S]*?)\]/g

export function extractEditFence(text: string): { summary: string; body: string } {
  const matches = [...text.matchAll(FENCE)]
  if (matches.length === 0) {
    return { summary: text.trim(), body: '' }
  }
  return {
    summary: text.replace(FENCE, '').replace(/\n{3,}/g, '\n\n').trim(),
    body: matches.map((match) => match[1].trim()).join('\n\n'),
  }
}

export function parseEditBody(body: string): RawEdit[] {
  if (!body.trim()) return []
  const headings = [...body.matchAll(HEADING)]
  if (headings.length === 0) return []

  const edits: RawEdit[] = []
  headings.forEach((heading, index) => {
    const start = heading.index + heading[0].length
    const end = index + 1 < headings.length ? headings[index + 1].index : body.length
    edits.push(...parseBlock(heading[1], body.slice(start, end)))
  })
  return edits
}

function parseBlock(paraId: string, block: string): RawEdit[] {
  const comments = [...block.matchAll(COMMENT)]
  if (comments.length === 0) {
    const paired = pairWording(block)
    if (!paired.find && !paired.insert) return []
    return [
      {
        paraId,
        find: paired.find,
        insert: paired.insert,
        comment: 'No explanation was returned with this suggestion.',
        author: 'AI-copyedit',
      },
    ]
  }

  const edits: RawEdit[] = []
  let cursor = 0
  for (const comment of comments) {
    const region = block.slice(cursor, comment.index)
    const paired = pairWording(region)
    const kind = comment[1]
    edits.push({
      paraId,
      find: paired.find,
      insert: paired.insert,
      comment: comment[2].trim(),
      author: kind === 'SCIENCE' ? 'AI-science' : 'AI-copyedit',
    })
    cursor = (comment.index ?? 0) + comment[0].length
  }
  return edits
}

function pairWording(region: string): { find: string; insert: string } {
  const deleted = /~~([\s\S]*?)~~/.exec(region)
  const inserted = /\*\*<u>([\s\S]*?)<\/u>\*\*/.exec(region)
  return {
    find: deleted?.[1] ?? '',
    insert: inserted?.[1] ?? '',
  }
}

export function bindEdits(
  edits: RawEdit[],
  paragraphs: Paragraph[],
  options: { idPrefix: string; grounded: boolean },
): { suggestions: Suggestion[]; unmatched: string[] } {
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  const suggestions: Suggestion[] = []
  const unmatched: string[] = []
  const occupied = new Map<string, { start: number; end: number }[]>()

  edits.forEach((edit, index) => {
    const paragraph = byId.get(edit.paraId)
    if (!paragraph) {
      unmatched.push(`${edit.paraId}: paragraph was not in this chunk`)
      return
    }

    if (!edit.find.trim()) {
      if (!edit.comment.trim()) return
      suggestions.push({
        id: `${options.idPrefix}-${index + 1}`,
        paraId: edit.paraId,
        find: '',
        insert: '',
        comment: edit.comment,
        author: edit.author,
        status: 'pending',
        span: null,
        segments: [],
        grounded: options.grounded,
      })
      return
    }

    const located = locateFree(paragraph, edit.find, occupied)
    const insert = plainInsert(edit.insert)
    if (!located) {
      unmatched.push(`${edit.paraId}: “${trimQuote(edit.find)}” was not found verbatim`)
      return
    }

    if (located.actual === insert) {
      if (!edit.comment.trim()) return
      suggestions.push({
        id: `${options.idPrefix}-${index + 1}`,
        paraId: edit.paraId,
        find: '',
        insert: '',
        comment: edit.comment,
        author: edit.author,
        status: 'pending',
        span: null,
        segments: [],
        grounded: options.grounded,
      })
      return
    }

    suggestions.push({
      id: `${options.idPrefix}-${index + 1}`,
      paraId: edit.paraId,
      find: located.actual,
      insert,
      comment: edit.comment || 'No explanation was returned with this suggestion.',
      author: edit.author,
      status: 'pending',
      span: { start: located.start, end: located.end },
      segments: wordDiff(located.actual, insert),
      grounded: options.grounded,
    })
  })

  return { suggestions, unmatched }
}

export function interpretModelReply(
  text: string,
  paragraphs: Paragraph[],
  options: { idPrefix: string; grounded: boolean },
): { suggestions: Suggestion[]; unmatched: string[]; summary: string } {
  const extracted = extractEditFence(text)
  const edits = parseEditBody(extracted.body)
  const bound = bindEdits(edits, paragraphs, options)
  const unmatched = !extracted.body.trim()
    ? ['The response did not include an iedit-edits fence.']
    : edits.length === 0
      ? ['The iedit-edits fence did not contain any paragraph blocks.']
      : bound.unmatched
  return { suggestions: bound.suggestions, unmatched, summary: extracted.summary }
}

function locateFree(
  paragraph: Paragraph,
  needle: string,
  occupied: Map<string, { start: number; end: number }[]>,
): { start: number; end: number; actual: string } | null {
  const ranges = occupied.get(paragraph.id) ?? []
  let from = 0
  while (from <= paragraph.text.length) {
    const located = locateFormatted(paragraph, needle, from)
    if (!located || located.start < from) return null
    const overlaps = ranges.some((range) => located.start < range.end && located.end > range.start)
    if (!overlaps) {
      ranges.push({ start: located.start, end: located.end })
      occupied.set(paragraph.id, ranges)
      return located
    }
    const next = Math.max(located.end, from + 1)
    if (next <= from) return null
    from = next
  }
  return null
}

function trimQuote(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact
}
