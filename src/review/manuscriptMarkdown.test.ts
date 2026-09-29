import { describe, expect, it } from 'vitest'
import { wordDiff } from './diff.ts'
import { manuscriptSource } from './manuscriptMarkdown.ts'
import type { Suggestion } from './types.ts'

describe('manuscript markdown', () => {
  it('keeps a pending redline and escapes raw angle brackets', () => {
    const text = 'Models such as transformers, p < 0.05.'
    const find = 'such as'
    const start = text.indexOf(find)
    const suggestion: Suggestion = {
      id: 's1',
      paraId: 'p-001',
      find,
      insert: 'specifically',
      comment: 'Tighten.',
      author: 'AI-copyedit',
      status: 'pending',
      span: { start, end: start + find.length },
      segments: wordDiff(find, 'specifically'),
      grounded: false,
    }
    const source = manuscriptSource(text, [suggestion], [{ start: 0, end: 6, style: 'bold' }], 's1')
    expect(source).toContain('<strong>Models</strong>')
    expect(source).toContain('class="redline is-hot"')
    expect(source).toContain('data-suggestion="s1"')
    expect(source).toContain('<span class="del">such as</span>')
    expect(source).toContain('p &lt; 0.05.')
  })

  it('keeps bold inside the redline and leaves underscores as text', () => {
    const text = 'The offset is large_enough.'
    const find = 'offset'
    const start = text.indexOf(find)
    const suggestion: Suggestion = {
      id: 's1',
      paraId: 'p-001',
      find,
      insert: 'shift',
      comment: 'Use the plainer noun.',
      author: 'AI-copyedit',
      status: 'pending',
      span: { start, end: start + find.length },
      segments: wordDiff(find, 'shift'),
      grounded: false,
    }
    const source = manuscriptSource(text, [suggestion], [{ start, end: start + find.length, style: 'bold' }])
    expect(source).toContain('<span class="del"><strong>offset</strong></span>')
    expect(source).toContain('large&#95;enough.')
  })
})
