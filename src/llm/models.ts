import { getStoredModel, setStoredModel } from './storage.ts'

export type GeminiModel = {
  id: string
  label: string
  hint: string
}

export type ModelCatalog = {
  defaultModel: string
  models: GeminiModel[]
}

const FALLBACK: ModelCatalog = {
  defaultModel: 'gemini-3.1-flash-lite',
  models: [
    { id: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite', hint: 'Default. High free-tier quota.' },
    { id: 'gemini-3.5-flash', label: '3.5 Flash', hint: 'Stronger reasoning for long manuscripts.' },
    { id: 'gemini-2.5-flash', label: '2.5 Flash', hint: 'Previous Flash generation.' },
    { id: 'gemini-2.5-pro', label: '2.5 Pro', hint: 'Slower, lower free-tier quota.' },
  ],
}

export async function loadModelCatalog(): Promise<ModelCatalog> {
  try {
    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`
    const response = await fetch(`${base}models.json`)
    if (!response.ok) return FALLBACK
    const raw = await response.json() as { default?: string; models?: GeminiModel[] }
    const models = (raw.models ?? []).filter((item) => item.id && item.label)
    if (models.length === 0) return FALLBACK
    const defaultModel = models.some((item) => item.id === raw.default) ? raw.default! : models[0].id
    return { defaultModel, models }
  } catch {
    return FALLBACK
  }
}

export function resolveModel(catalog: ModelCatalog, stored = getStoredModel()): string {
  if (catalog.models.some((item) => item.id === stored)) return stored
  return catalog.defaultModel
}

export function rememberModel(modelId: string): void {
  setStoredModel(modelId)
}
