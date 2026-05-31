'use client'

// 접수정보 동기화 화면 (Phase C — Supabase 기반)
// ─ 데이터 신선도 = sync_runs 최신 success.finished_at (summary atom의 lastSyncedAt)
// ─ 새로고침 = /api/ktools/session → /task/ktools-refresh SSE → 진행률 + 완료 후 onRefreshed()
// ─ 캐시 비우기 제거 (DB는 source of truth, 비우기 의미 없음)
// ─ 자동 갱신 규칙 제거 (Phase C부터는 수동 새로고침만)

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT, fmt } from '@/lib/i18n'
import { KTOOLS_PROJECT_CODES } from '@/lib/projects'

interface Progress {
  stage: string
  current: number
  total: number
  message: string
}

interface DataSourceStatus {
  total: number
  lastSyncedAt: string | null
}

interface Props {
  status: DataSourceStatus
  onRefreshed?: () => void           // 새로고침 완료 시 호출 (page가 데이터 재조회)
  onSessionExpired?: () => void      // 401 시 로그인 페이지로
}

// "24시간 이전이면 갱신 필요"
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

function formatAge(ms: number, t: ReturnType<typeof useT>['t']): string {
  if (ms < 60_000) return fmt(t.dataSource.secondsAgo, Math.floor(ms / 1000))
  if (ms < 3_600_000) return fmt(t.dataSource.minutesAgo, Math.floor(ms / 60_000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return fmt(t.dataSource.hoursAgo, h, m)
}

export default function DataSourceAdmin({ status, onRefreshed, onSessionExpired }: Props) {
  const { t, lang } = useT()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const onRefreshedRef = useRef(onRefreshed)
  const onSessionExpiredRef = useRef(onSessionExpired)
  onRefreshedRef.current = onRefreshed
  onSessionExpiredRef.current = onSessionExpired

  // 1초마다 갱신 → 경과 시간 실시간 표시
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const handleRefresh = useCallback(async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    setProgress({ stage: 'init', current: 0, total: 0, message: t.collect.connecting })

    try {
      // 1) k-tools 세션 발급
      const sessionRes = await fetch('/api/ktools/session', { method: 'POST' })
      if (!sessionRes.ok) {
        if (sessionRes.status === 401) {
          onSessionExpiredRef.current?.()
          return
        }
        throw new Error(`세션 발급 실패 (${sessionRes.status})`)
      }
      const { sessionId } = await sessionRes.json() as { sessionId: string }

      // 2) task SSE 시작
      const taskRes = await fetch('/task/ktools-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          prjcCdList: [...KTOOLS_PROJECT_CODES],
        }),
      })
      if (!taskRes.ok || !taskRes.body) {
        throw new Error(`task 시작 실패 (${taskRes.status})`)
      }

      // 3) SSE 파싱
      const reader = taskRes.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let done = false
      while (!done) {
        const { value, done: rdone } = await reader.read()
        done = rdone
        if (value) buf += decoder.decode(value, { stream: true })

        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const lines = raw.split('\n')
          const evLine = lines.find(l => l.startsWith('event: '))?.slice(7)
          const dtLine = lines.find(l => l.startsWith('data: '))?.slice(6)
          if (!evLine || !dtLine) continue
          const dt = JSON.parse(dtLine)
          if (evLine === 'progress') {
            setProgress(dt as Progress)
          } else if (evLine === 'done') {
            setProgress({
              stage: 'done',
              current: dt.upserted,
              total: dt.upserted,
              message: `완료 (${dt.upserted.toLocaleString()}건 / ${Math.round(dt.durationMs / 1000)}초)`,
            })
          } else if (evLine === 'error') {
            if (dt.sessionExpired) {
              onSessionExpiredRef.current?.()
              return
            }
            throw new Error(dt.message ?? '동기화 실패')
          }
        }
      }

      // 4) 부모에게 데이터 재조회 요청
      onRefreshedRef.current?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t.dataSource.fetchFailed)
    } finally {
      setLoading(false)
      // 진행률은 잠깐 더 보여주고 자동 해제
      setTimeout(() => setProgress(null), 2500)
    }
  }, [loading, t])

  // ── 신선도 판정
  const hasSync = !!status.lastSyncedAt
  const lastSyncMs = hasSync ? new Date(status.lastSyncedAt!).getTime() : 0
  const ageMs = hasSync ? now - lastSyncMs : 0
  const isStale = hasSync && ageMs > STALE_THRESHOLD_MS

  const statusBadge = !hasSync
    ? { color: 'bg-slate-100 text-slate-600 border-slate-300', dot: 'bg-slate-400', label: t.dataSource.statusEmpty }
    : isStale
      ? { color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: t.dataSource.statusExpired }
      : { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', label: t.dataSource.statusFresh }

  const localeStr = lang === 'ko' ? 'ko-KR' : 'en-US'

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t.dataSource.title}</h1>
        <p className="text-sm text-slate-500 mt-1">{t.dataSource.subtitle}</p>
      </div>

      {/* 알림 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 신선도 카드 */}
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
              {status.total.toLocaleString()}{t.common.unit}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 mb-0.5">{t.dataSource.fetchedAt}</dt>
            <dd className="font-mono text-xs text-slate-700">
              {hasSync ? new Date(status.lastSyncedAt!).toLocaleString(localeStr) : '—'}
            </dd>
            {hasSync && (
              <p className="text-xs text-slate-400 mt-0.5">{formatAge(ageMs, t)}</p>
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
        </div>

        {/* 진행률 */}
        {progress && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-sm text-slate-700 mb-2">{progress.message}</p>
            {progress.total > 0 && (
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
            )}
          </div>
        )}
      </section>

      {/* 연계 대상 과제 */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-slate-800">{t.dataSource.projects}</h2>
          <span className="text-xs text-slate-500">
            {fmt(t.dataSource.projectsCount, KTOOLS_PROJECT_CODES.length)}
          </span>
        </div>
        <ul className="flex flex-wrap gap-2">
          {KTOOLS_PROJECT_CODES.map(code => (
            <li
              key={code}
              className="inline-flex items-center px-3 py-1.5 bg-slate-100 text-slate-700 text-sm font-mono rounded-md border border-slate-200"
            >
              {code}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
