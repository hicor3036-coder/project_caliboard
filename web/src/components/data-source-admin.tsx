'use client'

// 접수정보 동기화 화면 (Phase C — Supabase 기반)
// ─ 데이터 신선도 = sync_runs 최신 success.finished_at (summary atom의 lastSyncedAt)
// ─ 새로고침/진행률 상태는 page.tsx의 useKtoolsRefresh 훅에서 주입 (단일 소스)
// ─ stale 임계값은 lib/freshness.ts 공용 상수
// ─ 캐시 비우기 제거 (DB는 source of truth)

import { useEffect, useState } from 'react'
import { useT, fmt } from '@/lib/i18n'
import { KTOOLS_PROJECT_CODES } from '@/lib/projects'
import { STALE_THRESHOLD_MS } from '@/lib/freshness'
import type { RefreshProgress, TriggerSource } from '@/lib/use-ktools-refresh'

interface DataSourceStatus {
  total: number
  lastSyncedAt: string | null
}

interface Props {
  status: DataSourceStatus
  refresh: {
    running: boolean
    progress: RefreshProgress | null
    error: string | null
    source: TriggerSource | null
    onRefresh: () => void          // 수동 새로고침 버튼 클릭
  }
}

function formatAge(ms: number, t: ReturnType<typeof useT>['t']): string {
  if (ms < 60_000) return fmt(t.dataSource.secondsAgo, Math.floor(ms / 1000))
  if (ms < 3_600_000) return fmt(t.dataSource.minutesAgo, Math.floor(ms / 60_000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return fmt(t.dataSource.hoursAgo, h, m)
}

export default function DataSourceAdmin({ status, refresh }: Props) {
  const { t, lang } = useT()
  const [now, setNow] = useState(Date.now())

  // 1초마다 갱신 → 경과 시간 실시간 표시
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

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
      {refresh.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {refresh.error}
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
            onClick={refresh.onRefresh}
            disabled={refresh.running}
            className="px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${refresh.running ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refresh.running ? t.dataSource.refreshing : t.dataSource.refresh}
          </button>
          {refresh.running && refresh.source === 'auto' && (
            <span className="self-center text-xs text-slate-500">
              로그인 시 자동 갱신 중 (마지막 동기화 후 {Math.floor(STALE_THRESHOLD_MS / 3600000)}시간 초과)
            </span>
          )}
        </div>

        {/* 진행률 */}
        {refresh.progress && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-sm text-slate-700 mb-2">{refresh.progress.message}</p>
            {refresh.progress.total > 0 && (
              <>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-slate-700 h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min((refresh.progress.current / refresh.progress.total) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {refresh.progress.current.toLocaleString()} / {refresh.progress.total.toLocaleString()} ({Math.round((refresh.progress.current / refresh.progress.total) * 100)}%)
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
