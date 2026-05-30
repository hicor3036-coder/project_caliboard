'use client'

// 데이터 소스 관리 화면 — 단일 소스(global.ktoolsCache)를 관리하는 유일한 창구
// ─ 캐시 상태(수집시각·건수·만료) 표시
// ─ [지금 새로고침] / [캐시 비우기] 두 버튼
// ─ 갱신 규칙은 고정 (① 비어있음 ② 6시간 경과 ③ 수동) — 정책 변경 UI 없음
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT, fmt } from '@/lib/i18n'

interface CacheStatusFull {
  cached: boolean
  itemCount?: number
  fetchedAt?: string
  expiresAt?: string
  ageMs?: number
  remainingMs?: number
  expired?: boolean
  hasSession?: boolean
  ttlMs: number
}

interface Progress {
  stage: string
  current: number
  total: number
  message: string
}

function formatAge(ms: number, t: ReturnType<typeof useT>['t']): string {
  if (ms < 60_000) return fmt(t.dataSource.secondsAgo, Math.floor(ms / 1000))
  if (ms < 3_600_000) return fmt(t.dataSource.minutesAgo, Math.floor(ms / 60_000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return fmt(t.dataSource.hoursAgo, h, m)
}

function formatRemaining(ms: number, t: ReturnType<typeof useT>['t']): string {
  if (ms <= 0) return t.dataSource.expired
  if (ms < 3_600_000) return fmt(t.dataSource.minutesLeft, Math.ceil(ms / 60_000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return fmt(t.dataSource.hoursLeft, h, m)
}

export default function DataSourceAdmin({ onCacheChanged }: { onCacheChanged?: () => void }) {
  const { t, lang } = useT()
  const [status, setStatus] = useState<CacheStatusFull | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const onCacheChangedRef = useRef(onCacheChanged)
  onCacheChangedRef.current = onCacheChanged

  // 1초마다 now 갱신 → 경과/남은 시간 실시간 표시
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ktools/status')
      if (!res.ok) return
      const json = (await res.json()) as CacheStatusFull
      setStatus(json)
    } catch {
      /* 무시 */
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  // SSE 스트리밍으로 강제 새로고침 (k-tools 재수집)
  const handleRefresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setProgress({ stage: 'login', current: 0, total: 0, message: t.collect.connecting })

    try {
      const res = await fetch('/api/ktools/stream')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error(t.collect.streamFail)

      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7)
          } else if (line.startsWith('data: ')) {
            const payload = JSON.parse(line.slice(6))
            if (eventType === 'progress') {
              setProgress(payload)
            } else if (eventType === 'complete') {
              setProgress(null)
            } else if (eventType === 'error') {
              throw new Error(payload.message)
            }
            eventType = ''
          }
        }
      }

      await loadStatus()
      onCacheChangedRef.current?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t.dataSource.fetchFailed)
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }, [loadStatus, t])

  const handleClear = useCallback(async () => {
    if (!window.confirm(t.dataSource.clearConfirm)) return
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/ktools/cache', { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await loadStatus()
      setNotice(t.dataSource.cleared)
      onCacheChangedRef.current?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t.dataSource.clearFailed)
    }
  }, [loadStatus, t])

  const isCached = !!status?.cached
  const ageMs = isCached && status.fetchedAt ? now - new Date(status.fetchedAt).getTime() : 0
  const remainingMs = isCached && status.expiresAt ? new Date(status.expiresAt).getTime() - now : 0
  const isExpired = isCached && remainingMs <= 0

  const statusBadge = !isCached
    ? { color: 'bg-slate-100 text-slate-600 border-slate-300', dot: 'bg-slate-400', label: t.dataSource.statusEmpty }
    : isExpired
      ? { color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: t.dataSource.statusExpired }
      : { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', label: t.dataSource.statusFresh }

  const localeStr = lang === 'ko' ? 'ko-KR' : 'en-US'

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t.dataSource.title}</h1>
        <p className="text-sm text-slate-500 mt-1">{t.dataSource.subtitle}</p>
        <p className="text-xs text-slate-400 mt-0.5">{t.dataSource.principle}</p>
      </div>

      {/* 알림 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {/* 캐시 상태 카드 */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">{t.dataSource.cacheStatus}</h2>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusBadge.color}`}>
            <span className={`w-2 h-2 rounded-full ${statusBadge.dot}`} />
            {statusBadge.label}
          </span>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-slate-500 mb-0.5">{t.dataSource.recordCount}</dt>
            <dd className="font-semibold text-slate-800">
              {isCached ? `${status.itemCount?.toLocaleString() ?? 0}${t.common.unit}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 mb-0.5">{t.dataSource.session}</dt>
            <dd className="font-semibold text-slate-800">
              {isCached
                ? (status.hasSession ? t.dataSource.sessionAlive : t.dataSource.sessionNone)
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 mb-0.5">{t.dataSource.fetchedAt}</dt>
            <dd className="font-mono text-xs text-slate-700">
              {isCached && status.fetchedAt
                ? new Date(status.fetchedAt).toLocaleString(localeStr)
                : '—'}
            </dd>
            {isCached && (
              <p className="text-xs text-slate-400 mt-0.5">{formatAge(ageMs, t)}</p>
            )}
          </div>
          <div>
            <dt className="text-slate-500 mb-0.5">{t.dataSource.expiresIn}</dt>
            <dd className={`font-semibold ${isExpired ? 'text-amber-600' : 'text-slate-800'}`}>
              {isCached ? formatRemaining(remainingMs, t) : '—'}
            </dd>
            {isCached && status.expiresAt && (
              <p className="font-mono text-xs text-slate-400 mt-0.5">
                {new Date(status.expiresAt).toLocaleString(localeStr)}
              </p>
            )}
          </div>
        </dl>

        {/* 액션 버튼 */}
        <div className="mt-6 flex gap-2">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? t.dataSource.refreshing : t.dataSource.refresh}
          </button>
          <button
            onClick={handleClear}
            disabled={loading || !isCached}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {t.dataSource.clear}
          </button>
        </div>

        {/* 진행률 */}
        {progress && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-sm text-slate-700 mb-2">{progress.message}</p>
            {progress.stage === 'fetch' && progress.total > 0 ? (
              <>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-slate-700 h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min((progress.current / progress.total) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {progress.current.toLocaleString()} / {progress.total.toLocaleString()} ({Math.round((progress.current / progress.total) * 100)}%)
                </p>
              </>
            ) : null}
          </div>
        )}
      </section>

      {/* 갱신 규칙 (고정) */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-3">{t.dataSource.rules}</h2>
        <ol className="space-y-2 text-sm text-slate-700">
          <li className="flex gap-2">
            <span className="font-mono text-slate-400">1.</span>
            <span>{t.dataSource.rule1}</span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-slate-400">2.</span>
            <span>{t.dataSource.rule2}</span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-slate-400">3.</span>
            <span>{t.dataSource.rule3}</span>
          </li>
        </ol>
      </section>

      {/* 저장 위치 안내 */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-600 mb-1">{t.dataSource.storage}</p>
        <p className="text-xs text-slate-500">{t.dataSource.storageDesc}</p>
      </section>
    </div>
  )
}
