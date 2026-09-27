import { useEffect, useMemo, useState } from 'react'
import { ReviewPane } from './components/ReviewPane.tsx'
import { loadModelCatalog, rememberModel, resolveModel, type ModelCatalog } from './llm/models.ts'
import { listOpenAiModels, readableGeminiError } from './llm/client.ts'
import { blockChars, plannedBlocks, runReview, BLOCK_PRESETS } from './llm/runReview.ts'
import {
  clearGeminiApiKey,
  clearOpenAiApiKey,
  getCustomSkills,
  getGeminiApiKey,
  getOpenAiApiKey,
  getOpenAiBaseUrl,
  getOpenAiModel,
  getBlockSize,
  getProvider,
  getStoredDiscipline,
  saveCustomSkills,
  setGeminiApiKey,
  setOpenAiApiKey,
  setOpenAiBaseUrl,
  setOpenAiModel,
  setBlockSize,
  setProvider,
  setStoredDiscipline,
  type LlmProvider,
  type StoredSkill,
} from './llm/storage.ts'
import { loadManuscript } from './parse/load.ts'
import type { LoadedDocument, ReviewSession } from './review/types.ts'
import { BUILTIN_DISCIPLINES, systemInstruction, type DisciplineSkill } from './skills/index.ts'
import { parseSkill } from './skills/frontmatter.ts'

export default function App() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [provider, setProviderState] = useState<LlmProvider>(getProvider)
  const [apiKey, setApiKey] = useState(getGeminiApiKey)
  const [openAiKey, setOpenAiKey] = useState(getOpenAiApiKey)
  const [baseUrl, setBaseUrl] = useState(getOpenAiBaseUrl)
  const [openAiModel, setOpenAiModelState] = useState(getOpenAiModel)
  const [openAiModels, setOpenAiModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [disciplineId, setDisciplineId] = useState(getStoredDiscipline)
  const [customSkills, setCustomSkills] = useState(getCustomSkills)
  const [keyOpen, setKeyOpen] = useState(false)
  const [documentFile, setDocumentFile] = useState<LoadedDocument | null>(null)
  const [includeScience, setIncludeScience] = useState(true)
  const [blockSize, setBlockSizeState] = useState(getBlockSize)
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void loadModelCatalog().then((loaded) => {
      if (!active) return
      setCatalog(loaded)
      setModel(resolveModel(loaded))
    })
    return () => {
      active = false
    }
  }, [])

  const disciplines = useMemo<DisciplineSkill[]>(() => [
    ...BUILTIN_DISCIPLINES,
    ...customSkills.map((skill) => ({ ...skill, builtin: false })),
  ], [customSkills])

  const discipline = disciplines.find((item) => item.id === disciplineId) ?? BUILTIN_DISCIPLINES[0]
  const usingGemini = provider === 'gemini'
  const activeKey = usingGemini ? apiKey : openAiKey
  const activeModel = usingGemini ? model : openAiModel

  async function onFile(file: File | undefined) {
    if (!file) return
    setError('')
    setSession(null)
    try {
      setDocumentFile(await loadManuscript(file))
    } catch (caught) {
      setDocumentFile(null)
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function onRun() {
    if (!documentFile) return
    if (!activeKey.trim()) {
      setKeyOpen(true)
      setError(usingGemini ? 'Add a Gemini API key before running a review.' : 'Add an API key before running a review.')
      return
    }
    if (!usingGemini && !baseUrl.trim()) {
      setKeyOpen(true)
      setError('Add the OpenAI-compatible server address before running a review.')
      return
    }
    setBusy(true)
    setError('')
    setSession(null)
    try {
      const next = await runReview({
        provider,
        apiKey: activeKey.trim(),
        baseUrl: usingGemini ? undefined : baseUrl,
        model: activeModel,
        systemInstruction: systemInstruction(discipline.body),
        document: documentFile,
        includeScience,
        chunkChars: blockChars(blockSize),
        disciplineTitle: discipline.title,
        onProgress: setProgress,
      })
      setSession(next)
    } catch (caught) {
      setError(readableGeminiError(caught))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  function onUploadSkill(file: File | undefined) {
    if (!file) return
    void file.text().then((raw) => {
      const parsed = parseSkill(raw, file.name.replace(/\.md$/i, ''))
      const skill: StoredSkill = {
        id: `custom-${crypto.randomUUID()}`,
        title: parsed.title,
        body: parsed.body,
      }
      const next = [...customSkills, skill]
      setCustomSkills(next)
      saveCustomSkills(next)
      setDisciplineId(skill.id)
      setStoredDiscipline(skill.id)
    })
  }

  async function loadModels() {
    setError('')
    try {
      const ids = await listOpenAiModels(baseUrl, openAiKey)
      setOpenAiModels(ids)
      if (!openAiModel && ids[0]) {
        setOpenAiModelState(ids[0])
        setOpenAiModel(ids[0])
      }
      if (ids.length === 0) setError('The server returned no model ids.')
    } catch (caught) {
      setError(readableGeminiError(caught))
    }
  }

  function removeCustom(id: string) {
    const next = customSkills.filter((skill) => skill.id !== id)
    setCustomSkills(next)
    saveCustomSkills(next)
    if (disciplineId === id) {
      setDisciplineId('geoscience')
      setStoredDiscipline('geoscience')
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img
            className="brand-icon"
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            width={36}
            height={36}
          />
          <div>
            <p className="mark">iEdit</p>
            <h1>Improving scientific writing</h1>
          </div>
        </div>
        <div className="controls">
          <label>
            Connection
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value === 'openai' ? 'openai' : 'gemini'
                setProviderState(next)
                setProvider(next)
              }}
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI-compatible</option>
            </select>
          </label>
          {usingGemini ? (
            <label>
              Model
              <select
                value={model}
                onChange={(event) => {
                  setModel(event.target.value)
                  rememberModel(event.target.value)
                }}
              >
                {(catalog?.models ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Model
              <input
                list="openai-models"
                value={openAiModel}
                placeholder="model id"
                onChange={(event) => {
                  setOpenAiModelState(event.target.value)
                  setOpenAiModel(event.target.value)
                }}
              />
              <datalist id="openai-models">
                {openAiModels.map((id) => <option key={id} value={id} />)}
              </datalist>
            </label>
          )}
          <label>
            Discipline
            <select
              value={discipline.id}
              onChange={(event) => {
                setDisciplineId(event.target.value)
                setStoredDiscipline(event.target.value)
              }}
            >
              {disciplines.map((item) => (
                <option key={item.id} value={item.id}>{item.title}{item.builtin ? '' : ' (uploaded)'}</option>
              ))}
            </select>
          </label>
          <label className="file-button">
            Upload discipline skill
            <input
              type="file"
              accept=".md,text/markdown"
              onChange={(event) => {
                onUploadSkill(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          {!discipline.builtin ? (
            <button type="button" onClick={() => removeCustom(discipline.id)}>Remove skill</button>
          ) : null}
          {!usingGemini ? (
            <button type="button" onClick={() => void loadModels()} disabled={busy || !openAiKey || !baseUrl}>
              Load models
            </button>
          ) : null}
          <button type="button" onClick={() => setKeyOpen(true)}>
            {activeKey ? 'API key saved' : 'Add API key'}
          </button>
        </div>
      </header>

      <main>
        <section className="start">
          <label
            className="drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void onFile(event.dataTransfer.files[0])
            }}
          >
            <input
              type="file"
              accept=".docx,.tex,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
            <span>{documentFile ? documentFile.fileName : 'Drop a .docx or .tex manuscript'}</span>
            {documentFile ? (
              <small>
                {`${documentFile.paragraphs.filter((item) => item.kind !== 'preamble').length} paragraphs · ${discipline.title}`}
              </small>
            ) : null}
          </label>
          <label className="field">
            Block size
            <select
              value={blockSize}
              onChange={(event) => {
                setBlockSizeState(event.target.value)
                setBlockSize(event.target.value)
              }}
            >
              {BLOCK_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <p className="note">{blockNote(documentFile, blockSize, includeScience)}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={includeScience}
              onChange={(event) => setIncludeScience(event.target.checked)}
            />
            {usingGemini
              ? 'Include a science pass (Gemini Google Search grounding)'
              : 'Include a science pass (no web search on this server)'}
          </label>
          <p className="note">
            {usingGemini
              ? 'Grounding checks citations and claims with Google Search. It is narrower than a full literature review: if search fails, the science pass stops and those notes are not presented as checked.'
              : 'This server cannot run Gemini’s Google Search check. Science notes are the model’s own comments and are marked not search-checked.'}
          </p>
          <div className="run-row">
            <button type="button" className="run" disabled={!documentFile || busy || !activeModel} onClick={() => void onRun()}>
              {busy ? (progress || 'Reviewing…') : 'Review manuscript'}
            </button>
            <p className="disclaimer">
              Do not upload confidential information. The document content is sent to {usingGemini ? 'Google Gemini' : 'the server in your API settings'}.
              {usingGemini ? (
                <>
                  {' '}
                  <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini API terms</a>
                </>
              ) : null}
            </p>
          </div>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </section>

        {session ? (
          <ReviewPane
            session={session}
            onChange={(suggestions) => setSession({ ...session, suggestions })}
          />
        ) : null}
      </main>

      {keyOpen ? (
        <KeyModal
          provider={provider}
          initial={activeKey}
          baseUrl={baseUrl}
          onClose={() => setKeyOpen(false)}
          onSave={(value, url) => {
            if (usingGemini) {
              setGeminiApiKey(value)
              setApiKey(value)
            } else {
              setOpenAiApiKey(value)
              setOpenAiKey(value)
              setOpenAiBaseUrl(url)
              setBaseUrl(url.replace(/\/$/, ''))
            }
            setKeyOpen(false)
          }}
          onClear={() => {
            if (usingGemini) {
              clearGeminiApiKey()
              setApiKey('')
            } else {
              clearOpenAiApiKey()
              setOpenAiKey('')
            }
            setKeyOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function blockNote(documentFile: LoadedDocument | null, blockSize: string, includeScience: boolean): string {
  const lead = 'Shorter blocks leave more of each reply for fewer paragraphs, so the pass usually writes more suggestions. Each block is one API call.'
  if (!documentFile) return lead
  const plan = plannedBlocks(documentFile.paragraphs, blockChars(blockSize), includeScience)
  const blocks = plan.copyedit === 1 ? '1 copyedit block' : `${plan.copyedit} copyedit blocks`
  const science = plan.science > 0 ? ` The science pass adds ${plan.science}.` : ''
  return `${lead} This manuscript is ${blocks}.${science}`
}

function KeyModal({
  provider,
  initial,
  baseUrl,
  onClose,
  onSave,
  onClear,
}: {
  provider: LlmProvider
  initial: string
  baseUrl: string
  onClose: () => void
  onSave: (value: string, baseUrl: string) => void
  onClear: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [url, setUrl] = useState(baseUrl)
  const openai = provider === 'openai'
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-labelledby="key-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="key-title">{openai ? 'OpenAI-compatible API' : 'Gemini API key'}</h2>
        {openai ? (
          <p>
            Paste a key for an OpenAI-compatible server. For HZDR, create one in the LiteLLM panel and use https://api-genai.hzdr.de/v1. The key stays in this browser. The server must allow this page to call it. api.openai.com does not, so the official OpenAI API cannot be used from this site.
          </p>
        ) : (
          <p>
            iEdit uses your own Google <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Gemini API key</a>. The key is stored in this browser only and is sent directly to Google with the manuscript text. It is not written into the site.
          </p>
        )}
        {openai ? (
          <label>
            Server
            <input
              value={url}
              autoComplete="off"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          API key
          <input
            type="password"
            value={draft}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClear}>Remove key</button>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="run" onClick={() => onSave(draft.trim(), url.trim())} disabled={!draft.trim() || (openai && !url.trim())}>Save key</button>
        </div>
      </div>
    </div>
  )
}
