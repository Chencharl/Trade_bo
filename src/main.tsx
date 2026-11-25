import React from 'react'
import ReactDOM from 'react-dom/client'
import { lazy, Suspense, useEffect, useState } from 'react'
import Atlas from './atlas/Atlas'

const ResearchDesk = lazy(() => import('./App'))
const TimingTestPage = lazy(() => import('./lab/TimingTestPage'))
const ExposureStudyPage = lazy(() => import('./lab/ExposureStudyPage'))
const SpyDailyPage = lazy(() => import('./lab/SpyDailyPage'))
const StrategyLab = lazy(() => import('./lab/StrategyLab'))
const ReversalFilterStudy = lazy(() => import('./lab/ReversalFilterStudy'))
const FullHistoryStudy = lazy(() => import('./lab/FullHistoryStudy'))
const HistoricalReplay = lazy(() => import('./lab/HistoricalReplay'))
const currentRoute = () =>
  ['#lab', '#lab-spy-daily'].includes(window.location.hash)
    ? 'daily'
    : window.location.hash === '#lab-timing-test' ||
        window.location.hash === '#lab-exposure' ||
        window.location.hash === '#lab-reversal-filters' ||
        window.location.hash === '#lab-full-history' ||
        /^#lab-history-(2008|2020)(?:\?|$)/.test(window.location.hash)
      ? window.location.hash
      : window.location.hash.startsWith('#lab')
        ? 'lab'
        : window.location.hash === '#research'
          ? 'research'
          : 'atlas'

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
          href="https://github.com/Chencharl/Trade_bo/blob/main/docs/RESEARCH_DESK.md"
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
  const [route, setRoute] = useState(currentRoute)
  const [labVisited, setLabVisited] = useState(currentRoute() === 'lab')
  useEffect(() => {
    const navigate = () => {
      const next = currentRoute()
      setRoute(next)
      if (next === 'lab') setLabVisited(true)
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => {
    if (route !== 'atlas' && route !== 'research' && window.location.hash !== '#lab-main')
      window.scrollTo(0, 0)
  }, [route])
  const historical = route.startsWith('#lab-history-')
  return (
    <>
      {route === 'daily' && (
        <Suspense fallback={<p>Opening Strategy Lab…</p>}>
          <SpyDailyPage />
        </Suspense>
      )}
      {route === '#lab-timing-test' && (
        <Suspense fallback={<p>Opening timing test…</p>}>
          <TimingTestPage />
        </Suspense>
      )}
      {route === '#lab-exposure' && (
        <Suspense fallback={<p>Opening Strategy Lab…</p>}>
          <ExposureStudyPage />
        </Suspense>
      )}
      {route === '#lab-reversal-filters' && (
        <Suspense fallback={<p>Opening reversal study…</p>}>
          <ReversalFilterStudy />
        </Suspense>
      )}
      {route === '#lab-full-history' && (
        <Suspense fallback={<p>Opening full-history study…</p>}>
          <FullHistoryStudy />
        </Suspense>
      )}
      {historical && (
        <Suspense fallback={<p>Opening historical replay…</p>}>
          <HistoricalReplay route={route} />
        </Suspense>
      )}
      <div hidden={route !== 'atlas'}>
        <Atlas />
      </div>
      <div hidden={route !== 'lab'}>
        {labVisited && (
          <Suspense fallback={<p>Opening Strategy Lab…</p>}>
            <StrategyLab />
          </Suspense>
        )}
      </div>
      {route === 'research' && <ResearchEntry />}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
