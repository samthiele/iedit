import { useEffect, useState } from 'react'
import { DemoLinks } from './components/DemoLinks.tsx'
import { ReviewPane } from './components/ReviewPane.tsx'
import { WaitStatus } from './components/WaitStatus.tsx'
import { loadManuscript } from './parse/load.ts'
import { parseChatLog, sessionFromChatLog } from './review/chatLog.ts'
import type { ReviewSession } from './review/types.ts'

const base = import.meta.env.BASE_URL

export default function TestPage() {
  const kind = new URLSearchParams(window.location.search).get('demo') === 'latex' ? 'latex' : 'word'
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void loadFixture(kind).then(
      (loaded) => {
        if (active) setSession(loaded)
      },
      (caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught))
      },
    )
    return () => {
      active = false
    }
  }, [kind])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img className="brand-icon" src={`${base}favicon.svg`} alt="" width={36} height={36} />
          <div>
            <p className="mark">iEdit</p>
            <h1>
              Improving scientific writing
              {' '}
              <DemoLinks current={kind} />
            </h1>
          </div>
        </div>
        <a className="fixture-link" href={base}>Back to review</a>
      </header>
      <main>
        <p className="note">
          {kind === 'word'
            ? 'Example output of suggestions from a word file'
            : 'Example output of suggestions from a tex file'}
        </p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {!session && !error ? <WaitStatus label="Loading the saved review" /> : null}
        {session ? (
          <ReviewPane
            session={session}
            onChange={(suggestions) => setSession({ ...session, suggestions })}
          />
        ) : null}
      </main>
      <footer className="site-footer">
        <a href="https://www.samthiele.science/" target="_blank" rel="noreferrer">Sam Thiele 2026</a>
      </footer>
    </div>
  )
}

async function loadFixture(kind: 'word' | 'latex'): Promise<ReviewSession> {
  if (kind === 'latex') {
    const [logResponse, texResponse] = await Promise.all([
      fetch(`${base}__fixtures/latexChatLog.txt`),
      fetch(`${base}__fixtures/testLatex.tex`),
    ])
    if (!logResponse.ok || !texResponse.ok) {
      throw new Error('Could not read the saved LaTeX chat log and manuscript for this demo.')
    }
    const log = parseChatLog(await logResponse.text())
    const tex = new File([await texResponse.text()], 'testLatex.tex', { type: 'text/plain' })
    return sessionFromChatLog(await loadManuscript(tex), log)
  }
  const [logResponse, docxResponse] = await Promise.all([
    fetch(`${base}__fixtures/wordChatLog.txt`),
    fetch(`${base}__fixtures/testManuscript.docx`),
  ])
  if (!logResponse.ok || !docxResponse.ok) {
    throw new Error('Could not read the saved chat log and manuscript for this demo.')
  }
  const log = parseChatLog(await logResponse.text())
  const docx = new File([await docxResponse.arrayBuffer()], 'testManuscript.docx')
  return sessionFromChatLog(await loadManuscript(docx), log)
}
