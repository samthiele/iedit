const KEY = 'iedit.geminiApiKey'
const MODEL = 'iedit.geminiModel'
const PROVIDER = 'iedit.provider'
const OPENAI_KEY = 'iedit.openaiApiKey'
const OPENAI_BASE = 'iedit.openaiBaseUrl'
const OPENAI_MODEL = 'iedit.openaiModel'
const BLOCK = 'iedit.blockSize'
const DISCIPLINE = 'iedit.discipline'
const CUSTOM = 'iedit.customSkills'

export type LlmProvider = 'gemini' | 'openai'

export const DEFAULT_OPENAI_BASE_URL = 'https://api-genai.hzdr.de/v1'

export type StoredSkill = {
  id: string
  title: string
  body: string
}

export function getGeminiApiKey(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setGeminiApiKey(apiKey: string): void {
  localStorage.setItem(KEY, apiKey.trim())
}

export function clearGeminiApiKey(): void {
  localStorage.removeItem(KEY)
}

export function getProvider(): LlmProvider {
  return localStorage.getItem(PROVIDER) === 'openai' ? 'openai' : 'gemini'
}

export function setProvider(provider: LlmProvider): void {
  localStorage.setItem(PROVIDER, provider)
}

export function getOpenAiApiKey(): string {
  return localStorage.getItem(OPENAI_KEY) ?? ''
}

export function setOpenAiApiKey(apiKey: string): void {
  localStorage.setItem(OPENAI_KEY, apiKey.trim())
}

export function clearOpenAiApiKey(): void {
  localStorage.removeItem(OPENAI_KEY)
}

export function getOpenAiBaseUrl(): string {
  return localStorage.getItem(OPENAI_BASE) ?? DEFAULT_OPENAI_BASE_URL
}

export function setOpenAiBaseUrl(baseUrl: string): void {
  localStorage.setItem(OPENAI_BASE, baseUrl.trim().replace(/\/$/, ''))
}

export function getOpenAiModel(): string {
  return localStorage.getItem(OPENAI_MODEL) ?? ''
}

export function setOpenAiModel(modelId: string): void {
  localStorage.setItem(OPENAI_MODEL, modelId.trim())
}

export function getStoredModel(): string {
  return localStorage.getItem(MODEL) ?? ''
}

export function setStoredModel(modelId: string): void {
  localStorage.setItem(MODEL, modelId)
}

export function getBlockSize(): string {
  const stored = localStorage.getItem(BLOCK)
  return stored === 'short' || stored === 'long' ? stored : 'medium'
}

export function setBlockSize(size: string): void {
  localStorage.setItem(BLOCK, size)
}

export function getStoredDiscipline(): string {
  return localStorage.getItem(DISCIPLINE) ?? 'geoscience'
}

export function setStoredDiscipline(id: string): void {
  localStorage.setItem(DISCIPLINE, id)
}

export function getCustomSkills(): StoredSkill[] {
  const raw = localStorage.getItem(CUSTOM)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as StoredSkill[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && item.id && item.title && item.body)
  } catch {
    return []
  }
}

export function saveCustomSkills(skills: StoredSkill[]): void {
  localStorage.setItem(CUSTOM, JSON.stringify(skills))
}
