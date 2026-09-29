import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewScienceChunk, scienceTargets } from './runReview.ts'
import { parallelSearch, parseSearchRequests } from './parallelSearch.ts'
import type { Paragraph } from '../review/types.ts'

const paragraph: Paragraph = {
  id: 'p-001',
  text: 'The Late Cretaceous sandstone is thick.',
  kind: 'body',
  section: 'Introduction',
  inTable: false,
}

describe('search questions', () => {
  it('reads objectives and queries from the fence', () => {
    const requests = parseSearchRequests(`
Notes before.
\`\`\`iedit-search
objective: Does the cited paper report this age?
query: smith 2019 sandstone age
query: upper cretaceous formal name

objective: Is MLP a fair model here?
query: multilayer perceptron rock strength
\`\`\`
`)
    expect(requests).toEqual([
      {
        objective: 'Does the cited paper report this age?',
        queries: ['smith 2019 sandstone age', 'upper cretaceous formal name'],
      },
      {
        objective: 'Is MLP a fair model here?',
        queries: ['multilayer perceptron rock strength'],
      },
    ])
  })

  it('returns nothing when the fence is empty', () => {
    expect(parseSearchRequests('```iedit-search\n\n```')).toEqual([])
  })
})

describe('science targets', () => {
  it('keeps doubtful body statements and skips the reference list', () => {
    const paragraphs: Paragraph[] = [
      { ...paragraph, section: 'Manuscript' },
      { ...paragraph, id: 'p-002', text: 'F1 rises from 0.480 to 0.558 (16%).', section: 'Manuscript' },
      { ...paragraph, id: 'p-003', text: 'References', section: 'Manuscript' },
      { ...paragraph, id: 'p-004', text: '1. Smith et al. Sandstone ages (2019). https://doi.org/10.1000/example', section: 'Manuscript' },
      { ...paragraph, id: 'p-005', text: 'Appendix', section: 'Manuscript' },
      { ...paragraph, id: 'p-006', text: 'The supplement lists the splits.', section: 'Manuscript' },
    ]
    expect(scienceTargets(paragraphs).map((item) => item.id)).toEqual(['p-001', 'p-002', 'p-005', 'p-006'])
  })

  it('drops a References section even when the body cites a year', () => {
    const paragraphs: Paragraph[] = [
      paragraph,
      { ...paragraph, id: 'p-002', text: 'Smith et al. (2019) report 66 Ma.', section: 'Discussion' },
      { ...paragraph, id: 'p-003', text: 'Smith et al. (2019). Sandstone ages.', section: 'References' },
    ]
    expect(scienceTargets(paragraphs).map((item) => item.id)).toEqual(['p-001', 'p-002'])
  })
})

describe('science chunk', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stops when the model does not ask for a search', async () => {
    const search = vi.fn()
    const result = await reviewScienceChunk({
      paragraphs: [paragraph],
      all: [paragraph],
      history: [],
      idPrefix: 's1',
      complete: async () => 'Nothing to check.',
      search,
      record: () => undefined,
    })
    expect(result.stop).toBe(true)
    expect(result.suggestions).toEqual([])
    expect(search).not.toHaveBeenCalled()
  })

  it('marks notes search-checked only after excerpts come back', async () => {
    const search = vi.fn(async () => ({
      excerpts: '## Age\n### Geology Page\nhttps://example.com/age\nThe Late Cretaceous ends at 66 Ma.',
      sources: [{ title: 'Geology Page', uri: 'https://example.com/age' }],
    }))
    const replies = [
      `\`\`\`iedit-search
objective: Is Late Cretaceous the formal name?
query: late cretaceous formal name
\`\`\``,
      `The age is the younger Cretaceous epoch.
\`\`\`iedit-edits
### p-001
[COMMENT-SCIENCE: The excerpt supports Late Cretaceous as the younger epoch. This is a formal name.]
\`\`\``,
    ]
    const result = await reviewScienceChunk({
      paragraphs: [paragraph],
      all: [paragraph],
      history: [],
      idPrefix: 's1',
      complete: async () => replies.shift() ?? '',
      search,
      record: () => undefined,
    })
    expect(result.stop).toBe(false)
    expect(search).toHaveBeenCalledOnce()
    expect(result.sources).toEqual([{ title: 'Geology Page', uri: 'https://example.com/age' }])
    expect(result.suggestions[0]?.grounded).toBe(true)
    expect(result.suggestions[0]?.author).toBe('AI-science')
  })

  it('searches one follow-up fence and ignores a fence on the last comment', async () => {
    const seen: { objective: string }[][] = []
    const search = vi.fn(async (requests: { objective: string }[]) => {
      seen.push(requests)
      const index = seen.length
      return {
        excerpts: `## Round ${index}`,
        sources: [{ title: `Source ${index}`, uri: `https://example.com/${index}` }],
      }
    })
    const prompts: string[] = []
    const replies = [
      `\`\`\`iedit-search
objective: Is Late Cretaceous the formal name?
query: late cretaceous formal name
\`\`\``,
      `Checked the name.
\`\`\`iedit-edits
### p-001
[COMMENT-SCIENCE: The first excerpt supports the formal name.]
\`\`\`
\`\`\`iedit-search
objective: Which epoch does the excerpt name?
query: late cretaceous epoch name
objective: What is the end date of that epoch?
query: late cretaceous end date
objective: Is the sandstone age in the excerpt?
query: late cretaceous sandstone age
objective: Is a fourth query kept?
query: fourth query dropped
\`\`\`
`,
      `The last round.
\`\`\`iedit-edits
### p-001
[COMMENT-SCIENCE: The follow-up excerpt names the younger epoch.]
\`\`\`
\`\`\`iedit-search
objective: Ask once more?
query: should not be searched
\`\`\``,
    ]
    const result = await reviewScienceChunk({
      paragraphs: [paragraph],
      all: [paragraph],
      history: [],
      idPrefix: 's1',
      complete: async (prompt) => {
        prompts.push(prompt)
        return replies.shift() ?? ''
      },
      search,
      record: () => undefined,
    })
    expect(result.stop).toBe(false)
    expect(search).toHaveBeenCalledTimes(2)
    expect(seen[1]?.map((item) => item.objective)).toEqual([
      'Which epoch does the excerpt name?',
      'What is the end date of that epoch?',
      'Is the sandstone age in the excerpt?',
    ])
    expect(prompts[1]).toContain('at most three objectives')
    expect(prompts[2]).toContain('This is the last round')
    expect(result.suggestions.map((item) => item.comment)).toEqual([
      'The first excerpt supports the formal name.',
      'The follow-up excerpt names the younger epoch.',
    ])
    expect(result.suggestions.every((item) => item.grounded)).toBe(true)
    expect(result.sources).toEqual([
      { title: 'Source 1', uri: 'https://example.com/1' },
      { title: 'Source 2', uri: 'https://example.com/2' },
    ])
  })

  it('keeps the first notes when the follow-up search fails', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce({
        excerpts: '## Age',
        sources: [{ title: 'Geology Page', uri: 'https://example.com/age' }],
      })
      .mockRejectedValueOnce(new Error('The web search returned no sources.'))
    const replies = [
      `\`\`\`iedit-search
objective: Is Late Cretaceous the formal name?
query: late cretaceous formal name
\`\`\``,
      `\`\`\`iedit-edits
### p-001
[COMMENT-SCIENCE: The first excerpt supports the formal name.]
\`\`\`
\`\`\`iedit-search
objective: Which epoch does the excerpt name?
query: late cretaceous epoch name
\`\`\``,
    ]
    const result = await reviewScienceChunk({
      paragraphs: [paragraph],
      all: [paragraph],
      history: [],
      idPrefix: 's1',
      complete: async () => replies.shift() ?? '',
      search,
      record: () => undefined,
    })
    expect(result.stop).toBe(true)
    expect(result.stopMessage).toContain('the follow-up search failed')
    expect(search).toHaveBeenCalledTimes(2)
    expect(result.suggestions.map((item) => item.comment)).toEqual([
      'The first excerpt supports the formal name.',
    ])
    expect(result.sources).toEqual([{ title: 'Geology Page', uri: 'https://example.com/age' }])
  })

  it('names each wait while a chunk checks facts and writes comments', async () => {
    const notes: string[] = []
    const search = vi.fn()
      .mockResolvedValueOnce({ excerpts: '## Age', sources: [{ title: 'A', uri: 'https://example.com/a' }] })
      .mockResolvedValueOnce({ excerpts: '## Epoch', sources: [{ title: 'B', uri: 'https://example.com/b' }] })
    const replies = [
      `\`\`\`iedit-search
objective: Is Late Cretaceous the formal name?
query: late cretaceous formal name
\`\`\``,
      `\`\`\`iedit-edits
### p-001
[COMMENT-SCIENCE: The first excerpt supports the formal name.]
\`\`\`
\`\`\`iedit-search
objective: Which epoch does the excerpt name?
query: late cretaceous epoch name
\`\`\``,
      `\`\`\`iedit-edits
### p-001
[COMMENT-SCIENCE: The follow-up excerpt names the younger epoch.]
\`\`\``,
    ]
    await reviewScienceChunk({
      paragraphs: [paragraph],
      all: [paragraph],
      history: [],
      idPrefix: 's1',
      complete: async () => replies.shift() ?? '',
      search,
      record: () => undefined,
      onProgress: (message) => notes.push(message),
    })
    expect(notes).toEqual([
      'Checking dodgy facts',
      'Checking dodgy facts',
      'Formulating comments',
      'Checking dodgy facts',
      'Formulating final comments',
    ])
  })
})

describe('parallel search client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the review session and reads sources from the tool result', async () => {
    const calls: { method?: string; arguments?: { session_id?: string; model_name?: string } }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        method?: string
        params?: { arguments?: { session_id?: string; model_name?: string } }
      }
      calls.push({ method: body.method, arguments: body.params?.arguments })
      const headers = new Headers(init.headers)
      expect(headers.get('Authorization')).toBe('Bearer parallel-key')
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'Mcp-Session-Id': 'mcp-1', 'Content-Type': 'application/json' },
        })
      }
      if (body.method === 'notifications/initialized') return new Response('', { status: 202 })
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              results: [{ url: 'https://example.com/age', title: 'Geology Page', excerpts: ['The Late Cretaceous ends at 66 Ma.'] }],
            }),
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const hit = await parallelSearch({
      sessionId: 'review-session-0123456789abcdef',
      apiKey: 'parallel-key',
      model: 'gpt-4.1-mini',
    })([{ objective: 'Is Late Cretaceous the formal name?', queries: ['late cretaceous formal name'] }])

    expect(calls.map((call) => call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    expect(calls[2]?.arguments?.session_id).toBe('review-session-0123456789abcdef')
    expect(calls[2]?.arguments?.model_name).toBe('gpt-4.1-mini')
    expect(hit.sources).toEqual([{ title: 'Geology Page', uri: 'https://example.com/age' }])
    expect(hit.excerpts).toContain('https://example.com/age')
    expect(hit.excerpts).toContain('66 Ma')
  })
})
