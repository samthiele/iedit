import type { ReviewSession } from '../review/types.ts'
import { editedStem } from '../review/types.ts'

export function reviewMarkdown(session: ReviewSession): string {
  const accepted = session.suggestions.filter((item) => item.status === 'accepted')
  const lines = [
    `# Review of ${session.document.fileName}`,
    '',
    `Discipline: ${session.disciplineTitle}`,
    '',
    '## Summary',
    '',
    session.summary || 'No summary was returned.',
    '',
  ]

  if (session.scienceRan) {
    lines.push(
      'Science comments use Gemini Google Search grounding. That is narrower than a full literature check.',
      '',
    )
  }
  if (session.sources.length > 0) {
    lines.push('## Sources returned by grounding', '')
    for (const source of session.sources) {
      lines.push(`- ${source.title}: ${source.uri}`)
    }
    lines.push('')
  }
  if (session.warnings.length > 0) {
    lines.push('## Warnings', '')
    for (const warning of session.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }

  lines.push('## Accepted suggestions', '')
  if (accepted.length === 0) {
    lines.push('None accepted.', '')
  }
  for (const suggestion of accepted) {
    lines.push(`### ${suggestion.paraId}`, '')
    if (suggestion.find) {
      lines.push(`~~${suggestion.find}~~`, '')
      lines.push(`**<u>${suggestion.insert}</u>**`, '')
    }
    const tag = suggestion.author === 'AI-science' ? 'COMMENT-SCIENCE' : 'COMMENT-COPYEDIT'
    lines.push(`[${tag}: ${suggestion.comment}]`, '')
  }

  return lines.join('\n')
}

export function markdownFileName(fileName: string): string {
  return `${editedStem(fileName)}.md`
}
