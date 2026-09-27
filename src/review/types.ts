export type ParagraphKind = 'body' | 'heading' | 'table' | 'preamble' | 'skip'

export type Paragraph = {
  id: string
  text: string
  kind: ParagraphKind
  section: string
  inTable: boolean
  docxIndex?: number
  texStart?: number
  texEnd?: number
}

export type Author = 'AI-copyedit' | 'AI-science'

export type DiffSegment = {
  type: 'equal' | 'delete' | 'insert'
  text: string
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected'

export type Suggestion = {
  id: string
  paraId: string
  find: string
  insert: string
  comment: string
  author: Author
  status: SuggestionStatus
  span: { start: number; end: number } | null
  segments: DiffSegment[]
  grounded: boolean
}

export type GroundingSource = {
  title: string
  uri: string
}

export type LoadedDocument = {
  fileName: string
  kind: 'docx' | 'tex'
  paragraphs: Paragraph[]
  docx?: ArrayBuffer
  tex?: string
}

export type ReviewSession = {
  document: LoadedDocument
  suggestions: Suggestion[]
  summary: string
  sources: GroundingSource[]
  warnings: string[]
  scienceRan: boolean
  scienceError: string | null
  disciplineTitle: string
}

export function editedStem(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  if (stem.endsWith('_AI_edited')) return `${stem}_v2`
  if (stem.endsWith('_AI')) return `${stem}_edited`
  return `${stem}_AI_edited`
}

export function paragraphId(index: number): string {
  return `p-${String(index + 1).padStart(3, '0')}`
}

export function isEditable(kind: ParagraphKind): boolean {
  return kind === 'body' || kind === 'heading' || kind === 'table'
}
