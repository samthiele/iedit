import { useEffect, useState } from 'react'
import { ReviewPane } from './components/ReviewPane.tsx'
import { loadManuscript } from './parse/load.ts'
import { parseChatLog, sessionFromChatLog } from './review/chatLog.ts'
import type { ReviewSession } from './review/types.ts'

const base = import.meta.env.BASE_URL

export default function TestPage() {
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void loadFixture().then(
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
  }, [])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img className="brand-icon" src={`${base}favicon.svg`} alt="" width={36} height={36} />
          <div>
            <p className="mark">iEdit</p>
            <h1>Test review</h1>
          </div>
        </div>
        <a className="fixture-link" href={base}>Back to review</a>
      </header>
      <main>
        <p className="note">Example output with suggestions from a Gemini model.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {!session && !error ? <p className="note">Loading the saved review…</p> : null}
        {session ? (
          <ReviewPane
            session={session}
            onChange={(suggestions) => setSession({ ...session, suggestions })}
          />
        ) : null}
      </main>
    </div>
  )
}

async function loadFixture(): Promise<ReviewSession> {
  const [logResponse, docxResponse] = await Promise.all([
    fetch(`${base}__fixtures/chatLog.txt`),
    fetch(`${base}__fixtures/testManuscript.docx`),
  ])
  if (!logResponse.ok || !docxResponse.ok) {
    throw new Error('Could not read test/chatLog.txt and test/testManuscript.docx. Start the site with ./launch.sh so those files are served.')
  }
  const log = parseChatLog(await logResponse.text())
  const docx = new File([await docxResponse.arrayBuffer()], 'testManuscript.docx')
  return sessionFromChatLog(await loadManuscript(docx), log)
}
