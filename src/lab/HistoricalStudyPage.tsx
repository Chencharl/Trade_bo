import { useState, useEffect, type ReactNode } from 'react'
import LabHeader from './LabHeader'
import { HISTORY_HASH } from './crises'
import './lab.css'
import './month-view.css'
import './historical.css'
import './full-history.css'
import './exposure.css'
type Language = 'en' | 'zh'
export type Text = (en: string, zh: string) => string
type StudyProps<T> = {
  file: string
  version: string
  valid: (report: T) => boolean
  render: (report: T, t: Text) => ReactNode
}
export default function HistoricalStudyPage<T>({ file, version, valid, render }: StudyProps<T>) {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('tradebo-study-language')
      if (saved === 'zh' || saved === 'en') return saved
    } catch {
      /* Storage is optional. */
    }
    return navigator.language.startsWith('zh') ? 'zh' : 'en'
  })
  const t: Text = (en, zh) => (lang === 'zh' ? zh : en)
  const [r, setReport] = useState<T | null>(null),
    [error, setError] = useState(false),
    [attempt, retry] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    setError(false)
    fetch(file, { signal: c.signal })
      .then((res) => {
        if (!res.ok) throw Error()
        return res.json()
      })
      .then((d) => {
        if (d.version !== version || d.dataSha256 !== HISTORY_HASH || !valid(d)) throw Error()
        if (!c.signal.aborted) setReport(d)
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true)
      })
    return () => c.abort()
  }, [attempt, file, version, valid])
  return (
    <div className="atlas-app lab-app" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      <LabHeader />
      <main className="lab-main xp">
        <nav className="lab-history-links xp-nav" aria-label={t('Study navigation', '研究导航')}>
          <a href="#lab">← Strategy Lab</a>
          {version === 'timing-null-1' ? (
            <a href="#lab-exposure">{t('Stock exposure & timing', '股票仓位与择时')}</a>
          ) : (
            <a href="#lab-timing-test">{t('Timing vs chance', '择时与随机对照')}</a>
          )}
          <a href="#lab-reversal-filters">{t('Reversal filter study', '反转与误报研究')}</a>
          <button
            className="xp-language"
            onClick={() => {
              const next = lang === 'en' ? 'zh' : 'en'
              setLang(next)
              try {
                localStorage.setItem('tradebo-study-language', next)
              } catch {
                /* Storage is optional. */
              }
            }}
            lang={lang === 'en' ? 'zh-CN' : 'en'}
          >
            {lang === 'en' ? '中文' : 'English'}
          </button>
        </nav>
        {r ? (
          render(r, t)
        ) : error ? (
          <div role="alert">
            <p>{t('Couldn’t load the study.', '研究数据载入失败。')}</p>
            <button onClick={() => retry((n) => n + 1)}>{t('Retry', '重试')}</button>
          </div>
        ) : (
          <p role="status">{t('Loading study…', '正在加载研究…')}</p>
        )}
      </main>
    </div>
  )
}
