import { generateReview, readableGeminiError } from './client.ts'
import type { LlmProvider } from './storage.ts'
import { bindEdits, extractEditFence, parseEditBody } from '../review/edits.ts'
import { isEditable, type GroundingSource, type LoadedDocument, type Paragraph, type ReviewSession, type Suggestion } from '../review/types.ts'

export const BLOCK_PRESETS = [
  { id: 'short', chars: 9000, label: 'Short' },
  { id: 'medium', chars: 36000, label: 'Medium' },
  { id: 'long', chars: 80000, label: 'Long' },
] as const

export type BlockSize = (typeof BLOCK_PRESETS)[number]['id']

export function blockChars(size: string): number {
  return BLOCK_PRESETS.find((item) => item.id === size)?.chars ?? BLOCK_PRESETS[1].chars
}

export function plannedBlocks(paragraphs: Paragraph[], chars: number, includeScience: boolean): { copyedit: number; science: number } {
  const editable = paragraphs.filter((paragraph) => isEditable(paragraph.kind))
  return {
    copyedit: chunkParagraphs(editable, chars).length,
    science: includeScience ? chunkParagraphs(scienceTargets(paragraphs), chars).length : 0,
  }
}

const COPYEDIT_TASK = `Copyedit this whole slice. Work through every paragraph marked role: edit, from the first to the last. Rewrite unclear sentences one sentence or clause at a time. Keep connectors such as Thus, However, and Because. A slice this size needs many wording changes, not a short sample of the worst ones. Every wording change needs ~~old~~ copied verbatim, a replacement, and [COMMENT-COPYEDIT: why]. Do not edit CONTEXT paragraphs. Return a short summary, then one iedit-edits fence.`

const SCIENCE_TASK = `Science pass only. Do not propose wording replacements. Work through every paragraph marked role: edit. Use Google Search before any note that depends on a citation, a formal name, or whether a method can support a claim. If search does not settle it, say "could not verify". Internal mismatches can be noted as internal. Return a note for each checkable claim in this slice, not only the first few. Return [COMMENT-SCIENCE: ...] notes in one iedit-edits fence, plus a short summary. Do not edit CONTEXT paragraphs.`

const SCIENCE_TASK_UNCHECKED = `Science pass only. Do not propose wording replacements. You cannot search the web. Work through every paragraph marked role: edit. For a citation, a formal name, or a method that the manuscript itself does not settle, say "could not verify". Internal mismatches can be noted as internal. Return [COMMENT-SCIENCE: ...] notes in one iedit-edits fence, plus a short summary. Do not edit CONTEXT paragraphs.`

export async function runReview(options: {
  provider: LlmProvider
  apiKey: string
  baseUrl?: string
  model: string
  systemInstruction: string
  document: LoadedDocument
  includeScience: boolean
  chunkChars: number
  disciplineTitle: string
  onProgress: (message: string) => void
}): Promise<ReviewSession> {
  const editable = options.document.paragraphs.filter((paragraph) => isEditable(paragraph.kind))
  if (editable.length === 0) {
    throw new Error('This file has no editable prose paragraphs.')
  }

  const suggestions: Suggestion[] = []
  const warnings: string[] = []
  const summaries: string[] = []
  const sources: GroundingSource[] = []

  const copyChunks = chunkParagraphs(editable, options.chunkChars)
  for (let index = 0; index < copyChunks.length; index += 1) {
    options.onProgress(`Copyedit ${index + 1} of ${copyChunks.length}`)
    const chunkResult = await reviewChunk({
      ...options,
      paragraphs: copyChunks[index],
      mode: 'copyedit',
      idPrefix: `c${index + 1}`,
    })
    summaries.push(chunkResult.summary)
    suggestions.push(...chunkResult.suggestions)
    warnings.push(...chunkResult.warnings)
  }

  let scienceError: string | null = null
  if (options.includeScience) {
    const scienceChunks = chunkParagraphs(scienceTargets(options.document.paragraphs), options.chunkChars)
    for (let index = 0; index < scienceChunks.length; index += 1) {
      options.onProgress(`Science check ${index + 1} of ${scienceChunks.length}`)
      try {
        const chunkResult = await reviewChunk({
          ...options,
          paragraphs: scienceChunks[index],
          mode: 'science',
          idPrefix: `s${index + 1}`,
        })
        summaries.push(chunkResult.summary)
        suggestions.push(...chunkResult.suggestions)
        warnings.push(...chunkResult.warnings)
        for (const source of chunkResult.sources) {
          if (!sources.some((item) => item.uri === source.uri)) sources.push(source)
        }
        if (options.provider === 'gemini' && !chunkResult.grounded) {
          warnings.push(`Science check ${index + 1} returned no search queries. Those notes are not literature-checked.`)
        }
      } catch (error) {
        scienceError = readableGeminiError(error)
        warnings.push(`Science pass stopped: ${scienceError}`)
        break
      }
    }
  }

  options.onProgress('')
  return {
    document: options.document,
    suggestions,
    summary: summaries.filter(Boolean).join('\n\n'),
    sources,
    warnings,
    scienceRan: options.includeScience,
    scienceError,
    disciplineTitle: options.disciplineTitle,
  }
}

async function reviewChunk(options: {
  provider: LlmProvider
  apiKey: string
  baseUrl?: string
  model: string
  systemInstruction: string
  document: LoadedDocument
  paragraphs: Paragraph[]
  mode: 'copyedit' | 'science'
  idPrefix: string
}): Promise<{ suggestions: Suggestion[]; warnings: string[]; summary: string; sources: GroundingSource[]; grounded: boolean }> {
  const search = options.mode === 'science' && options.provider === 'gemini'
  const prompt = formatChunk(options.paragraphs, options.document.paragraphs, options.mode, search)
  const reply = await generateReview({
    provider: options.provider,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    systemInstruction: options.systemInstruction,
    prompt,
    search,
  })
  let parsed = parseReply(reply.text, options.paragraphs, options.idPrefix, reply.grounded)
  if (parsed.unmatched.length > 0) {
    const missedIds = new Set(parsed.unmatched.map((message) => message.split(':')[0]?.trim()).filter(Boolean))
    const missed = options.paragraphs.filter((paragraph) => missedIds.has(paragraph.id))
    const retryPrompt = formatChunk(missed.length > 0 ? missed : options.paragraphs, options.document.paragraphs, options.mode, search)
    const retry = await generateReview({
      provider: options.provider,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      systemInstruction: options.systemInstruction,
      prompt: `${retryPrompt}\n\nThe previous finds were not verbatim. Return only an iedit-edits fence. Copy ~~old~~ exactly from the paragraph.\n\n${parsed.unmatched.join('\n')}`,
      search,
    })
    const second = parseReply(retry.text, options.paragraphs, `${options.idPrefix}r`, reply.grounded || retry.grounded)
    const recovered = new Set(second.suggestions.map((item) => item.paraId))
    const remaining = parsed.unmatched.filter((message) => !recovered.has(message.split(':')[0] ?? ''))
    parsed = {
      suggestions: [...parsed.suggestions, ...second.suggestions],
      unmatched: [...remaining, ...second.unmatched],
      summary: [parsed.summary, second.summary].filter(Boolean).join('\n\n'),
    }
  }
  return {
    suggestions: parsed.suggestions,
    warnings: parsed.unmatched,
    summary: parsed.summary,
    sources: reply.sources,
    grounded: reply.grounded,
  }
}

function parseReply(text: string, paragraphs: Paragraph[], idPrefix: string, grounded: boolean) {
  const extracted = extractEditFence(text)
  const edits = parseEditBody(extracted.body)
  const bound = bindEdits(edits, paragraphs, { idPrefix, grounded })
  const unmatched = !extracted.body.trim()
    ? ['The response did not include an iedit-edits fence.']
    : edits.length === 0
      ? ['The iedit-edits fence did not contain any paragraph blocks.']
      : bound.unmatched
  return { suggestions: bound.suggestions, unmatched, summary: extracted.summary }
}

function formatChunk(chunk: Paragraph[], all: Paragraph[], mode: 'copyedit' | 'science', search: boolean): string {
  const task = mode === 'copyedit' ? COPYEDIT_TASK : search ? SCIENCE_TASK : SCIENCE_TASK_UNCHECKED
  const lines = [task, '']
  const seen = new Set(chunk.map((paragraph) => paragraph.id))
  for (const paragraph of chunk) {
    const index = all.findIndex((item) => item.id === paragraph.id)
    const previous = index > 0 ? all[index - 1] : undefined
    if (previous && isEditable(previous.kind) && !seen.has(previous.id)) {
      lines.push(formatParagraph(previous, true))
      seen.add(previous.id)
    }
    lines.push(formatParagraph(paragraph, false))
  }
  return lines.join('\n\n')
}

function formatParagraph(paragraph: Paragraph, context: boolean): string {
  return [
    `### ${paragraph.id}`,
    `section: ${paragraph.section}`,
    context ? 'role: CONTEXT — do not edit' : 'role: edit',
    '',
    paragraph.text,
  ].join('\n')
}

function chunkParagraphs(paragraphs: Paragraph[], chunkChars: number): Paragraph[][] {
  const chunks: Paragraph[][] = []
  let current: Paragraph[] = []
  let size = 0
  for (const paragraph of paragraphs) {
    if (current.length > 0 && size + paragraph.text.length > chunkChars) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(paragraph)
    size += paragraph.text.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function scienceTargets(paragraphs: Paragraph[]): Paragraph[] {
  const editable = paragraphs.filter((paragraph) => isEditable(paragraph.kind))
  const focused = editable.filter((paragraph) =>
    /abstract|introduction|method|result|discussion|conclusion/i.test(paragraph.section)
    || /\\cite|et al\.|\(\d{4}\)/.test(paragraph.text),
  )
  return focused.length > 0 ? focused : editable
}
