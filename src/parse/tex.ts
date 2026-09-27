import { paragraphId, type LoadedDocument, type Paragraph, type ParagraphKind } from '../review/types.ts'

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
      const heading = sectionCommand(trimmed)
      if (heading) section = heading
      if (/\\begin\{abstract\}/.test(trimmed)) section = 'Abstract'
      const kind = paragraphKind(trimmed, blockPreamble, blockSkipped, Boolean(heading))
      paragraphs.push({
        id: paragraphId(paragraphs.length),
        text,
        kind,
        section,
        inTable: kind === 'table',
        texStart: start,
        texEnd: end,
      })
    }
    blockLines = []
    blockPreamble = false
    blockSkipped = false
  }

  for (const line of lines) {
    if (blockLines.length === 0) blockStart = cursor
    if (!passedDocumentStart) blockPreamble = true
    if (/\\begin\{document\}/.test(line)) passedDocumentStart = true
    if (/\\begin\{(?:verbatim|lstlisting|minted|thebibliography)\}/.test(line)) {
      skipDepth += 1
      blockSkipped = true
    } else if (skipDepth > 0) {
      blockSkipped = true
    }
    if (/\\end\{(?:verbatim|lstlisting|minted|thebibliography)\}/.test(line)) {
      blockSkipped = true
      skipDepth = Math.max(0, skipDepth - 1)
    }
    if (line.trim() === '') {
      flush()
    } else {
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

function sectionCommand(text: string): string | null {
  const match = /\\(?:chapter|section|subsection|subsubsection)\*?\{([^{}]*)\}/.exec(text)
  return match?.[1]?.trim() || null
}

function paragraphKind(
  text: string,
  inPreamble: boolean,
  skipped: boolean,
  heading: boolean,
): ParagraphKind {
  if (inPreamble) return 'preamble'
  if (skipped) return 'skip'
  if (/\\begin\{(?:table|tabular)\}/.test(text)) return 'table'
  if (/\\begin\{(?:equation|align|figure)\}/.test(text)) return 'skip'
  if (heading) return 'heading'
  return 'body'
}
