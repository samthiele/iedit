import type { Author, LoadedDocument, Suggestion } from '../review/types.ts'
import { editedStem } from '../review/types.ts'

const PREAMBLE_LINES = [
  '\\usepackage{xcolor}',
  '\\usepackage{hyperref}',
  '\\usepackage[markup=default]{changes}',
  '\\definechangesauthor[name={AI copyedit}, color=blue]{AI-copyedit}',
  '\\definechangesauthor[name={AI science}, color=orange]{AI-science}',
  '\\setaddedmarkup{\\textcolor{blue}{#1}}',
  '\\setdeletedmarkup{\\textcolor{red}{\\sout{#1}}}',
  '\\usepackage[date=false, time=false]{pdfcomment}',
]

export function exportTex(document: LoadedDocument, suggestions: Suggestion[]): string {
  const source = document.tex ?? ''
  const included = suggestions.filter((item) => item.status !== 'rejected')
  const placed = included.flatMap((suggestion) => {
    const paragraph = document.paragraphs.find((item) => item.id === suggestion.paraId)
    if (!paragraph || paragraph.texStart === undefined || paragraph.texEnd === undefined) return []
    if (!suggestion.find) {
      if (suggestion.status === 'accepted') return []
      return [{ suggestion, start: paragraph.texEnd }]
    }
    const local = paragraph.text.indexOf(suggestion.find)
    if (local < 0) return []
    return [{ suggestion, start: paragraph.texStart + local }]
  }).sort((a, b) => b.start - a.start)

  let next = source
  let needsMarkup = false
  for (const item of placed) {
    if (item.suggestion.status !== 'accepted') needsMarkup = true
    next = applyAt(next, item.start, item.suggestion)
  }
  return needsMarkup ? ensurePreamble(next) : next
}

export function texFileName(fileName: string): string {
  return `${editedStem(fileName)}.tex`
}

function applyAt(source: string, start: number, suggestion: Suggestion): string {
  if (suggestion.status === 'accepted') {
    if (!suggestion.find) return source
    if (source.slice(start, start + suggestion.find.length) !== suggestion.find) return source
    return source.slice(0, start) + suggestion.insert + source.slice(start + suggestion.find.length)
  }
  const note = pdfComment(suggestion.comment, suggestion.author)
  if (!suggestion.find) {
    return `${source.slice(0, start)}${note}${source.slice(start)}`
  }
  if (source.slice(start, start + suggestion.find.length) !== suggestion.find) return source
  const replacement = suggestion.insert
    ? `\\replaced[id=AI-copyedit]{${suggestion.insert}}{${suggestion.find}}${note}`
    : `\\deleted[id=AI-copyedit]{${suggestion.find}}${note}`
  return source.slice(0, start) + replacement + source.slice(start + suggestion.find.length)
}

function pdfComment(comment: string, author: Author): string {
  if (author === 'AI-science') {
    return `\\pdfcomment[icon=Comment,color=orange,author={AI science},subject={science}]{${escapeTex(comment)}}`
  }
  return `\\pdfcomment[icon=Note,color=blue,author={AI copyedit},subject={copyedit}]{${escapeTex(comment)}}`
}

function escapeTex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%{}])/g, '\\$1')
}

function ensurePreamble(source: string): string {
  const missing = PREAMBLE_LINES.filter((line) => !source.includes(line))
  if (missing.length === 0) return source
  const block = `${missing.join('\n')}\n`
  const begin = source.indexOf('\\begin{document}')
  if (begin >= 0) return `${source.slice(0, begin)}${block}${source.slice(begin)}`
  return `${block}\n${source}`
}
