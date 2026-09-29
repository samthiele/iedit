import type { InlineMark, InlineStyle, TextLink } from '../review/types.ts'

export type TexCharMap = { start: number; end: number }

export type PlainTex = {
  text: string
  texMap: TexCharMap[]
  marks: InlineMark[]
  links: TextLink[]
  level?: number
}

const MARKS: Record<string, InlineStyle> = {
  textbf: 'bold',
  textit: 'italic',
  emph: 'italic',
  underline: 'underline',
  textsubscript: 'subscript',
  textsuperscript: 'superscript',
  mathbf: 'bold',
  mathit: 'italic',
}

const HEADINGS: Record<string, number> = {
  title: 1,
  chapter: 1,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
}

const UNWRAP = new Set([
  ...Object.keys(MARKS),
  ...Object.keys(HEADINGS),
  'texttt', 'textrm', 'textsc', 'textsf', 'text', 'mbox', 'hbox',
  'mathrm', 'mathsf', 'mathtt',
  'author', 'address', 'ead', 'cortext', 'caption', 'footnote', 'footnotetext',
  'fbox', 'item',
])

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω',
  degree: '°', times: '×', cdot: '·', pm: '±', leq: '≤', geq: '≥',
  neq: '≠', approx: '≈', infty: '∞', rightarrow: '→', leftarrow: '←',
}

const ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', n: 'ń' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { n: 'ñ', N: 'Ñ', a: 'ã', o: 'õ', A: 'Ã', O: 'Õ' },
  '=': { a: 'ā', e: 'ē', o: 'ō', u: 'ū' },
  c: { c: 'ç', C: 'Ç' },
}

const ESCAPES: Record<string, string> = {
  '&': '&', '%': '%', $: '$', '#': '#', _: '_', '{': '{', '}': '}',
}

type Char = { ch: string; start: number; end: number }

export function readPlainTex(source: string, absBase: number): PlainTex {
  const chars: Char[] = []
  const marks: InlineMark[] = []
  const links: TextLink[] = []
  let level: number | undefined

  const scan = (from: number, to: number, math: boolean) => {
    let i = from
    while (i < to) {
      const ch = source[i]
      if (ch === '%') {
        const line = source.indexOf('\n', i)
        i = line < 0 || line >= to ? to : line
        continue
      }
      if (ch === '\\') {
        i = command(i, to, math)
        continue
      }
      if (!math && ch === '$') {
        const display = source[i + 1] === '$'
        const open = display ? i + 2 : i + 1
        const close = display ? '$$' : '$'
        const end = findClose(open, to, close)
        scan(open, end, true)
        i = end + close.length
        continue
      }
      if (math && (ch === '_' || ch === '^')) {
        i = script(i, to, ch === '_' ? 'subscript' : 'superscript')
        continue
      }
      if (ch === '{' || ch === '}') {
        if (ch === '{') {
          const group = balanced(i, to, '{', '}')
          scan(group.start, group.end, math)
          i = group.next
        } else {
          i += 1
        }
        continue
      }
      if (ch === '&') {
        emit('|', absBase + i, absBase + i + 1)
        i += 1
        continue
      }
      if (ch === '~') {
        space(absBase + i, absBase + i + 1)
        i += 1
        continue
      }
      if (ch === '-' && source.startsWith('---', i)) {
        emit('—', absBase + i, absBase + i + 3)
        i += 3
        continue
      }
      if (ch === '-' && source.startsWith('--', i)) {
        emit('–', absBase + i, absBase + i + 2)
        i += 2
        continue
      }
      if (isSpace(ch)) {
        const start = i
        while (i < to && isSpace(source[i])) i += 1
        space(absBase + start, absBase + i)
        continue
      }
      emit(ch, absBase + i, absBase + i + 1)
      i += 1
    }
  }

  const emit = (value: string, start: number, end: number) => {
    for (let index = 0; index < value.length; index += 1) {
      chars.push({ ch: value[index], start, end })
    }
  }

  const space = (start: number, end: number) => {
    if (chars.length === 0) return
    const last = chars[chars.length - 1]
    if (last.ch === ' ' || last.ch === '\n') {
      last.end = Math.max(last.end, end)
      return
    }
    chars.push({ ch: ' ', start, end })
  }

  const command = (i: number, to: number, math: boolean): number => {
    const from = i
    i += 1
    if (i >= to) return i
    let name = ''
    if (/[a-zA-Z]/.test(source[i])) {
      while (i < to && /[a-zA-Z]/.test(source[i])) name += source[i++]
      while (i < to && isSpace(source[i])) i += 1
    } else {
      name = source[i++]
    }
    if (name === '\\') {
      space(absBase + from, absBase + i)
      return i
    }
    if (ESCAPES[name]) {
      emit(ESCAPES[name], absBase + from, absBase + i)
      return i
    }
    if (name === '(' || name === '[') {
      const close = name === '(' ? '\\)' : '\\]'
      const end = source.indexOf(close, i)
      const stop = end < 0 || end >= to ? to : end
      scan(i, stop, true)
      return stop + (end < 0 || end >= to ? 0 : close.length)
    }
    if (name === ')' || name === ']') return i
    if (ACCENTS[name]) {
      return accent(name, i, to, absBase + from)
    }
    if (SYMBOLS[name]) {
      emit(SYMBOLS[name], absBase + from, absBase + i)
      return i
    }
    if (name === 'sep') {
      emit(', ', absBase + from, absBase + i)
      return i
    }
    if (name === 'href') return href(i, to)
    if (name === 'url') return linkText(i, to, absBase + from)
    if (name === 'textcolor') return lastArgument(i, to, math)
    if (HEADINGS[name] !== undefined && level === undefined) level = HEADINGS[name]
    if (UNWRAP.has(name) || HEADINGS[name] !== undefined) {
      i = skipBrackets(i, to)
      if (source[i] !== '{') return i
      const group = balanced(i, to, '{', '}')
      const start = chars.length
      scan(group.start, group.end, math)
      const style = MARKS[name]
      if (style && chars.length > start) marks.push({ style, start, end: chars.length })
      return group.next
    }
    i = skipBrackets(i, to)
    while (source[i] === '{') {
      i = balanced(i, to, '{', '}').next
      i = skipBrackets(i, to)
    }
    return skipDimension(i, to)
  }

  const accent = (name: string, i: number, to: number, start: number): number => {
    if (source[i] === '{') {
      const group = balanced(i, to, '{', '}')
      const letter = source.slice(group.start, group.end).trim()
      emit(ACCENTS[name][letter] ?? letter, start, absBase + group.next)
      return group.next
    }
    const letter = source[i] ?? ''
    emit(ACCENTS[name][letter] ?? letter, start, absBase + i + 1)
    return i + 1
  }

  const href = (i: number, to: number): number => {
    i = skipBrackets(i, to)
    if (source[i] !== '{') return i
    const url = balanced(i, to, '{', '}')
    i = url.next
    if (source[i] !== '{') return i
    const text = balanced(i, to, '{', '}')
    const from = chars.length
    scan(text.start, text.end, false)
    const hrefText = source.slice(url.start, url.end).trim()
    if (chars.length > from && /^https?:\/\//.test(hrefText)) {
      links.push({ href: hrefText, start: from, end: chars.length })
    }
    return text.next
  }

  const linkText = (i: number, to: number, start: number): number => {
    i = skipBrackets(i, to)
    if (source[i] !== '{') return i
    const group = balanced(i, to, '{', '}')
    const from = chars.length
    emit(source.slice(group.start, group.end), start, absBase + group.next)
    const hrefText = source.slice(group.start, group.end).trim()
    if (/^https?:\/\//.test(hrefText)) links.push({ href: hrefText, start: from, end: chars.length })
    return group.next
  }

  const lastArgument = (i: number, to: number, math: boolean): number => {
    i = skipBrackets(i, to)
    if (source[i] !== '{') return i
    const first = balanced(i, to, '{', '}')
    i = first.next
    if (source[i] !== '{') return i
    const second = balanced(i, to, '{', '}')
    scan(second.start, second.end, math)
    return second.next
  }

  const script = (i: number, to: number, style: InlineStyle): number => {
    i += 1
    const start = chars.length
    if (source[i] === '{') {
      const group = balanced(i, to, '{', '}')
      scan(group.start, group.end, true)
      i = group.next
    } else if (source[i] === '\\') {
      i = command(i, to, true)
    } else if (i < to) {
      emit(source[i], absBase + i, absBase + i + 1)
      i += 1
    }
    if (chars.length > start) marks.push({ style, start, end: chars.length })
    return i
  }

  const skipBrackets = (i: number, to: number): number => {
    while (i < to && isSpace(source[i])) i += 1
    if (source[i] === '*') i += 1
    while (i < to) {
      while (i < to && isSpace(source[i])) i += 1
      if (source[i] !== '[') break
      i = balanced(i, to, '[', ']').next
    }
    return i
  }

  const skipDimension = (i: number, to: number): number => {
    let cursor = i
    if (source[cursor] === '=') cursor += 1
    const rest = source.slice(cursor, to)
    const match = /^-?\d*\.?\d+\s*(?:pt|pc|cm|mm|in|em|ex|bp|sp)?/.exec(rest)
    if (!match || match[0].length === 0) return i
    return cursor + match[0].length
  }

  scan(0, source.length, false)
  while (chars.length > 0 && chars[chars.length - 1].ch === ' ') chars.pop()
  for (let index = 0; index < chars.length - 1;) {
    if (chars[index].ch === ' ' && '.,;:!?'.includes(chars[index + 1].ch)) {
      chars.splice(index, 1)
      shift(marks, index)
      shift(links, index)
      continue
    }
    index += 1
  }

  return {
    text: chars.map((item) => item.ch).join(''),
    texMap: chars.map((item) => ({ start: item.start, end: item.end })),
    marks,
    links,
    level,
  }

  function balanced(i: number, to: number, open: string, close: string): { start: number; end: number; next: number } {
    let depth = 0
    for (let j = i; j < to; j += 1) {
      if (source[j] === '\\') {
        j += 1
        continue
      }
      if (source[j] === open) depth += 1
      else if (source[j] === close) {
        depth -= 1
        if (depth === 0) return { start: i + 1, end: j, next: j + 1 }
      }
    }
    return { start: i + 1, end: to, next: to }
  }

  function findClose(from: number, to: number, token: string): number {
    for (let index = from; index < to; index += 1) {
      if (source[index] === '\\') {
        index += 1
        continue
      }
      if (source.startsWith(token, index)) return index
    }
    return to
  }
}

function shift(ranges: { start: number; end: number }[], index: number) {
  for (const range of ranges) {
    if (range.start > index) range.start -= 1
    if (range.end > index) range.end -= 1
  }
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'
}
