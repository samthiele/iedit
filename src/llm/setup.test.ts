import { beforeEach, describe, expect, it } from 'vitest'
import { activeConnection, getSetupId, getSetupKey, saveSetup } from './setup.ts'
import { setOpenAiApiKey, setOpenAiBaseUrl, setOpenAiModel, setProvider } from './storage.ts'

describe('setup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps Gemini as the default', () => {
    expect(getSetupId()).toBe('gemini')
    expect(activeConnection().provider).toBe('gemini')
  })

  it('moves an existing ChatGPT server onto the ChatGPT tab', () => {
    setProvider('openai')
    setOpenAiBaseUrl('https://api.openai.com/v1')
    setOpenAiApiKey('sk-test')
    setOpenAiModel('gpt-4.1-mini')
    expect(getSetupId()).toBe('chatgpt')
    expect(getSetupKey('chatgpt')).toBe('sk-test')
  })

  it('stores a free-tier connection without dropping its server', () => {
    saveSetup({ id: 'groq', apiKey: 'gsk-test', model: 'openai/gpt-oss-20b' })
    expect(activeConnection()).toMatchObject({
      id: 'groq',
      provider: 'openai',
      apiKey: 'gsk-test',
      model: 'openai/gpt-oss-20b',
      baseUrl: 'https://api.groq.com/openai/v1',
    })
  })
})
