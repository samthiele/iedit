import type { GroundingSource } from '../review/types.ts'
import { logExchange } from './log.ts'

const MCP_URL = 'https://search.parallel.ai/mcp'
const PROTOCOL = '2025-03-26'
const MAX_REQUESTS = 6
const MAX_QUERIES = 3
const EXCERPT_CHARS = 1500
const EXCERPTS_CHARS = 24000

export type SearchRequest = {
  objective: string
  queries: string[]
}

export type SearchHit = {
  excerpts: string
  sources: GroundingSource[]
}

const FENCE = /```iedit-search\s*\n([\s\S]*?)```/gi

export function parseSearchRequests(text: string): SearchRequest[] {
  const requests: SearchRequest[] = []
  for (const match of text.matchAll(FENCE)) {
    let objective = ''
    let queries: string[] = []
    const flush = () => {
      const clean = queries.map((query) => query.trim()).filter(Boolean).slice(0, MAX_QUERIES)
      if (objective.trim() && clean.length > 0) {
        requests.push({ objective: objective.trim().slice(0, 500), queries: clean.map((query) => query.slice(0, 120)) })
      }
      objective = ''
      queries = []
    }
    for (const line of match[1].split('\n')) {
      const trimmed = line.trim()
      const objectiveLine = /^objective:\s*(.*)$/i.exec(trimmed)
      const queryLine = /^query:\s*(.*)$/i.exec(trimmed)
      if (objectiveLine) {
        if (objective || queries.length > 0) flush()
        objective = objectiveLine[1]
      } else if (queryLine) {
        queries.push(queryLine[1])
      }
    }
    flush()
  }
  return requests.slice(0, MAX_REQUESTS)
}

export function parallelSearch(options: { sessionId: string; apiKey: string; model: string }): (requests: SearchRequest[]) => Promise<SearchHit> {
  let mcpSession: string | null = null
  return async (requests) => {
    if (!mcpSession) mcpSession = await openSession(options.apiKey)
    const blocks: string[] = []
    const sources: GroundingSource[] = []
    for (const request of requests.slice(0, MAX_REQUESTS)) {
      const payload = await callTool(mcpSession, options.apiKey, {
        objective: request.objective,
        search_queries: request.queries,
        session_id: options.sessionId.slice(0, 100),
        model_name: options.model.slice(0, 100),
      })
      const hit = hitFromPayload(payload, request.objective)
      blocks.push(hit.excerpts)
      for (const source of hit.sources) {
        if (!sources.some((item) => item.uri === source.uri)) sources.push(source)
      }
    }
    if (sources.length === 0) throw new Error('The web search returned no sources.')
    return { excerpts: blocks.join('\n\n').slice(0, EXCERPTS_CHARS), sources }
  }
}

async function openSession(apiKey: string): Promise<string> {
  const opened = await postMcp(null, apiKey, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'iedit', version: '0' },
    },
  })
  if (!opened.sessionId) throw new Error('The web search did not start a session.')
  await postMcp(opened.sessionId, apiKey, { jsonrpc: '2.0', method: 'notifications/initialized' })
  return opened.sessionId
}

async function callTool(sessionId: string, apiKey: string, arguments_: Record<string, unknown>): Promise<unknown> {
  const response = await postMcp(sessionId, apiKey, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'web_search', arguments: arguments_ },
  })
  return response.payload
}

async function postMcp(sessionId: string | null, apiKey: string, body: unknown): Promise<{ sessionId: string | null; payload: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL,
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  logExchange('Parallel', 'sent', { url: MCP_URL, body })
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'omit',
  })
  const raw = await response.text()
  logExchange('Parallel', 'received', { url: MCP_URL, status: response.status, body: raw })
  if (!response.ok && response.status !== 202) {
    throw new Error(raw.trim() || `The web search failed (${response.status}).`)
  }
  const payload = raw.trim() ? parseMcpBody(raw) : null
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const message = (payload as { error?: { message?: string } }).error?.message
    throw new Error(message || 'The web search failed.')
  }
  return { sessionId: response.headers.get('Mcp-Session-Id') ?? sessionId, payload }
}

function parseMcpBody(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as unknown
  const data = trimmed.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]')
  const last = data.at(-1)
  if (!last) throw new Error('The web search returned an empty response.')
  return JSON.parse(last) as unknown
}

function hitFromPayload(payload: unknown, objective: string): SearchHit {
  const result = payload && typeof payload === 'object'
    ? (payload as { result?: { isError?: boolean; content?: { type?: string; text?: string }[] } }).result
    : undefined
  if (result?.isError) {
    const message = result.content?.map((item) => item.text ?? '').join('\n').trim()
    throw new Error(message || 'The web search failed.')
  }
  const text = result?.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('\n') ?? ''
  let rows: { url?: string; title?: string; excerpts?: string[] }[] = []
  try {
    const parsed = JSON.parse(text) as { results?: { url?: string; title?: string; excerpts?: string[] }[] }
    rows = parsed.results ?? []
  } catch {
    throw new Error('The web search returned an unreadable result.')
  }
  const sources: GroundingSource[] = []
  const lines = [`## ${objective}`]
  for (const row of rows) {
    const uri = row.url?.trim() ?? ''
    if (!uri) continue
    const title = row.title?.trim() || uri
    if (!sources.some((source) => source.uri === uri)) sources.push({ title, uri })
    const excerpt = (row.excerpts ?? []).join('\n').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS)
    lines.push(`### ${title}`, uri, excerpt)
  }
  if (sources.length === 0) throw new Error('The web search returned no sources.')
  return { excerpts: lines.join('\n'), sources }
}
