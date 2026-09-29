import { useEffect, useState } from 'react'
import { listOpenAiModels, testConnection } from '../llm/client.ts'
import type { ModelCatalog } from '../llm/models.ts'
import { WaitStatus } from './WaitStatus.tsx'
import {
  clearSetupKey,
  getGenericBaseUrl,
  getSetupId,
  getSetupKey,
  getSetupModel,
  presetById,
  saveSetup,
  SETUP_PRESETS,
  type SetupId,
} from '../llm/setup.ts'
import { DEFAULT_OPENAI_BASE_URL } from '../llm/storage.ts'

export function SetupDialog({
  catalog,
  parallelKey,
  onParallelKey,
  onClose,
  onSaved,
}: {
  catalog: ModelCatalog | null
  parallelKey: string
  onParallelKey: (value: string) => void
  onClose: () => void
  onSaved: () => void
}) {
  const [tab, setTab] = useState<SetupId>(getSetupId)
  const [drafts, setDrafts] = useState(() => initialDrafts(catalog))
  const [listed, setListed] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [testing, setTesting] = useState(false)
  const [listing, setListing] = useState(false)
  const preset = presetById(tab)
  const draft = drafts[tab]
  const choices = modelChoices(preset, catalog, listed, draft.model)

  useEffect(() => {
    if (!catalog) return
    setDrafts((current) => {
      if (catalog.models.some((item) => item.id === current.gemini.model)) return current
      return { ...current, gemini: { ...current.gemini, model: catalog.defaultModel } }
    })
  }, [catalog])

  function update(patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [tab]: { ...current[tab], ...patch } }))
  }

  async function loadModels() {
    setMessage('')
    setListing(true)
    const base = preset.baseUrl ?? draft.baseUrl
    try {
      const ids = await listOpenAiModels(base, draft.apiKey)
      setListed(ids)
      if (!draft.model && ids[0]) update({ model: ids[0] })
      setMessage(ids.length === 0 ? 'The server returned no model ids.' : `Loaded ${ids.length} models.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setListing(false)
    }
  }

  async function testKey() {
    setMessage('')
    setTesting(true)
    try {
      await testConnection({
        provider: preset.provider,
        apiKey: draft.apiKey,
        baseUrl: preset.baseUrl ?? draft.baseUrl,
        model: draft.model,
      })
      setMessage(`The key works. ${draft.model.trim()} is available.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setTesting(false)
    }
  }

  function useThis() {
    saveSetup({
      id: tab,
      apiKey: draft.apiKey,
      model: draft.model,
      baseUrl: draft.baseUrl,
    })
    onSaved()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal setup" role="dialog" aria-labelledby="setup-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="setup-title">Setup</h2>
        <div className="setup-tabs" role="tablist" aria-label="Model">
          {SETUP_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === tab}
              onClick={() => {
                setTab(item.id)
                setListed([])
                setMessage('')
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="setup-note">{preset.note}</p>
        {preset.keyUrl ? (
          <p className="setup-note">
            <a href={preset.keyUrl} target="_blank" rel="noreferrer">Create an API key</a>
          </p>
        ) : null}
        {preset.id === 'openai' ? (
          <label>
            Server
            <input
              value={draft.baseUrl}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </label>
        ) : null}
        <label>
          Model
          {choices.length > 0 ? (
            <select value={draft.model} onChange={(event) => update({ model: event.target.value })}>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          ) : (
            <input
              list="setup-models"
              value={draft.model}
              placeholder="model id"
              autoComplete="off"
              onChange={(event) => update({ model: event.target.value })}
            />
          )}
        </label>
        {listed.length > 0 && choices.length === 0 ? (
          <datalist id="setup-models">
            {listed.map((id) => <option key={id} value={id} />)}
          </datalist>
        ) : null}
        <label>
          API key
          <input
            type="password"
            value={draft.apiKey}
            autoComplete="off"
            onChange={(event) => update({ apiKey: event.target.value })}
          />
        </label>
        <label>
          Parallel API key
          <input
            className="parallel-key"
            type="password"
            autoComplete="off"
            value={parallelKey}
            placeholder="Optional. Raises the free search limit."
            onChange={(event) => onParallelKey(event.target.value)}
          />
        </label>
        <p className="setup-note">
          Optional. A key from <a href="https://platform.parallel.ai" target="_blank" rel="noreferrer">Parallel</a> raises the free search limit for the science pass.
        </p>
        {preset.provider === 'openai' ? (
          <button type="button" onClick={() => void loadModels()} disabled={listing || !draft.apiKey.trim() || !(preset.baseUrl ?? draft.baseUrl).trim()}>
            Load models
          </button>
        ) : null}
        {listing ? <WaitStatus label="Asking what models are available" /> : null}
        {testing ? <WaitStatus label="Checking this model" /> : null}
        {message ? <p className="setup-note">{message}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={() => {
            clearSetupKey(tab)
            update({ apiKey: '' })
          }}>Remove key</button>
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            onClick={() => void testKey()}
            disabled={testing || !draft.apiKey.trim() || !draft.model.trim() || (preset.id === 'openai' && !draft.baseUrl.trim())}
          >
            Test
          </button>
          <button
            type="button"
            className="run"
            onClick={useThis}
            disabled={!draft.apiKey.trim() || !draft.model.trim() || (preset.id === 'openai' && !draft.baseUrl.trim())}
          >
            Use this model
          </button>
        </div>
      </div>
    </div>
  )
}

type Draft = { apiKey: string; model: string; baseUrl: string }

function initialDrafts(catalog: ModelCatalog | null): Record<SetupId, Draft> {
  const drafts = {} as Record<SetupId, Draft>
  for (const preset of SETUP_PRESETS) {
    const storedModel = getSetupModel(preset.id)
    const catalogModel = catalog?.models.some((item) => item.id === storedModel)
      ? storedModel
      : (catalog?.defaultModel ?? preset.defaultModel)
    const geminiModel = preset.id === 'gemini' ? catalogModel : storedModel
    drafts[preset.id] = {
      apiKey: getSetupKey(preset.id),
      model: geminiModel,
      baseUrl: preset.baseUrl ?? (getGenericBaseUrl() || DEFAULT_OPENAI_BASE_URL),
    }
  }
  return drafts
}

function modelChoices(
  preset: ReturnType<typeof presetById>,
  catalog: ModelCatalog | null,
  listed: string[],
  current: string,
): { id: string; label: string }[] {
  if (preset.id === 'gemini') {
    const models = catalog?.models ?? []
    if (current && !models.some((item) => item.id === current)) {
      return [{ id: current, label: current }, ...models]
    }
    return models
  }
  if (preset.id === 'mistral' || preset.id === 'openai' || preset.id === 'openrouter') return []
  const models = [...preset.models]
  for (const id of listed) {
    if (!models.some((item) => item.id === id)) models.push({ id, label: id })
  }
  if (current && !models.some((item) => item.id === current)) models.unshift({ id: current, label: current })
  return models
}
