import copyEditRaw from './copy-edit.md?raw'
import scienceReviewRaw from './science-review.md?raw'
import scienceCommentRaw from './science-comment.md?raw'
import geoscienceRaw from './disciplines/geoscience.md?raw'
import { parseSkill } from './frontmatter.ts'

export type DisciplineSkill = {
  id: string
  title: string
  body: string
  builtin: boolean
}

export type ReviewStep = 'copyedit' | 'science-review' | 'science-comment'

const STEP_SKILL: Record<ReviewStep, string> = {
  copyedit: copyEditRaw.trim(),
  'science-review': scienceReviewRaw.trim(),
  'science-comment': scienceCommentRaw.trim(),
}

const geoscience = parseSkill(geoscienceRaw, 'Geoscience')

export const BUILTIN_DISCIPLINES: DisciplineSkill[] = [
  { id: 'geoscience', builtin: true, title: geoscience.title, body: geoscience.body },
]

export function systemInstruction(disciplineBody: string, step: ReviewStep = 'copyedit'): string {
  return `${STEP_SKILL[step]}\n\n---\n\n# Active discipline\n\n${disciplineBody.trim()}`
}
