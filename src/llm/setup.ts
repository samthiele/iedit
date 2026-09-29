import {
  clearGeminiApiKey,
  clearOpenAiApiKey,
  getGeminiApiKey,
  getOpenAiApiKey,
  getOpenAiBaseUrl,
  getOpenAiModel,
  getProvider,
  getStoredModel,
  setGeminiApiKey,
  setOpenAiApiKey,
  setOpenAiBaseUrl,
  setOpenAiModel,
  setProvider,
  setStoredModel,
  DEFAULT_OPENAI_BASE_URL,
  type LlmProvider,
} from './storage.ts'

export type SetupId = 'gemini' | 'chatgpt' | 'groq' | 'openrouter' | 'cerebras' | 'mistral' | 'openai'

export type SetupPreset = {
  id: SetupId
  label: string
  provider: LlmProvider
  baseUrl: string | null
  defaultModel: string
  models: { id: string; label: string }[]
  keyUrl: string
  note: string
  recipient: string
  privacyUrl: string | null
  privacyLabel: string
}

export const SETUP_PRESETS: SetupPreset[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    provider: 'gemini',
    baseUrl: null,
    defaultModel: 'gemini-3.1-flash-lite',
    models: [],
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Paste a Gemini API key. It stays in this browser.',
    recipient: 'Google',
    privacyUrl: 'https://ai.google.dev/gemini-api/terms',
    privacyLabel: 'Gemini API terms',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    models: [
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      { id: 'gpt-4.1', label: 'gpt-4.1' },
    ],
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Paste an OpenAI API key. It stays in this browser.',
    recipient: 'OpenAI',
    privacyUrl: 'https://platform.openai.com/docs/guides/your-data',
    privacyLabel: 'OpenAI data controls',
  },
  {
    id: 'groq',
    label: 'Groq',
    provider: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-20b',
    models: [
      { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B' },
      { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
      { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B' },
    ],
    keyUrl: 'https://console.groq.com/keys',
    note: 'Paste a Groq API key. It stays in this browser.',
    recipient: 'Groq',
    privacyUrl: 'https://groq.com/privacy-policy',
    privacyLabel: 'Groq privacy policy',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    models: [
      { id: 'openrouter/free', label: 'Free model router' },
    ],
    keyUrl: 'https://openrouter.ai/settings/keys',
    note: 'Paste an OpenRouter API key. It stays in this browser.',
    recipient: 'OpenRouter and the model provider it selects',
    privacyUrl: 'https://openrouter.ai/privacy',
    privacyLabel: 'OpenRouter privacy policy',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    provider: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'gpt-oss-120b',
    models: [
      { id: 'gpt-oss-120b', label: 'GPT OSS 120B' },
      { id: 'qwen-3.8-27b', label: 'Qwen 3.8 27B' },
    ],
    keyUrl: 'https://cloud.cerebras.ai/',
    note: 'Paste a Cerebras API key. It stays in this browser.',
    recipient: 'Cerebras',
    privacyUrl: 'https://www.cerebras.ai/privacy-policy',
    privacyLabel: 'Cerebras privacy policy',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    provider: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    models: [],
    keyUrl: 'https://console.mistral.ai/api-keys/',
    note: 'Paste a Mistral API key. It stays in this browser.',
    recipient: 'Mistral',
    privacyUrl: 'https://legal.mistral.ai/terms/privacy-policy',
    privacyLabel: 'Mistral privacy policy',
  },
  {
    id: 'openai',
    label: 'Other API',
    provider: 'openai',
    baseUrl: null,
    defaultModel: '',
    models: [],
    keyUrl: '',
    note: 'Paste a server address and API key for any OpenAI-compatible API. They stay in this browser.',
    recipient: '',
    privacyUrl: null,
    privacyLabel: '',
  },
]

const SETUP_ID = 'iedit.setupId'
const MIGRATED = 'iedit.setupMigrated'

export function presetById(id: SetupId): SetupPreset {
  return SETUP_PRESETS.find((item) => item.id === id) ?? SETUP_PRESETS[0]
}

export function getSetupId(): SetupId {
  migrateSetup()
  const stored = localStorage.getItem(SETUP_ID)
  if (stored && SETUP_PRESETS.some((item) => item.id === stored)) return stored as SetupId
  return 'gemini'
}

export function getSetupKey(id: SetupId): string {
  migrateSetup()
  return localStorage.getItem(keyName(id)) ?? ''
}

export function getSetupModel(id: SetupId): string {
  migrateSetup()
  return localStorage.getItem(modelName(id)) ?? presetById(id).defaultModel
}

export function getGenericBaseUrl(): string {
  return getOpenAiBaseUrl()
}

export function activeConnection(): {
  id: SetupId
  provider: LlmProvider
  apiKey: string
  model: string
  baseUrl?: string
} {
  const id = getSetupId()
  const preset = presetById(id)
  const model = getSetupModel(id) || preset.defaultModel
  const apiKey = getSetupKey(id)
  if (preset.provider === 'gemini') {
    return { id, provider: 'gemini', apiKey, model }
  }
  return {
    id,
    provider: 'openai',
    apiKey,
    model,
    baseUrl: preset.baseUrl ?? getGenericBaseUrl(),
  }
}

export function saveSetup(input: { id: SetupId; apiKey: string; model: string; baseUrl?: string }): void {
  const preset = presetById(input.id)
  const apiKey = input.apiKey.trim()
  const model = input.model.trim() || preset.defaultModel
  localStorage.setItem(SETUP_ID, input.id)
  localStorage.setItem(keyName(input.id), apiKey)
  localStorage.setItem(modelName(input.id), model)
  setProvider(preset.provider)
  if (preset.provider === 'gemini') {
    setGeminiApiKey(apiKey)
    setStoredModel(model)
    return
  }
  const baseUrl = (preset.baseUrl ?? input.baseUrl ?? DEFAULT_OPENAI_BASE_URL).trim().replace(/\/$/, '')
  setOpenAiApiKey(apiKey)
  setOpenAiModel(model)
  setOpenAiBaseUrl(baseUrl)
}

export function clearSetupKey(id: SetupId): void {
  localStorage.setItem(keyName(id), '')
  if (getSetupId() !== id) return
  if (presetById(id).provider === 'gemini') clearGeminiApiKey()
  else clearOpenAiApiKey()
}

function migrateSetup(): void {
  if (localStorage.getItem(MIGRATED) === '1') return
  if (getProvider() === 'openai') {
    const id = inferOpenAiSetup(getOpenAiBaseUrl())
    const key = getOpenAiApiKey()
    const model = getOpenAiModel()
    if (key && !localStorage.getItem(keyName(id))) localStorage.setItem(keyName(id), key)
    if (model && !localStorage.getItem(modelName(id))) localStorage.setItem(modelName(id), model)
    if (!localStorage.getItem(SETUP_ID)) localStorage.setItem(SETUP_ID, id)
  } else {
    const key = getGeminiApiKey()
    const model = getStoredModel()
    if (key && !localStorage.getItem(keyName('gemini'))) localStorage.setItem(keyName('gemini'), key)
    if (model && !localStorage.getItem(modelName('gemini'))) localStorage.setItem(modelName('gemini'), model)
    if (!localStorage.getItem(SETUP_ID)) localStorage.setItem(SETUP_ID, 'gemini')
  }
  localStorage.setItem(MIGRATED, '1')
}

function inferOpenAiSetup(baseUrl: string): SetupId {
  const base = baseUrl.toLowerCase()
  if (base.includes('api.openai.com')) return 'chatgpt'
  if (base.includes('api.groq.com')) return 'groq'
  if (base.includes('openrouter.ai')) return 'openrouter'
  if (base.includes('api.cerebras.ai')) return 'cerebras'
  if (base.includes('api.mistral.ai')) return 'mistral'
  return 'openai'
}

function keyName(id: SetupId): string {
  return `iedit.setupKey.${id}`
}

function modelName(id: SetupId): string {
  return `iedit.setupModel.${id}`
}
