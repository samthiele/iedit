import { locateSpan } from './span.ts'
import type { InlineMark, InlineStyle, Paragraph, TextLink } from './types.ts'

type Slice = {
  text: string
  start: number
  styles: InlineStyle[]
  href?: string
}

type Projected = {
  markdown: string
  map: number[]
}

export function projectParagraph(paragraph: Paragraph): Projected {
  const body = projectText(paragraph.text, 0, paragraph.marks ?? [], paragraph.links ?? [])
  if (paragraph.kind !== 'heading') return body
  const prefix = `${'#'.repeat(paragraph.level ?? 1)} `
  return {
    markdown: prefix + body.markdown,
    map: [...Array<number>(prefix.length).fill(-1), ...body.map],
  }
}

export function locateFormatted(
  paragraph: Paragraph,
  needle: string,
): { start: number; end: number; actual: string } | null {
  const projected = projectParagraph(paragraph)
  const marked = locateSpan(projected.markdown, needle)
  if (marked) {
    const plain = plainRange(projected.map, marked.start, marked.end, paragraph.text)
    if (plain) return plain
  }
  return locateSpan(paragraph.text, needle)
}

export function plainInsert(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, '$1')
    .replace(/<\/?(?:sub|sup|u)>/gi, '')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[\s([{"'])\*(\S(?:.*?\S)?)\*(?=$|[\s)\].,;:!?])/g, '$1$2')
    .replace(/(^|[\s([{"'])_(\S(?:.*?\S)?)_(?=$|[\s)\].,;:!?])/g, '$1$2')
    .replace(/\\([\\*[\]_])/g, '$1')
}

export function htmlDecorated(
  text: string,
  absStart: number,
  marks: InlineMark[] = [],
  links: TextLink[] = [],
): string {
  return groupSlices(plainSlices(text, absStart, marks, links)).map((group) => {
    const inner = group.slices.map((slice) => wrapHtml(escapeHtml(slice.text), slice.styles)).join('')
    const href = group.href ? safeHref(group.href) : null
    return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner
  }).join('')
}

function projectText(text: string, absStart: number, marks: InlineMark[], links: TextLink[]): Projected {
  let markdown = ''
  const map: number[] = []
  for (const group of groupSlices(plainSlices(text, absStart, marks, links))) {
    let inner = ''
    const innerMap: number[] = []
    for (const slice of group.slices) {
      const styled = wrapMarkdown(escapeMarkdown(slice.text, slice.start), slice.styles)
      inner += styled.markdown
      innerMap.push(...styled.map)
    }
    const href = group.href ? safeHref(group.href) : null
    if (!href) {
      markdown += inner
      map.push(...innerMap)
      continue
    }
    const close = `](${href})`
    markdown += `[${inner}${close}`
    map.push(-1, ...innerMap, ...Array<number>(close.length).fill(-1))
  }
  return { markdown, map }
}

function plainRange(
  map: number[],
  start: number,
  end: number,
  text: string,
): { start: number; end: number; actual: string } | null {
  let plainStart = -1
  let plainEnd = -1
  for (let index = start; index < end && index < map.length; index += 1) {
    const plain = map[index]
    if (plain < 0) continue
    if (plainStart < 0) plainStart = plain
    plainEnd = plain + 1
  }
  if (plainStart < 0 || plainEnd <= plainStart) return null
  return { start: plainStart, end: plainEnd, actual: text.slice(plainStart, plainEnd) }
}

function plainSlices(text: string, absStart: number, marks: InlineMark[], links: TextLink[]): Slice[] {
  const cuts = new Set<number>([0, text.length])
  for (const mark of marks) addCut(cuts, mark.start, mark.end, absStart, text.length)
  for (const link of links) addCut(cuts, link.start, link.end, absStart, text.length)
  const points = [...cuts].sort((a, b) => a - b)
  const slices: Slice[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const at = absStart + start
    slices.push({
      text: text.slice(start, end),
      start: at,
      styles: marks.filter((mark) => mark.start <= at && at < mark.end).map((mark) => mark.style),
      href: links.find((link) => link.start <= at && at < link.end)?.href,
    })
  }
  return slices
}

function addCut(cuts: Set<number>, start: number, end: number, absStart: number, length: number) {
  const localStart = Math.max(0, start - absStart)
  const localEnd = Math.min(length, end - absStart)
  if (localStart < localEnd) {
    cuts.add(localStart)
    cuts.add(localEnd)
  }
}

function groupSlices(slices: Slice[]): { href?: string; slices: Slice[] }[] {
  const groups: { href?: string; slices: Slice[] }[] = []
  for (const slice of slices) {
    const current = groups.at(-1)
    if (current && current.href === slice.href) current.slices.push(slice)
    else groups.push({ href: slice.href, slices: [slice] })
  }
  return groups
}

function wrapMarkdown(inner: Projected, styles: InlineStyle[]): Projected {
  let projected = inner
  if (styles.includes('superscript')) projected = wrap(projected, '<sup>', '</sup>')
  if (styles.includes('subscript')) projected = wrap(projected, '<sub>', '</sub>')
  if (styles.includes('underline')) projected = wrap(projected, '<u>', '</u>')
  if (styles.includes('italic')) projected = wrap(projected, '*', '*')
  if (styles.includes('bold')) projected = wrap(projected, '**', '**')
  return projected
}

function wrapHtml(inner: string, styles: InlineStyle[]): string {
  let html = inner
  if (styles.includes('superscript')) html = `<sup>${html}</sup>`
  if (styles.includes('subscript')) html = `<sub>${html}</sub>`
  if (styles.includes('underline')) html = `<u>${html}</u>`
  if (styles.includes('italic')) html = `<em>${html}</em>`
  if (styles.includes('bold')) html = `<strong>${html}</strong>`
  return html
}

function wrap(inner: Projected, before: string, after: string): Projected {
  return {
    markdown: before + inner.markdown + after,
    map: [...Array<number>(before.length).fill(-1), ...inner.map, ...Array<number>(after.length).fill(-1)],
  }
}

function escapeMarkdown(text: string, plainStart: number): Projected {
  let markdown = ''
  const map: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if ('*_[]'.includes(char)) {
      markdown += '\\'
      map.push(-1)
    }
    markdown += char
    map.push(plainStart + index)
  }
  return { markdown, map }
}

function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (trimmed.startsWith('#') && !trimmed.includes('"') && !trimmed.includes('<')) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') return url.href
  } catch {
    return null
  }
  return null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
