import { useState } from 'react'
import { generateReview, readableGeminiError } from '../llm/client.ts'
import { activeConnection } from '../llm/setup.ts'
import type { StoredSkill } from '../llm/storage.ts'
import { skillFromReply, skillPrompt } from '../skills/generate.ts'

export function SkillDialog({
  skills,
  onUpload,
  onRemove,
  onAdd,
  onClose,
}: {
  skills: StoredSkill[]
  onUpload: (file: File | undefined) => void
  onRemove: (id: string) => void
  onAdd: (skill: { title: string; body: string }) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState<{ title: string; file: string } | null>(null)

  async function generate() {
    const connection = activeConnection()
    if (!connection.apiKey.trim() || !connection.model.trim() || (connection.provider !== 'gemini' && !connection.baseUrl?.trim())) {
      setError('Add an API key in Setup before generating a skill.')
      return
    }
    setBusy(true)
    setError('')
    setReady(null)
    try {
      const reply = await generateReview({
        provider: connection.provider,
        apiKey: connection.apiKey.trim(),
        baseUrl: connection.baseUrl,
        model: connection.model.trim(),
        systemInstruction: 'You write discipline skills for a scientific copyeditor. Return only the markdown skill.',
        prompt: skillPrompt(name, description),
        search: false,
      })
      const skill = skillFromReply(name, reply.text)
      onAdd(skill)
      setReady({ title: skill.title, file: skill.file })
    } catch (caught) {
      setError(readableGeminiError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal setup" role="dialog" aria-labelledby="skill-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="skill-title">Discipline skill</h2>
        <p className="setup-note">Geoscience stays in the menu. Add another discipline by uploading a markdown skill, or by describing it and generating one.</p>
        <div className="modal-actions">
          <label className="file-button">
            Upload discipline skill
            <input
              type="file"
              accept=".md,text/markdown"
              onChange={(event) => {
                onUpload(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
        </div>
        {skills.length > 0 ? (
          <ul className="skill-list">
            {skills.map((skill) => (
              <li key={skill.id}>
                <span>{skill.title}</span>
                <button type="button" onClick={() => onRemove(skill.id)}>Remove</button>
              </li>
            ))}
          </ul>
        ) : null}
        <h3>Auto skill</h3>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the discipline and the writing or reasoning conventions to follow."
          />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {ready ? <p className="setup-note">Added “{ready.title}” to the discipline menu.</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Close</button>
          {ready ? <button type="button" onClick={() => downloadSkill(ready.title, ready.file)}>Download skill</button> : null}
          <button type="button" className="run" onClick={() => void generate()} disabled={busy || !name.trim() || !description.trim()}>
            {busy ? 'Generating…' : 'Generate skill'}
          </button>
        </div>
      </div>
    </div>
  )
}

function downloadSkill(title: string, file: string) {
  const blob = new Blob([file], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.replace(/[^\w.-]+/g, '_') || 'skill'}.md`
  link.click()
  URL.revokeObjectURL(url)
}
