import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
  const [hoverId, setHoverId] = useState<string | null>(null)

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
          <button type="button" onClick={() => openChatLog(session)}>Chat log</button>
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
          const notes = orderedNotes(session.suggestions.filter((suggestion) => suggestion.paraId === paragraph.id))
          if (!paragraph.text.trim() && notes.length === 0) return null
          return (
            <ParagraphReview
              key={paragraph.id}
              paragraph={paragraph}
              notes={notes}
              hoverId={hoverId}
              onHover={setHoverId}
              onStatus={setStatus}
            />
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

function ParagraphReview({
  paragraph,
  notes,
  hoverId,
  onHover,
  onStatus,
}: {
  paragraph: ReviewSession['document']['paragraphs'][number]
  notes: Suggestion[]
  hoverId: string | null
  onHover: (id: string | null) => void
  onStatus: (id: string, status: SuggestionStatus) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const hoverWhole = notes.some((suggestion) => suggestion.id === hoverId && !suggestion.span)

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const layout = () => layoutCommentRail(row)
    layout()
    const line = row.querySelector<HTMLElement>('.para-line')
    const rail = row.querySelector<HTMLElement>('.comment-rail')
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(layout)
    if (line) observer?.observe(line)
    rail?.querySelectorAll<HTMLElement>('.comment-bubble').forEach((bubble) => observer?.observe(bubble))
    const media = window.matchMedia('(max-width: 800px)')
    media.addEventListener('change', layout)
    return () => {
      observer?.disconnect()
      media.removeEventListener('change', layout)
    }
  })

  return (
    <div className="para-row" ref={rowRef}>
      <p className={`para-line para-${paragraph.kind}${hoverWhole ? ' is-hovered' : ''}`}>
        {pieces(paragraph.text, notes).map((piece, index) => {
          if (piece.kind === 'text') return <span key={index}>{piece.text}</span>
          const hot = piece.suggestion.id === hoverId
          if (piece.kind === 'plain') {
            return (
              <span
                className={hot ? 'suggest-mark is-hot' : 'suggest-mark'}
                key={piece.suggestion.id}
                data-suggestion={piece.suggestion.id}
              >
                {piece.text}
              </span>
            )
          }
          return (
            <span className={hot ? 'redline is-hot' : 'redline'} key={piece.suggestion.id} data-suggestion={piece.suggestion.id}>
              {piece.suggestion.segments.map((segment, segmentIndex) => {
                if (!segment.text) return null
                if (segment.type === 'delete') return <span className="del" key={segmentIndex}>{segment.text}</span>
                if (segment.type === 'insert') return <span className="ins" key={segmentIndex}>{segment.text}</span>
                return <span key={segmentIndex}>{segment.text}</span>
              })}
            </span>
          )
        })}
      </p>
      <div className="comment-rail">
        {notes.map((suggestion) => (
          <CommentBubble
            key={suggestion.id}
            suggestion={suggestion}
            onStatus={onStatus}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  )
}

function Inline({ children }: { children?: ReactNode }) {
  return <span>{children}</span>
}

function CommentBubble({
  suggestion,
  onStatus,
  onHover,
}: {
  suggestion: Suggestion
  onStatus: (id: string, status: SuggestionStatus) => void
  onHover: (id: string | null) => void
}) {
  const science = suggestion.author === 'AI-science'
  const tag = science ? 'AI-science' : 'AI-copyedit'
  return (
    <aside
      className={`comment-bubble comment-bubble-${science ? 'science' : 'copyedit'} is-${suggestion.status}`}
      data-suggestion={suggestion.id}
      onMouseEnter={() => onHover(suggestion.id)}
      onMouseLeave={() => onHover(null)}
    >
      <p className="bubble-tag">{tag}</p>
      <div className="bubble-body">
        <Markdown components={{ p: Inline }}>{suggestion.comment}</Markdown>
        {science ? <span className="bubble-check">{suggestion.grounded ? 'search-checked' : 'not search-checked'}</span> : null}
      </div>
      <p className="bubble-actions">
        <button type="button" onClick={() => onStatus(suggestion.id, 'accepted')} disabled={suggestion.status === 'accepted'}>Accept</button>
        <span aria-hidden="true"> | </span>
        <button type="button" onClick={() => onStatus(suggestion.id, 'rejected')} disabled={suggestion.status === 'rejected'}>Reject</button>
        {suggestion.status !== 'pending' ? (
          <>
            <span aria-hidden="true"> | </span>
            <button type="button" onClick={() => onStatus(suggestion.id, 'pending')}>Undo</button>
          </>
        ) : null}
      </p>
    </aside>
  )
}

type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'plain'; suggestion: Suggestion; text: string }
  | { kind: 'redline'; suggestion: Suggestion }

const COMMENT_GAP_REM = 1

export function stackCommentTops(desiredTops: number[], heights: number[], gap: number): number[] {
  const order = desiredTops
    .map((desired, index) => ({ desired, index }))
    .sort((a, b) => a.desired - b.desired || a.index - b.index)
  const tops = Array<number>(desiredTops.length).fill(0)
  let cursor = 0
  for (const item of order) {
    const top = Math.max(item.desired, cursor)
    tops[item.index] = top
    cursor = top + heights[item.index] + gap
  }
  return tops
}

function layoutCommentRail(row: HTMLElement) {
  const line = row.querySelector<HTMLElement>('.para-line')
  const rail = row.querySelector<HTMLElement>('.comment-rail')
  if (!line || !rail) return
  const bubbles = [...rail.querySelectorAll<HTMLElement>('.comment-bubble')]
  const stacked = window.matchMedia('(max-width: 800px)').matches
  if (stacked || bubbles.length === 0) {
    if (rail.style.minHeight) rail.style.minHeight = ''
    for (const bubble of bubbles) {
      if (bubble.style.top) bubble.style.top = ''
    }
    return
  }
  const lineTop = line.getBoundingClientRect().top
  const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const gap = rootFont * COMMENT_GAP_REM
  const desired = bubbles.map((bubble) => {
    const id = bubble.dataset.suggestion
    const anchor = id
      ? [...line.querySelectorAll<HTMLElement>('[data-suggestion]')].find((element) => element.dataset.suggestion === id)
      : undefined
    return anchor ? anchor.getBoundingClientRect().top - lineTop : 0
  })
  const heights = bubbles.map((bubble) => bubble.offsetHeight)
  const tops = stackCommentTops(desired, heights, gap)
  bubbles.forEach((bubble, index) => {
    const next = `${Math.round(tops[index])}px`
    if (bubble.style.top !== next) bubble.style.top = next
  })
  const bottom = tops.reduce((max, top, index) => Math.max(max, top + heights[index]), 0)
  const nextMin = `${Math.round(Math.max(line.offsetHeight, bottom))}px`
  if (rail.style.minHeight !== nextMin) rail.style.minHeight = nextMin
}

function orderedNotes(suggestions: Suggestion[]): Suggestion[] {
  return suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((a, b) => (a.suggestion.span?.start ?? Number.POSITIVE_INFINITY) - (b.suggestion.span?.start ?? Number.POSITIVE_INFINITY) || a.index - b.index)
    .map((item) => item.suggestion)
}

function pieces(text: string, suggestions: Suggestion[]): Piece[] {
  const ranged = suggestions
    .filter((suggestion) => suggestion.span)
    .sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0))
  const out: Piece[] = []
  let cursor = 0
  for (const suggestion of ranged) {
    const span = suggestion.span
    if (!span || span.start < cursor) continue
    if (span.start > cursor) out.push({ kind: 'text', text: text.slice(cursor, span.start) })
    if (suggestion.status === 'pending') {
      out.push({ kind: 'redline', suggestion })
    } else if (suggestion.status === 'accepted') {
      const baked = suggestion.segments.filter((segment) => segment.type !== 'delete').map((segment) => segment.text).join('')
      out.push({ kind: 'plain', suggestion, text: baked || suggestion.insert })
    } else {
      out.push({ kind: 'plain', suggestion, text: text.slice(span.start, span.end) })
    }
    cursor = span.end
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) })
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

function openChatLog(session: ReviewSession) {
  const page = window.open('', '_blank')
  if (!page) return
  const turns = [
    { role: 'system', text: session.chatLog.system },
    ...session.chatLog.turns,
  ]
  const blocks = turns.map((turn) => (
    `<section><h2>${escapeHtml(turn.role)}</h2><pre>${escapeHtml(turn.text)}</pre></section>`
  )).join('')
  page.document.open()
  page.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iEdit chat log</title>
  <style>
    body { margin: 0; background: #1e1f22; color: #e8eaed; font: 15px/1.45 'SF Mono', Menlo, Consolas, monospace; }
    main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    h1 { font-size: 1rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
    h2 { margin: 0 0 0.4rem; font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; color: #9aa0a6; }
    section { margin: 0 0 1rem; padding: 0.75rem 0.9rem; background: #121316; border: 1px solid #3c4043; border-radius: 4px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <h1>Chat log · ${escapeHtml(session.document.fileName)}</h1>
    ${blocks}
  </main>
</body>
</html>`)
  page.document.close()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
