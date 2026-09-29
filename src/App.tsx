import { useEffect, useMemo, useState } from 'react'
import { DemoLinks } from './components/DemoLinks.tsx'
import { ReviewPane } from './components/ReviewPane.tsx'
import { WaitStatus } from './components/WaitStatus.tsx'
import { SkillDialog } from './components/SkillDialog.tsx'
import { SetupDialog } from './components/SetupDialog.tsx'
import { loadModelCatalog, resolveModel, type ModelCatalog } from './llm/models.ts'
import { readableGeminiError } from './llm/client.ts'
import { blockChars, plannedBlocks, runReview, BLOCK_PRESETS } from './llm/runReview.ts'
import { activeConnection, presetById, type SetupPreset } from './llm/setup.ts'
import {
  getCustomSkills,
  getBlockSize,
  getCustomPrompt,
  getParallelApiKey,
  getStoredDiscipline,
  saveCustomSkills,
  setBlockSize,
  setCustomPrompt,
  setParallelApiKey,
  setStoredDiscipline,
  type StoredSkill,
} from './llm/storage.ts'
import { loadManuscript } from './parse/load.ts'
import type { LoadedDocument, ReviewSession } from './review/types.ts'
import { BUILTIN_DISCIPLINES, type DisciplineSkill } from './skills/index.ts'
import { parseSkill } from './skills/frontmatter.ts'

export default function App() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [connection, setConnection] = useState(activeConnection)
  const [disciplineId, setDisciplineId] = useState(getStoredDiscipline)
  const [customSkills, setCustomSkills] = useState(getCustomSkills)
  const [setupOpen, setSetupOpen] = useState(false)
  const [skillOpen, setSkillOpen] = useState(false)
  const [documentFile, setDocumentFile] = useState<LoadedDocument | null>(null)
  const [includeScience, setIncludeScience] = useState(true)
  const [blockSize, setBlockSizeState] = useState(getBlockSize)
  const [customPrompt, setCustomPromptState] = useState(getCustomPrompt)
  const [parallelKey, setParallelKeyState] = useState(getParallelApiKey)
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void loadModelCatalog().then((loaded) => {
      if (!active) return
      setCatalog(loaded)
      setConnection(activeConnection())
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
  const preset = presetById(connection.id)
  const usingGemini = connection.provider === 'gemini'
  const activeKey = connection.apiKey
  const activeModel = usingGemini && catalog ? resolveModel(catalog, connection.model) : connection.model
  const scienceOn = includeScience
  const notice = disclosure(preset, connection.baseUrl)

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
    if (!activeKey.trim() || !activeModel.trim() || (!usingGemini && !connection.baseUrl?.trim())) {
      setError('')
      setSetupOpen(true)
      return
    }
    setBusy(true)
    setError('')
    setSession(null)
    try {
      const next = await runReview({
        provider: connection.provider,
        apiKey: activeKey.trim(),
        baseUrl: connection.baseUrl,
        model: activeModel,
        disciplineBody: discipline.body,
        document: documentFile,
        includeScience: scienceOn,
        chunkChars: blockChars(blockSize),
        customPrompt,
        parallelApiKey: parallelKey,
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

  function addSkill(skill: { title: string; body: string }) {
    const stored: StoredSkill = {
      id: `custom-${crypto.randomUUID()}`,
      title: skill.title,
      body: skill.body,
    }
    const next = [...customSkills, stored]
    setCustomSkills(next)
    saveCustomSkills(next)
    setDisciplineId(stored.id)
    setStoredDiscipline(stored.id)
  }

  function onUploadSkill(file: File | undefined) {
    if (!file) return
    void file.text().then((raw) => {
      const parsed = parseSkill(raw, file.name.replace(/\.md$/i, ''))
      addSkill(parsed)
    })
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
          <p className="mark">iEdit</p>
          <h1>
            Improving scientific writing
            {' '}
            <DemoLinks />
          </h1>
        </div>
        <div className="controls">
          <select
            aria-label="Discipline"
            value={discipline.id}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                setSkillOpen(true)
                return
              }
              setDisciplineId(event.target.value)
              setStoredDiscipline(event.target.value)
            }}
          >
            {disciplines.map((item) => (
              <option key={item.id} value={item.id}>{item.title}{item.builtin ? '' : ' (uploaded)'}</option>
            ))}
            <option value="custom">Custom...</option>
          </select>
          <button type="button" onClick={() => setSetupOpen(true)}>Setup</button>
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
            Custom prompt
            <textarea
              className="custom-prompt"
              rows={2}
              value={customPrompt}
              placeholder="Optional. Extra instructions for this review."
              onChange={(event) => {
                setCustomPromptState(event.target.value)
                setCustomPrompt(event.target.value)
              }}
            />
          </label>
          <label className="field">
            Effort
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
          <p className="note">{blockNote(documentFile, blockSize, scienceOn)}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={includeScience}
              onChange={(event) => setIncludeScience(event.target.checked)}
            />
            Include a science fact-checking pass
          </label>
          {includeScience ? (
            <p className="note">
              Checks claims and reasoning with a web search. This can be helpful, though is narrower than a full literature search or human thought. Always think yourself, always verify yourself.
            </p>
          ) : null}
          <div className="run-row">
            <button type="button" className="run" disabled={!documentFile || busy} onClick={() => void onRun()}>
              Review manuscript
            </button>
            {busy ? <WaitStatus label={progress || 'Working on copy-edits'} /> : null}
            <p className="disclaimer">
              Do not upload confidential information. The document content is sent to {notice.recipient}.
              {notice.privacyUrl ? (
                <>
                  {' '}
                  <a href={notice.privacyUrl} target="_blank" rel="noreferrer">{notice.privacyLabel}</a>
                </>
              ) : null}
              {scienceOn ? (
                <>
                  {' '}
                  Science checks are also sent to Parallel, possibly including small sections/snippets of your text.
                  {' '}
                  <a href="https://parallel.ai/privacy-policy" target="_blank" rel="noreferrer">Parallel privacy policy</a>
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

      {setupOpen ? (
        <SetupDialog
          catalog={catalog}
          parallelKey={parallelKey}
          onParallelKey={(value) => {
            setParallelKeyState(value)
            setParallelApiKey(value)
          }}
          onClose={() => setSetupOpen(false)}
          onSaved={() => setConnection(activeConnection())}
        />
      ) : null}
      {skillOpen ? (
        <SkillDialog
          skills={customSkills}
          onUpload={onUploadSkill}
          onRemove={removeCustom}
          onAdd={addSkill}
          onClose={() => setSkillOpen(false)}
        />
      ) : null}
      <footer className="site-footer">
        <a href="https://www.samthiele.science/" target="_blank" rel="noreferrer">Sam Thiele 2026</a>
      </footer>
    </div>
  )
}

function disclosure(preset: SetupPreset, baseUrl?: string): { recipient: string; privacyUrl: string | null; privacyLabel: string } {
  if (preset.privacyUrl) {
    return { recipient: preset.recipient, privacyUrl: preset.privacyUrl, privacyLabel: preset.privacyLabel }
  }
  const server = baseUrl?.trim().replace(/\/$/, '')
  return {
    recipient: server || 'the server in your API settings',
    privacyUrl: null,
    privacyLabel: '',
  }
}

function blockNote(documentFile: LoadedDocument | null, blockSize: string, includeScience: boolean): string {
  const lead = 'Higher effort uses more calls, so each reply covers less text and usually writes more suggestions.'
  if (!documentFile) return lead
  const plan = plannedBlocks(documentFile.paragraphs, blockChars(blockSize), includeScience)
  const blocks = plan.copyedit === 1 ? '1 copyedit block' : `${plan.copyedit} copyedit blocks`
  const science = plan.science > 0 ? ` The science pass adds ${plan.science}.` : ''
  return `${lead} This manuscript is ${blocks}.${science}`
}

