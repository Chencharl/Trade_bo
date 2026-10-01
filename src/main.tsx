import React from 'react'
import ReactDOM from 'react-dom/client'
import { lazy, Suspense, useEffect, useState } from 'react'
import Atlas from './atlas/Atlas'

const ResearchDesk = lazy(() => import('./App'))

function ResearchEntry() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setAvailable(data?.ok === true))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  if (available)
    return (
      <Suspense fallback={<p>Loading the research desk…</p>}>
        <ResearchDesk />
      </Suspense>
    )
  return (
    <div className="atlas-app">
      <div className="atlas-local-desk">
        <a href="#">← Back to Atlas</a>
        <h1>
          The research desk.
          <br />
          On your own machine.
        </h1>
        <p>
          The original TradeBo workspace connects holdings, company research, source evidence, and
          paper trade plans. Run its Python API locally to open the desk. Atlas works entirely in
          the browser.
        </p>
        <pre>
          <code>
            {
              'git clone https://github.com/Chencharl/Trade_bo.git\ncd Trade_bo\nnpm ci\nnpm run build\npython3 -m backend.server'
            }
          </code>
        </pre>
        <p>
          Then open http://127.0.0.1:8765/#research. The included sample uses fictional companies;
          an optional server-side provider key enables market data.
        </p>
        <a
          className="atlas-button"
          href="https://github.com/Chencharl/Trade_bo/blob/codex/atlas-lab/docs/RESEARCH_DESK.md"
          target="_blank"
          rel="noreferrer"
        >
          Read the research desk guide ↗
        </a>
      </div>
    </div>
  )
}

function Root() {
  const [research, setResearch] = useState(window.location.hash === '#research')
  useEffect(() => {
    const navigate = () => setResearch(window.location.hash === '#research')
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  return research ? <ResearchEntry /> : <Atlas />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
