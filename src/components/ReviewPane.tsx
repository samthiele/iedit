import { createElement, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { docxFileName, exportDocx } from '../export/docx.ts'
import { markdownFileName, reviewMarkdown } from '../export/markdown.ts'
import { exportTex, texFileName } from '../export/tex.ts'
import { manuscriptSource } from '../review/manuscriptMarkdown.ts'
import type { Paragraph, ReviewSession, Suggestion, SuggestionStatus } from '../review/types.ts'

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
            Download {session.document.kind === 'docx' ? 'Word' : 'Latex'}
          </button>
          <button type="button" onClick={() => openChatLog(session)}>Chat log</button>
        </div>
      </div>

      <details className="summary">
        <summary>Summary</summary>
        {session.summary ? <Markdown>{session.summary}</Markdown> : null}
        <ScienceNotes session={session} />
      </details>

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

function ScienceNotes({ session }: { session: ReviewSession }) {
  if (!session.scienceRan) {
    return <p>Science pass was not run. Only wording suggestions are shown.</p>
  }
  return (
    <>
      <p>
        Science comments use a web search. That is narrower than a full literature review: sources are whatever search returned, and a note marked “not search-checked” was not verified against the literature.
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
    </>
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
      <div className={`para-line para-${paragraph.kind}${hoverWhole ? ' is-hovered' : ''}`}>
        <ParagraphText
          paragraph={paragraph}
          html={manuscriptSource(paragraph.text, notes, paragraph.marks, hoverId, paragraph.links)}
        />
      </div>
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

const COMMENT_GAP_REM = 1

function ParagraphText({ paragraph, html }: { paragraph: Paragraph; html: string }) {
  if (paragraph.kind === 'table') {
    return (
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {html}
      </Markdown>
    )
  }
  if (paragraph.kind === 'heading') {
    const level = Math.min(6, Math.max(1, paragraph.level ?? 2))
    return createElement(`h${level}`, { className: 'md-heading', dangerouslySetInnerHTML: { __html: html } })
  }
  return <p dangerouslySetInnerHTML={{ __html: html }} />
}

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

function chatLogPlainText(session: ReviewSession): string {
  const turns = [
    { role: 'system', text: session.chatLog.system },
    ...session.chatLog.turns,
  ]
  return turns.map((turn) => `${turn.role}\n${turn.text}`).join('\n\n')
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
  const logJson = JSON.stringify(chatLogPlainText(session)).replace(/</g, '\\u003c')
  page.document.open()
  page.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iEdit chat log</title>
  <style>
    body { margin: 0; background: #1e1f22; color: #e8eaed; font: 15px/1.45 'SF Mono', Menlo, Consolas, monospace; }
    .log-top { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.75rem 1rem; background: #25262a; border-bottom: 1px solid #3c4043; }
    h1 { margin: 0; font-size: 1rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
    #copy-log { font: inherit; font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; color: #e8eaed; background: #1a1b1e; border: 1px solid #3c4043; border-radius: 4px; padding: 0.35rem 0.65rem; cursor: pointer; }
    #copy-log:hover { border-color: #8ab4f8; }
    main { max-width: 52rem; margin: 0 auto; padding: 1rem 1rem 3rem; }
    h2 { margin: 0 0 0.4rem; font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; color: #9aa0a6; }
    section { margin: 0 0 1rem; padding: 0.75rem 0.9rem; background: #121316; border: 1px solid #3c4043; border-radius: 4px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <header class="log-top">
    <h1>Chat log · ${escapeHtml(session.document.fileName)}</h1>
    <button type="button" id="copy-log">Copy</button>
  </header>
  <main>
    ${blocks}
  </main>
  <script>
    const logText = ${logJson};
    const button = document.getElementById('copy-log');
    button.addEventListener('click', () => {
      const done = () => {
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, 1500);
      };
      const fallback = () => {
        const area = document.createElement('textarea');
        area.value = logText;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        done();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(logText).then(done, fallback);
      } else {
        fallback();
      }
    });
  </script>
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
