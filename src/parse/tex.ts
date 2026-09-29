import { readPlainTex } from './texPlain.ts'
import { paragraphId, type LoadedDocument, type Paragraph, type ParagraphKind } from '../review/types.ts'

const OMITTED = 'comment|verbatim|lstlisting|minted|thebibliography|equation\\*?|align\\*?|eqnarray\\*?'

export function parseTex(fileName: string, source: string): LoadedDocument {
  const paragraphs: Paragraph[] = []
  let section = 'Manuscript'
  let cursor = 0
  let passedDocumentStart = !/\\begin\{document\}/.test(source)
  let skipDepth = 0

  const lines = source.split('\n')
  let blockStart = 0
  let blockLines: string[] = []
  let blockPreamble = false
  let blockSkipped = false

  const flush = () => {
    if (blockLines.length === 0) return
    const text = blockLines.join('\n')
    const start = blockStart
    const end = start + text.length
    const trimmed = text.trim()
    if (trimmed && !trimmed.split('\n').every((line) => line.trim().startsWith('%'))) {
      if (/\\begin\{abstract\}/.test(trimmed)) section = 'Abstract'
      if (blockPreamble) {
        paragraphs.push({
          id: paragraphId(paragraphs.length),
          text,
          kind: 'preamble',
          section,
          inTable: false,
          texStart: start,
          texEnd: end,
        })
      } else if (!blockSkipped) {
        const plain = readPlainTex(text, start)
        if (plain.text.trim()) {
          const heading = headingBlock(trimmed)
          if (heading) section = plain.text
          const kind: ParagraphKind = heading
            ? 'heading'
            : /\\begin\{(?:table\*?|tabular|tabulary)\}/.test(trimmed) ? 'table' : 'body'
          paragraphs.push({
            id: paragraphId(paragraphs.length),
            text: plain.text,
            kind,
            section,
            inTable: kind === 'table',
            level: heading ? plain.level ?? 1 : undefined,
            marks: plain.marks.length > 0 ? plain.marks : undefined,
            links: plain.links.length > 0 ? plain.links : undefined,
            texStart: start,
            texEnd: end,
            texMap: plain.texMap,
          })
        }
      }
    }
    blockLines = []
    blockPreamble = false
    blockSkipped = false
  }

  for (const line of lines) {
    if (blockLines.length === 0) blockStart = cursor
    if (!passedDocumentStart) blockPreamble = true
    if (/\\begin\{document\}/.test(line)) passedDocumentStart = true
    if (new RegExp(`\\\\begin\\{(?:${OMITTED})\\}`).test(line)) {
      skipDepth += 1
      blockSkipped = true
    } else if (skipDepth > 0) {
      blockSkipped = true
    }
    if (new RegExp(`\\\\end\\{(?:${OMITTED})\\}`).test(line)) {
      blockSkipped = true
      skipDepth = Math.max(0, skipDepth - 1)
    }
    if (line.trim() === '') {
      flush()
    } else {
      if (!blockPreamble && skipDepth === 0 && blockLines.length > 0 && startsNewParagraph(line, blockLines)) {
        flush()
        blockStart = cursor
      }
      blockLines.push(line)
    }
    cursor += line.length + 1
  }
  flush()

  if (paragraphs.length === 0) {
    throw new Error('No text was found in this LaTeX file.')
  }

  return { fileName, kind: 'tex', paragraphs, tex: source }
}

const HEADING_LINE = /^\s*\\(?:title|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?/
const LABEL_LINE = /^\s*\\label\{/

function startsNewParagraph(line: string, block: string[]): boolean {
  if (HEADING_LINE.test(line)) return true
  return block.every((item) => HEADING_LINE.test(item) || LABEL_LINE.test(item))
    && !HEADING_LINE.test(line)
    && !LABEL_LINE.test(line)
}

function headingBlock(text: string): boolean {
  return /^\s*(?:%[^\n]*\n\s*)*\\(?:title|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?/.test(text)
}
