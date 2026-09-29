import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAiMessageText, openAiModelIds, testConnection } from './client.ts'

describe('OpenAI-compatible replies', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads model ids from OpenAI and Open WebUI payloads', () => {
    expect(openAiModelIds({ data: [{ id: 'llama3:latest' }, { id: 'qwen2.5' }] })).toEqual([
      'llama3:latest',
      'qwen2.5',
    ])
    expect(openAiModelIds([{ name: 'local-model' }])).toEqual(['local-model'])
  })

  it('accepts a key when the selected model replies', async () => {
    const seen: { model?: string; max_tokens?: number; authorization?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model?: string; max_tokens?: number }
      const headers = new Headers(init.headers)
      seen.push({ model: body.model, max_tokens: body.max_tokens, authorization: headers.get('Authorization') ?? '' })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }))
    await testConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    })
    expect(seen).toEqual([{
      model: 'gpt-4.1-mini',
      max_tokens: 16,
      authorization: 'Bearer sk-test',
    }])
  })

  it('reports when the selected model rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Incorrect API key provided.' },
    }), { status: 401 })))
    await expect(testConnection({
      provider: 'openai',
      apiKey: 'sk-bad',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    })).rejects.toThrow('Incorrect API key provided.')
  })

  it('reads chat text from a completion payload', () => {
    expect(openAiMessageText({
      choices: [{ message: { content: '```iedit-edits\n### p-001\n```' } }],
    })).toContain('iedit-edits')
  })
})
