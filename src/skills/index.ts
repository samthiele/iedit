import geoscienceRaw from './disciplines/geoscience.md?raw'
import writingRaw from './scientific-writing.md?raw'
import { parseSkill } from './frontmatter.ts'

export type DisciplineSkill = {
  id: string
  title: string
  body: string
  builtin: boolean
}

const geoscience = parseSkill(geoscienceRaw, 'Geoscience')

export const SCIENTIFIC_WRITING = writingRaw.trim()

export const BUILTIN_DISCIPLINES: DisciplineSkill[] = [
  { id: 'geoscience', builtin: true, title: geoscience.title, body: geoscience.body },
]

export function systemInstruction(disciplineBody: string): string {
  return `${SCIENTIFIC_WRITING}\n\n---\n\n# Active discipline\n\n${disciplineBody.trim()}`
}
