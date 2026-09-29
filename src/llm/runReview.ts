import { generateReview, readableGeminiError, type ChatTurn } from './client.ts'
import { parallelSearch, parseSearchRequests, type SearchHit, type SearchRequest } from './parallelSearch.ts'
import type { LlmProvider } from './storage.ts'
import { interpretModelReply } from '../review/edits.ts'
import { projectParagraph } from '../review/richText.ts'
import { isEditable, type ChatLog, type GroundingSource, type LoadedDocument, type Paragraph, type ReviewSession, type Suggestion } from '../review/types.ts'
import { systemInstruction, type ReviewStep } from '../skills/index.ts'

export const BLOCK_PRESETS = [
  { id: 'low', chars: 80000, label: 'Low' },
  { id: 'medium', chars: 36000, label: 'Medium' },
  { id: 'high', chars: 9000, label: 'High' },
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

const COPYEDIT_TASK = `Copyedit this whole slice. Work through every paragraph marked role: edit, from the first to the last. Rewrite unclear sentences one sentence or clause at a time. Keep connectors such as Thus, However, and Because. A slice this size needs many wording changes, not a short sample of the worst ones. Paragraph text uses markdown for headings, emphasis, and links. Every wording change needs ~~old~~ copied from that text, a replacement, and [COMMENT-COPYEDIT: why]. Do not edit CONTEXT paragraphs. If earlier turns already suggested edits, do not repeat them. Return a short summary, then one iedit-edits fence.`

const SCIENCE_QUESTIONS = `Science review only. Return one iedit-search fence for the doubtful statements in the paragraphs marked role: edit. Do not write comments or wording changes. Do not edit CONTEXT paragraphs. If nothing looks doubtful, return an empty iedit-search fence. If earlier turns already made suggestions, do not repeat them.`

const SCIENCE_NOTES = `Science comments only. Use the search excerpts below. Return [COMMENT-SCIENCE: ...] notes in one iedit-edits fence, plus a short summary. If an excerpt does not settle a claim and a narrower query would help, you may add one iedit-search fence with at most three objectives. Do not add a search when the excerpts already settle the claim. Do not propose wording replacements. Do not edit CONTEXT paragraphs. If earlier turns already made suggestions, do not repeat them.`

const SCIENCE_NOTES_LAST = `Science comments only. Use the search excerpts below. This is the last round: if an excerpt does not settle a claim, write "could not verify", and do not emit an iedit-search fence. Return [COMMENT-SCIENCE: ...] notes in one iedit-edits fence, plus a short summary. Do not propose wording replacements. Do not edit CONTEXT paragraphs. If earlier turns already made suggestions, do not repeat them.`

const FOLLOW_UP_LIMIT = 3

export async function runReview(options: {
  provider: LlmProvider
  apiKey: string
  baseUrl?: string
  model: string
  disciplineBody: string
  document: LoadedDocument
  includeScience: boolean
  chunkChars: number
  customPrompt?: string
  parallelApiKey?: string
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
  const history: ChatTurn[] = []
  const log: ChatLog['turns'] = []
  const instructionFor = (step: ReviewStep) => appendCustomPrompt(systemInstruction(options.disciplineBody, step), options.customPrompt ?? '')
  const copyeditInstruction = instructionFor('copyedit')
  let loggedInstruction = copyeditInstruction
  const record = (instruction: string, turns: ChatTurn[]) => {
    if (instruction !== loggedInstruction) {
      log.push({ role: 'system', text: instruction })
      loggedInstruction = instruction
    }
    log.push(...turns)
  }

  const copyChunks = chunkParagraphs(editable, options.chunkChars)
  for (let index = 0; index < copyChunks.length; index += 1) {
    const copyCount = copyChunks.length > 1 ? ` (${index + 1} of ${copyChunks.length})` : ''
    options.onProgress(`Working on copy-edits${copyCount}`)
    const chunkResult = await reviewChunk({
      ...options,
      systemInstruction: copyeditInstruction,
      history,
      paragraphs: copyChunks[index],
      mode: 'copyedit',
      idPrefix: `c${index + 1}`,
    })
    history.push(...chunkResult.turns)
    record(copyeditInstruction, chunkResult.turns)
    summaries.push(chunkResult.summary)
    suggestions.push(...chunkResult.suggestions)
    warnings.push(...chunkResult.warnings)
  }

  let scienceError: string | null = null
  if (options.includeScience) {
    const scienceChunks = chunkParagraphs(scienceTargets(options.document.paragraphs), options.chunkChars)
    const search = parallelSearch({
      sessionId: crypto.randomUUID(),
      apiKey: options.parallelApiKey ?? '',
      model: options.model,
    })
    for (let index = 0; index < scienceChunks.length; index += 1) {
      const scienceCount = scienceChunks.length > 1 ? ` (${index + 1} of ${scienceChunks.length})` : ''
      try {
        const chunkResult = await reviewScienceChunk({
          paragraphs: scienceChunks[index],
          all: options.document.paragraphs,
          history,
          idPrefix: `s${index + 1}`,
          complete: (prompt, prior, step) => completeReview(options, instructionFor(step), prior, prompt),
          search,
          record: (step, turns) => record(instructionFor(step), turns),
          onProgress: (message) => options.onProgress(`${message}${scienceCount}`),
        })
        history.push(...chunkResult.turns)
        summaries.push(chunkResult.summary)
        suggestions.push(...chunkResult.suggestions)
        warnings.push(...chunkResult.warnings)
        for (const source of chunkResult.sources) {
          if (!sources.some((item) => item.uri === source.uri)) sources.push(source)
        }
        if (chunkResult.stop) {
          scienceError = `Science check ${index + 1} stopped: ${chunkResult.stopMessage}`
          warnings.push(scienceError)
          break
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
    chatLog: { system: copyeditInstruction, turns: log },
  }
}

async function reviewChunk(options: {
  provider: LlmProvider
  apiKey: string
  baseUrl?: string
  model: string
  systemInstruction: string
  document: LoadedDocument
  history: ChatTurn[]
  paragraphs: Paragraph[]
  mode: 'copyedit'
  idPrefix: string
}): Promise<{ suggestions: Suggestion[]; warnings: string[]; summary: string; sources: GroundingSource[]; grounded: boolean; turns: ChatTurn[] }> {
  const prompt = formatChunk(options.paragraphs, options.document.paragraphs, COPYEDIT_TASK)
  const reply = await generateReview({
    provider: options.provider,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    systemInstruction: options.systemInstruction,
    history: options.history,
    prompt,
    search: false,
  })
  const turns: ChatTurn[] = [
    { role: 'user', text: prompt },
    { role: 'model', text: reply.text },
  ]
  let parsed = interpretModelReply(reply.text, options.paragraphs, { idPrefix: options.idPrefix, grounded: reply.grounded })
  if (parsed.unmatched.length > 0) {
    const missedIds = new Set(parsed.unmatched.map((message) => message.split(':')[0]?.trim()).filter(Boolean))
    const missed = options.paragraphs.filter((paragraph) => missedIds.has(paragraph.id))
    const retryPrompt = `${formatChunk(missed.length > 0 ? missed : options.paragraphs, options.document.paragraphs, COPYEDIT_TASK)}\n\nThe previous finds were not verbatim. Return only an iedit-edits fence. Copy ~~old~~ exactly from the paragraph.\n\n${parsed.unmatched.join('\n')}`
    const retry = await generateReview({
      provider: options.provider,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      systemInstruction: options.systemInstruction,
      history: [...options.history, ...turns],
      prompt: retryPrompt,
      search: false,
    })
    turns.push({ role: 'user', text: retryPrompt }, { role: 'model', text: retry.text })
    const second = interpretModelReply(retry.text, options.paragraphs, {
      idPrefix: `${options.idPrefix}r`,
      grounded: reply.grounded || retry.grounded,
    })
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
    turns,
  }
}

function appendCustomPrompt(instruction: string, customPrompt: string): string {
  const extra = customPrompt.trim()
  if (!extra) return instruction
  return `${instruction}\n\n---\n\n# Author instructions\n\nFollow these extra instructions for this manuscript:\n\n${extra}`
}

export async function reviewScienceChunk(options: {
  paragraphs: Paragraph[]
  all: Paragraph[]
  history: ChatTurn[]
  idPrefix: string
  complete: (prompt: string, history: ChatTurn[], step: ReviewStep) => Promise<string>
  search: (requests: SearchRequest[]) => Promise<SearchHit>
  record: (step: ReviewStep, turns: ChatTurn[]) => void
  onProgress?: (message: string) => void
}): Promise<{ suggestions: Suggestion[]; warnings: string[]; summary: string; sources: GroundingSource[]; turns: ChatTurn[]; stop: boolean; stopMessage: string }> {
  const report = options.onProgress ?? (() => undefined)
  report('Checking dodgy facts')
  const askPrompt = formatChunk(options.paragraphs, options.all, SCIENCE_QUESTIONS)
  const asked = await options.complete(askPrompt, options.history, 'science-review')
  const askTurns: ChatTurn[] = [
    { role: 'user', text: askPrompt },
    { role: 'model', text: asked },
  ]
  options.record('science-review', askTurns)
  const turns: ChatTurn[] = [...askTurns]
  const requests = parseSearchRequests(asked)
  if (requests.length === 0) {
    return { suggestions: [], warnings: [], summary: '', sources: [], turns, stop: true, stopMessage: 'the model did not request a search.' }
  }
  report('Checking dodgy facts')
  const found = await options.search(requests)
  report('Formulating comments')
  let parsed = await commentOn(found.excerpts, SCIENCE_NOTES, options.idPrefix)
  const sources = [...found.sources]
  const followRequests = parseSearchRequests(turns.at(-1)?.text ?? '').slice(0, FOLLOW_UP_LIMIT)
  if (followRequests.length > 0) {
    let follow: SearchHit
    try {
      report('Checking dodgy facts')
      follow = await options.search(followRequests)
    } catch (error) {
      parsed = await recoverUnmatched(parsed)
      const message = error instanceof Error ? error.message : String(error)
      return stopped(parsed, sources, message ? `the follow-up search failed: ${message}` : 'the follow-up search failed.')
    }
    if (follow.sources.length === 0) {
      parsed = await recoverUnmatched(parsed)
      return stopped(parsed, sources, 'the follow-up search returned no sources.')
    }
    report('Formulating final comments')
    const again = await commentOn(follow.excerpts, SCIENCE_NOTES_LAST, `${options.idPrefix}f`)
    parsed = {
      suggestions: [...parsed.suggestions, ...again.suggestions],
      unmatched: [...parsed.unmatched, ...again.unmatched],
      summary: [parsed.summary, again.summary].filter(Boolean).join('\n\n'),
    }
    for (const source of follow.sources) {
      if (!sources.some((item) => item.uri === source.uri)) sources.push(source)
    }
  }
  parsed = await recoverUnmatched(parsed)
  return {
    suggestions: parsed.suggestions,
    warnings: parsed.unmatched,
    summary: parsed.summary,
    sources,
    turns,
    stop: false,
    stopMessage: '',
  }

  async function commentOn(excerpts: string, instruction: string, idPrefix: string) {
    const notePrompt = `${instruction}\n\n# Search excerpts\n\n${excerpts}\n\n${formatChunk(options.paragraphs, options.all, 'Use the excerpts above for these paragraphs.')}`
    const noted = await options.complete(notePrompt, [...options.history, ...turns], 'science-comment')
    const noteTurns: ChatTurn[] = [
      { role: 'user', text: notePrompt },
      { role: 'model', text: noted },
    ]
    options.record('science-comment', noteTurns)
    turns.push(...noteTurns)
    return interpretModelReply(noted, options.paragraphs, { idPrefix, grounded: true })
  }

  async function recoverUnmatched(current: { suggestions: Suggestion[]; unmatched: string[]; summary: string }) {
    if (current.unmatched.length === 0) return current
    report('Trying that wording again')
    const retryPrompt = `The previous finds were not verbatim. Return only an iedit-edits fence. Copy ~~old~~ exactly from the paragraph.\n\n${current.unmatched.join('\n')}`
    const retry = await options.complete(retryPrompt, [...options.history, ...turns], 'science-comment')
    const retryTurns: ChatTurn[] = [
      { role: 'user', text: retryPrompt },
      { role: 'model', text: retry },
    ]
    options.record('science-comment', retryTurns)
    turns.push(...retryTurns)
    const second = interpretModelReply(retry, options.paragraphs, { idPrefix: `${options.idPrefix}r`, grounded: true })
    const recovered = new Set(second.suggestions.map((item) => item.paraId))
    const remaining = current.unmatched.filter((message) => !recovered.has(message.split(':')[0] ?? ''))
    return {
      suggestions: [...current.suggestions, ...second.suggestions],
      unmatched: [...remaining, ...second.unmatched],
      summary: [current.summary, second.summary].filter(Boolean).join('\n\n'),
    }
  }

  function stopped(
    current: { suggestions: Suggestion[]; unmatched: string[]; summary: string },
    keptSources: GroundingSource[],
    stopMessage: string,
  ) {
    return {
      suggestions: current.suggestions,
      warnings: current.unmatched,
      summary: current.summary,
      sources: keptSources,
      turns,
      stop: true,
      stopMessage,
    }
  }
}

async function completeReview(
  options: {
    provider: LlmProvider
    apiKey: string
    baseUrl?: string
    model: string
  },
  systemInstruction: string,
  history: ChatTurn[],
  prompt: string,
): Promise<string> {
  const reply = await generateReview({
    provider: options.provider,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    systemInstruction,
    history,
    prompt,
    search: false,
  })
  return reply.text
}

function formatChunk(chunk: Paragraph[], all: Paragraph[], task: string): string {
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
    projectParagraph(paragraph).markdown,
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

const REFERENCE_HEADING = /^(references|bibliography|works cited|literature cited)\.?$/i
const AFTER_REFERENCES = /^(appendix|acknowledg|supplement|data availability)/i

export function scienceTargets(paragraphs: Paragraph[]): Paragraph[] {
  let inReferences = false
  const body: Paragraph[] = []
  for (const paragraph of paragraphs) {
    if (!isEditable(paragraph.kind)) continue
    const text = paragraph.text.trim()
    if (REFERENCE_HEADING.test(text) || REFERENCE_HEADING.test(paragraph.section.trim())) {
      inReferences = true
      continue
    }
    if (inReferences && AFTER_REFERENCES.test(text)) inReferences = false
    if (inReferences) continue
    body.push(paragraph)
  }
  const focused = body.filter((paragraph) =>
    /abstract|introduction|method|result|discussion|conclusion|background/i.test(paragraph.section),
  )
  return focused.length > 0 ? focused : body
}
