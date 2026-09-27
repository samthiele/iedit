import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import { docxFileName, exportDocx } from '../export/docx.ts'
import { markdownFileName, reviewMarkdown } from '../export/markdown.ts'
import { exportTex, texFileName } from '../export/tex.ts'
import type { ReviewSession, Suggestion, SuggestionStatus } from '../review/types.ts'

export function ReviewPane({
  session,
  onChange,
}: {
  session: ReviewSession
  onChange: (suggestions: Suggestion[]) => void
}) {
  const setStatus = (id: string, status: SuggestionStatus) => {
    onChange(session.suggestions.map((suggestion) => (
      suggestion.id === id ? { ...suggestion, status } : suggestion
    )))
  }

  const setAll = (status: SuggestionStatus) => {
    onChange(session.suggestions.map((suggestion) => ({ ...suggestion, status })))
  }

  return (
    <section className="review">
      <div className="review-toolbar">
        <div className="toolbar-actions">
          <button type="button" onClick={() => setAll('accepted')}>Accept all</button>
          <button type="button" onClick={() => setAll('rejected')}>Reject all</button>
          <button type="button" onClick={() => downloadMarkdown(session)}>Download notes</button>
          <button type="button" onClick={() => downloadEdited(session)}>
            Download {session.document.kind === 'docx' ? 'Word' : 'LaTeX'}
          </button>
        </div>
      </div>

      {session.summary ? (
        <details className="summary">
          <summary>Summary</summary>
          <Markdown>{session.summary}</Markdown>
        </details>
      ) : null}

      <ScienceBanner session={session} />

      {session.warnings.length > 0 ? (
        <ul className="warnings">
          {session.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}

      <div className="manuscript">
        {session.document.paragraphs.filter((paragraph) => paragraph.kind !== 'preamble').map((paragraph) => {
          const notes = session.suggestions.filter((suggestion) => suggestion.paraId === paragraph.id)
          if (!paragraph.text.trim() && notes.length === 0) return null
          return (
            <p className={`para-line para-${paragraph.kind}`} key={paragraph.id}>
              {pieces(paragraph.text, notes).map((piece, index) => {
                if (piece.kind === 'text') return <span key={index}>{piece.text}</span>
                if (piece.kind === 'delete') return <span key={index} className="del">{piece.text}</span>
                if (piece.kind === 'insert') return <span key={index} className="ins">{piece.text}</span>
                if (piece.kind !== 'comment') return null
                return <InlineComment key={piece.suggestion.id} suggestion={piece.suggestion} onStatus={setStatus} />
              })}
            </p>
          )
        })}
      </div>
    </section>
  )
}

function ScienceBanner({ session }: { session: ReviewSession }) {
  if (!session.scienceRan) {
    return <p className="banner">Science pass was not run. Only wording suggestions are shown.</p>
  }
  return (
    <div className="banner">
      <p>
        Science comments use Gemini Google Search grounding. That is not the full research pass behind geoeditor: sources are whatever search returned, and a note marked “not search-checked” was not verified against the literature.
      </p>
      {session.scienceError ? <p className="banner-error">{session.scienceError}</p> : null}
      {session.sources.length > 0 ? (
        <ul className="sources">
          {session.sources.map((source) => (
            <li key={source.uri}>
              <a href={source.uri} target="_blank" rel="noreferrer">{source.title}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Inline({ children }: { children?: ReactNode }) {
  return <span>{children}</span>
}

function InlineComment({
  suggestion,
  onStatus,
}: {
  suggestion: Suggestion
  onStatus: (id: string, status: SuggestionStatus) => void
}) {
  const science = suggestion.author === 'AI-science'
  const tag = science ? 'AI-science' : 'AI-copyedit'
  return (
    <span className={`md-comment md-comment-${science ? 'science' : 'copyedit'} is-${suggestion.status}`}>
      {' '}[{tag}: <Markdown components={{ p: Inline }}>{suggestion.comment}</Markdown>
      {science ? ` — ${suggestion.grounded ? 'search-checked' : 'not search-checked'}` : null}]
      {' '}
      <button type="button" onClick={() => onStatus(suggestion.id, 'accepted')} disabled={suggestion.status === 'accepted'}>Accept</button>
      <button type="button" onClick={() => onStatus(suggestion.id, 'rejected')} disabled={suggestion.status === 'rejected'}>Reject</button>
      {suggestion.status !== 'pending' ? (
        <button type="button" onClick={() => onStatus(suggestion.id, 'pending')}>Undo</button>
      ) : null}
    </span>
  )
}

type Piece =
  | { kind: 'text' | 'delete' | 'insert'; text: string }
  | { kind: 'comment'; suggestion: Suggestion }

function pieces(text: string, suggestions: Suggestion[]): Piece[] {
  const ranged = suggestions
    .filter((suggestion) => suggestion.status !== 'rejected' && suggestion.span)
    .sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0))
  const out: Piece[] = []
  let cursor = 0
  const placed = new Set<string>()
  for (const suggestion of ranged) {
    const span = suggestion.span
    if (!span || span.start < cursor) continue
    if (span.start > cursor) out.push({ kind: 'text', text: text.slice(cursor, span.start) })
    for (const segment of suggestion.segments) {
      if (!segment.text) continue
      out.push({
        kind: segment.type === 'delete' ? 'delete' : segment.type === 'insert' ? 'insert' : 'text',
        text: segment.text,
      })
    }
    out.push({ kind: 'comment', suggestion })
    placed.add(suggestion.id)
    cursor = span.end
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) })
  for (const suggestion of suggestions) {
    if (!placed.has(suggestion.id)) out.push({ kind: 'comment', suggestion })
  }
  if (out.length === 0) out.push({ kind: 'text', text })
  return out
}

function downloadMarkdown(session: ReviewSession) {
  download(new Blob([reviewMarkdown(session)], { type: 'text/markdown' }), markdownFileName(session.document.fileName))
}

async function downloadEdited(session: ReviewSession) {
  if (session.document.kind === 'docx') {
    const buffer = await exportDocx(session.document, session.suggestions)
    download(
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      docxFileName(session.document.fileName),
    )
    return
  }
  download(new Blob([exportTex(session.document, session.suggestions)], { type: 'text/plain' }), texFileName(session.document.fileName))
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
