import { describe, expect, it } from 'vitest'
import { systemInstruction } from './index.ts'

const discipline = '# Geoscience\n\nKeep formal names capitalised.'

describe('writing skills', () => {
  it('sends only the skill for the current step, plus the discipline', () => {
    const copyedit = systemInstruction(discipline, 'copyedit')
    const review = systemInstruction(discipline, 'science-review')
    const comment = systemInstruction(discipline, 'science-comment')
    expect(copyedit).toContain('[COMMENT-COPYEDIT:')
    expect(copyedit).toContain('# Geoscience')
    expect(copyedit).not.toContain('iedit-search')
    expect(review).toContain('iedit-search')
    expect(review).not.toContain('[COMMENT-COPYEDIT:')
    expect(comment).toContain('[COMMENT-SCIENCE:')
    expect(comment).toContain('iedit-search')
    expect(comment).toContain('last round')
  })
})
