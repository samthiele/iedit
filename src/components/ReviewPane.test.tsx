import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { wordDiff } from '../review/diff.ts'
import type { ReviewSession, Suggestion, SuggestionStatus } from '../review/types.ts'
import { ReviewPane, stackCommentTops } from './ReviewPane.tsx'

describe('review comments', () => {
  let root: Root | null = null
  const host = document.createElement('div')
  document.body.appendChild(host)

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host.replaceChildren()
  })

  it('places the copy-edit note beside the redline and accepts both together', async () => {
    const seen: SuggestionStatus[] = []
    root = createRoot(host)
    await act(async () => {
      root?.render(<ReviewPane session={fixture('pending')} onChange={(suggestions) => {
        seen.push(suggestions[0].status)
      }} />)
    })

    const line = host.querySelector('.para-line')
    const bubble = host.querySelector('.comment-bubble-copyedit')
    expect(line?.textContent).toContain('such as')
    expect(line?.textContent).toContain('specifically')
    expect(line?.querySelector('.del')?.textContent).toBe('such as')
    expect(line?.textContent).not.toContain('intensifier')
    expect(bubble?.textContent).toContain('AI-copyedit')
    expect(bubble?.textContent).toContain('intensifier')
    expect(line?.contains(bubble ?? null)).toBe(false)

    const accept = [...(bubble?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Accept')
    await act(async () => {
      accept?.click()
    })
    expect(seen).toEqual(['accepted'])
  })

  it('bolds the matching passage while a comment is hovered', async () => {
    root = createRoot(host)
    await act(async () => {
      root?.render(<ReviewPane session={fixture('pending')} onChange={() => undefined} />)
    })
    const bubble = host.querySelector('.comment-bubble-copyedit')
    await act(async () => {
      bubble?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(host.querySelector('.redline.is-hot')?.textContent).toContain('such as')

    await act(async () => {
      bubble?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    })
    expect(host.querySelector('.redline.is-hot')).toBeNull()
  })

  it('bolds the whole paragraph when a science note has no quoted span', async () => {
    const session = fixture('pending')
    session.suggestions.push({
      id: 's2',
      paraId: 'p-001',
      find: '',
      insert: '',
      comment: 'Checked the description of Hapke\'s model.',
      author: 'AI-science',
      status: 'pending',
      span: null,
      segments: [],
      grounded: false,
    })
    root = createRoot(host)
    await act(async () => {
      root?.render(<ReviewPane session={session} onChange={() => undefined} />)
    })
    const bubble = host.querySelector('.comment-bubble-science')
    await act(async () => {
      bubble?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(host.querySelector('.para-line.is-hovered')).not.toBeNull()
  })

  it('aligns a comment with its passage and pushes a colliding one down', () => {
    expect(stackCommentTops([120, 0], [40, 36], 19)).toEqual([120, 0])
    expect(stackCommentTops([0, 10], [48, 40], 19)).toEqual([0, 67])
    expect(stackCommentTops([0, 0], [30, 30], 19)).toEqual([0, 49])
  })

  it('writes an accepted suggestion into the paragraph and restores the original on reject', async () => {
    root = createRoot(host)
    await act(async () => {
      root?.render(<ReviewPane session={fixture('accepted')} onChange={() => undefined} />)
    })
    const accepted = host.querySelector('.para-line')
    expect(accepted?.textContent).toContain('specifically')
    expect(accepted?.textContent).not.toContain('such as')
    expect(accepted?.querySelector('.del')).toBeNull()

    await act(async () => {
      root?.render(<ReviewPane session={fixture('rejected')} onChange={() => undefined} />)
    })
    const rejected = host.querySelector('.para-line')
    expect(rejected?.textContent).toContain('such as')
    expect(rejected?.textContent).not.toContain('specifically')
    expect(rejected?.querySelector('.redline')).toBeNull()
  })

  it('renders headings, emphasis, and pipe tables', async () => {
    const session = fixture('pending')
    session.document.paragraphs = [
      {
        id: 'p-001',
        text: 'Models such as transformers.',
        kind: 'heading',
        level: 2,
        section: 'Introduction',
        inTable: false,
        marks: [{ start: 0, end: 6, style: 'bold' }],
      },
      {
        id: 'p-002',
        text: 'A *measured* value with p < 0.05.',
        kind: 'body',
        section: 'Introduction',
        inTable: false,
      },
      {
        id: 'p-003',
        text: '| Mineral | Band |\n| --- | --- |\n| H2O | 1800–2120 |',
        kind: 'table',
        section: 'Introduction',
        inTable: true,
      },
    ]
    root = createRoot(host)
    await act(async () => {
      root?.render(<ReviewPane session={session} onChange={() => undefined} />)
    })
    expect(host.querySelector('h2.md-heading')?.textContent).toContain('Models')
    expect(host.querySelector('h2 strong')?.textContent).toBe('Models')
    expect(host.querySelector('em')?.textContent).toBe('measured')
    expect(host.textContent).toContain('p < 0.05')
    const table = host.querySelector('table')
    expect(table?.querySelectorAll('th')).toHaveLength(2)
    expect(table?.textContent).toContain('H2O')
    expect(table?.textContent).not.toContain('---')
    expect(host.querySelector('.del')?.textContent).toBe('such as')
  })

  it('keeps the science note inside the collapsed summary', async () => {
    root = createRoot(host)
    const session = fixture('pending')
    session.summary = 'Checked the age claim.'
    session.scienceRan = true
    session.sources = [{ title: 'Geology Page', uri: 'https://example.com/age' }]
    await act(async () => {
      root?.render(<ReviewPane session={session} onChange={() => undefined} />)
    })
    const details = host.querySelector('details.summary')
    expect(details).toBeInstanceOf(HTMLDetailsElement)
    expect((details as HTMLDetailsElement).open).toBe(false)
    expect(details?.textContent).toContain('Science comments use a web search.')
    expect(details?.textContent).toContain('Checked the age claim.')
    expect(details?.textContent).toContain('Geology Page')
    expect(host.querySelector('.review > .banner')).toBeNull()
  })
})

function fixture(status: SuggestionStatus): ReviewSession {
  const find = 'such as'
  const insert = 'specifically'
  const suggestion: Suggestion = {
    id: 's1',
    paraId: 'p-001',
    find,
    insert,
    comment: 'Removed "Significantly" as an intensifier and tightened the sentence structure.',
    author: 'AI-copyedit',
    status,
    span: { start: 7, end: 14 },
    segments: wordDiff(find, insert),
    grounded: false,
  }
  return {
    document: {
      fileName: 'draft.docx',
      kind: 'docx',
      paragraphs: [{
        id: 'p-001',
        text: 'Models such as transformers.',
        kind: 'body',
        section: 'Introduction',
        inTable: false,
      }],
    },
    suggestions: [suggestion],
    summary: '',
    sources: [],
    warnings: [],
    scienceRan: false,
    scienceError: null,
    disciplineTitle: 'Geoscience',
    chatLog: { system: '', turns: [] },
  }
}
