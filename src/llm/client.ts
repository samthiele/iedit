import { GoogleGenAI, type GroundingMetadata } from '@google/genai'
import { logExchange } from './log.ts'
import type { LlmProvider } from './storage.ts'
import type { GroundingSource } from '../review/types.ts'

export type ChatTurn = {
  role: 'user' | 'model'
  text: string
}

export type ReviewReply = {
  text: string
  grounded: boolean
  sources: GroundingSource[]
}

export async function generateReview(options: {
  provider: LlmProvider
  apiKey: string
  baseUrl?: string
  model: string
  systemInstruction: string
  history?: ChatTurn[]
  prompt: string
  search: boolean
}): Promise<ReviewReply> {
  if (options.provider === 'openai') return generateOpenAi(options)
  const ai = new GoogleGenAI({ apiKey: options.apiKey })
  const request = {
    model: options.model,
    contents: [
      ...(options.history ?? []).map((turn) => ({
        role: turn.role,
        parts: [{ text: turn.text }],
      })),
      { role: 'user', parts: [{ text: options.prompt }] },
    ],
    config: {
      systemInstruction: options.systemInstruction,
      maxOutputTokens: 32768,
      tools: options.search ? [{ googleSearch: {} }] : undefined,
    },
  }
  logExchange('LLM', 'sent', request)
  try {
    const response = await ai.models.generateContent(request)
    const metadata = response.candidates?.[0]?.groundingMetadata
    const reply = {
      text: response.text ?? '',
      grounded: isGrounded(metadata),
      sources: sourcesFrom(metadata),
    }
    logExchange('LLM', 'received', reply)
    return reply
  } catch (error) {
    logExchange('LLM', 'received', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export async function testConnection(options: {
  provider: LlmProvider
  apiKey: string
  baseUrl?: string
  model: string
}): Promise<void> {
  const apiKey = options.apiKey.trim()
  const model = options.model.trim()
  if (!apiKey) throw new Error('Add an API key first.')
  if (!model) throw new Error('Choose a model first.')
  if (options.provider === 'openai') {
    const baseUrl = options.baseUrl?.trim() ?? ''
    if (!baseUrl) throw new Error('Add a server address first.')
    await generateOpenAi({
      apiKey,
      baseUrl,
      model,
      systemInstruction: '',
      prompt: 'Reply with ok.',
      maxTokens: 16,
    })
    return
  }
  const ai = new GoogleGenAI({ apiKey })
  const request = {
    model,
    contents: [{ role: 'user', parts: [{ text: 'Reply with ok.' }] }],
    config: { maxOutputTokens: 16 },
  }
  logExchange('LLM', 'sent', request)
  try {
    const response = await ai.models.generateContent(request)
    logExchange('LLM', 'received', { text: response.text ?? '' })
  } catch (error) {
    logExchange('LLM', 'received', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export async function listOpenAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${trimBase(baseUrl)}/models`
  logExchange('LLM', 'sent', { url, method: 'GET' })
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const raw = await response.text()
  logExchange('LLM', 'received', { url, status: response.status, body: raw })
  if (!response.ok) throw new Error(readableGeminiError(new Error(raw || response.statusText)))
  return openAiModelIds(JSON.parse(raw) as unknown)
}

async function generateOpenAi(options: {
  apiKey: string
  baseUrl?: string
  model: string
  systemInstruction: string
  history?: ChatTurn[]
  prompt: string
  maxTokens?: number
}): Promise<ReviewReply> {
  const url = `${trimBase(options.baseUrl ?? '')}/chat/completions`
  const body = {
    model: options.model,
    messages: [
      { role: 'system', content: options.systemInstruction },
      ...(options.history ?? []).map((turn) => ({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content: turn.text,
      })),
      { role: 'user', content: options.prompt },
    ],
    max_tokens: options.maxTokens ?? 16384,
  }
  logExchange('LLM', 'sent', { url, body })
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  logExchange('LLM', 'received', { url, status: response.status, body: raw })
  if (!response.ok) throw new Error(readableGeminiError(new Error(raw || response.statusText)))
  return {
    text: openAiMessageText(JSON.parse(raw) as unknown),
    grounded: false,
    sources: [],
  }
}

export function openAiModelIds(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
  const ids: string[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const id = (row as { id?: unknown }).id
    const name = (row as { name?: unknown }).name
    const value = typeof id === 'string' && id ? id : typeof name === 'string' ? name : ''
    if (value && !ids.includes(value)) ids.push(value)
  }
  return ids
}

export function openAiMessageText(payload: unknown): string {
  const choices = payload && typeof payload === 'object' ? (payload as { choices?: unknown }).choices : undefined
  const first = Array.isArray(choices) ? choices[0] : undefined
  const message = first && typeof first === 'object' ? (first as { message?: { content?: unknown } }).message : undefined
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text
    }
    return ''
  }).join('')
}

function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '')
}

export function readableGeminiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    // The SDK sometimes puts a JSON blob in Error.message and sometimes plain text.
  }
  const match = /"message"\s*:\s*"([^"]+)"/.exec(raw)
  return match?.[1] ?? raw
}

function isGrounded(metadata: GroundingMetadata | undefined): boolean {
  if (!metadata) return false
  return (metadata.groundingChunks?.length ?? 0) > 0 || (metadata.webSearchQueries?.length ?? 0) > 0
}

function sourcesFrom(metadata: GroundingMetadata | undefined): GroundingSource[] {
  const sources: GroundingSource[] = []
  for (const chunk of metadata?.groundingChunks ?? []) {
    const title = chunk.web?.title?.trim()
    const uri = chunk.web?.uri?.trim()
    if (!uri || sources.some((source) => source.uri === uri)) continue
    sources.push({ title: title || uri, uri })
  }
  return sources
}
