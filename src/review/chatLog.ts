import { interpretModelReply } from './edits.ts'
import type { ChatLog, LoadedDocument, ReviewSession } from './types.ts'

const ROLE = /^(system|user|model)$/

export function parseChatLog(text: string): ChatLog {
  const blocks: { role: string; lines: string[] }[] = []
  let current: { role: string; lines: string[] } | null = null
  for (const line of text.split(/\r?\n/)) {
    if (ROLE.test(line)) {
      current = { role: line, lines: [] }
      blocks.push(current)
      continue
    }
    current?.lines.push(line)
  }

  let system = ''
  const turns: ChatLog['turns'] = []
  for (const block of blocks) {
    const text = block.lines.join('\n').trim()
    if (block.role === 'system' && !system) {
      system = text
      continue
    }
    if (block.role === 'system' || block.role === 'user' || block.role === 'model') {
      turns.push({ role: block.role, text })
    }
  }
  return { system, turns }
}

export function sessionFromChatLog(document: LoadedDocument, log: ChatLog): ReviewSession {
  const suggestions = []
  const summaries: string[] = []
  const warnings: string[] = []
  let modelIndex = 0
  for (const turn of log.turns) {
    if (turn.role !== 'model') continue
    modelIndex += 1
    const parsed = interpretModelReply(turn.text, document.paragraphs, {
      idPrefix: `log${modelIndex}`,
      grounded: false,
    })
    suggestions.push(...parsed.suggestions)
    if (parsed.summary) summaries.push(parsed.summary)
    warnings.push(...parsed.unmatched)
  }

  const discipline = log.system.match(/# Active discipline\s+#\s+([^\n]+)/)
  return {
    document,
    suggestions,
    summary: summaries.join('\n\n'),
    sources: [],
    warnings,
    scienceRan: suggestions.some((suggestion) => suggestion.author === 'AI-science'),
    scienceError: null,
    disciplineTitle: discipline?.[1]?.trim() || 'Geoscience',
    chatLog: log,
  }
}
