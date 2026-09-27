import { describe, expect, it } from 'vitest'
import { openAiMessageText, openAiModelIds } from './client.ts'

describe('OpenAI-compatible replies', () => {
  it('reads model ids from OpenAI and Open WebUI payloads', () => {
    expect(openAiModelIds({ data: [{ id: 'llama3:latest' }, { id: 'qwen2.5' }] })).toEqual([
      'llama3:latest',
      'qwen2.5',
    ])
    expect(openAiModelIds([{ name: 'local-model' }])).toEqual(['local-model'])
  })

  it('reads chat text from a completion payload', () => {
    expect(openAiMessageText({
      choices: [{ message: { content: '```iedit-edits\n### p-001\n```' } }],
    })).toContain('iedit-edits')
  })
})
