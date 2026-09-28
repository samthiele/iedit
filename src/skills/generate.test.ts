import { describe, expect, it } from 'vitest'
import { skillFromReply, skillPrompt } from './generate.ts'

describe('generated discipline skills', () => {
  it('asks for a skill in the shape of the geoscience example', () => {
    const prompt = skillPrompt('Petrology', 'Capitalise formal rock names.')
    expect(prompt).toContain('title: Geoscience')
    expect(prompt).toContain('Petrology')
    expect(prompt).toContain('Capitalise formal rock names.')
  })

  it('keeps the chosen name and drops a markdown fence', () => {
    const skill = skillFromReply('Petrology', '```markdown\n---\ntitle: Other\n---\n\n# Petrology\n\n- Capitalise formal rock names.\n```')
    expect(skill.title).toBe('Petrology')
    expect(skill.body).toContain('# Petrology')
    expect(skill.file.startsWith('---\ntitle: Petrology\n---')).toBe(true)
  })
})
