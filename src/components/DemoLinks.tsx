const base = import.meta.env.BASE_URL

export function DemoLinks({ current }: { current?: 'word' | 'latex' }) {
  const wordHref = `${base}test`
  const latexHref = `${base}test?demo=latex`
  return (
    <>
      (DEMO:{' '}
      {current === 'word' ? <span className="demo-current">WORD</span> : <a href={wordHref}>WORD</a>}
      {' | '}
      {current === 'latex' ? <span className="demo-current">LATEX</span> : <a href={latexHref}>LATEX</a>}
      )
    </>
  )
}
