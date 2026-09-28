import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import TestPage from './TestPage.tsx'
import { appRoute } from './route.ts'

function Root() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const url = new URL('https://app-analytics.my-app-logs.workers.dev')
    url.searchParams.set('app', 'iEdit')
    url.searchParams.set('page', `${window.location.origin}${window.location.pathname}`)
    url.searchParams.set('referrer', document.referrer || '')
    fetch(url, { mode: 'cors', keepalive: true }).catch(() => {})
  }, [])
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return appRoute(path, import.meta.env.BASE_URL) === 'test' ? <TestPage /> : <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
