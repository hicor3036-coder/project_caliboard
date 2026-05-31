'use client'

// 대시보드 메인 페이지 (Phase C)
// ─ 9개 supabase READ atom을 useEffect로 병렬 호출
// ─ atom 응답(snake_case) → 컴포넌트 친화 형태로 매핑은 lib/supabase-fetch.ts 책임
// ─ ktools 수집 SSE는 useKtoolsRefresh 훅이 단일 소스 — sidebar/data-source-admin이 같은 상태 공유
// ─ 자동 트리거: 로그인/홈 진입 시 12h 초과면 1회 자동 수집 (옵션 B: 단일 브라우저 in-flight 가드)
// ─ 활성 뷰: home / unprocessed / upcoming / reception / search / data-source
//   미연결: profiles / report / equipment-detail (Phase C2)
// ─ reception/search: 전체 row 필요 → 뷰 진입 시 lazy fetch (캐시)

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar, { type ViewType } from '@/components/sidebar'
import SummaryCards from '@/components/summary-cards'
import UnprocessedTable from '@/components/unprocessed-table'
import UpcomingCalibration from '@/components/upcoming-calibration'
import ReceptionCheck from '@/components/reception-check'
import EquipmentSearch from '@/components/equipment-search'
import { StatusPieChart, MonthlyBarChart, HorizontalBarChart } from '@/components/charts'
import DataSourceAdmin from '@/components/data-source-admin'
import { useT } from '@/lib/i18n'
import { STALE_THRESHOLD_MS } from '@/lib/freshness'
import { useKtoolsRefresh } from '@/lib/use-ktools-refresh'
import {
  fetchDashboardData,
  fetchReceptionItems,
  fetchSearchItems,
  mapUnprocessed,
  mapUpcoming,
  mapMonthlyForUI,
  mapReceptionItems,
  mapSearchItems,
  type DashboardData,
  type ReceptionItemForUI,
  type SearchItemForUI,
} from '@/lib/supabase-fetch'

export default function Home() {
  const router = useRouter()
  const { t } = useT()

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewType>('home')

  // ── lazy 캐시: data + cachedFor (summary.lastSyncedAt 스냅샷)
  // ─ cachedFor가 현재 summary.lastSyncedAt과 다르면 stale → 재페치
  // ─ DB 갱신(내/타인 트리거 무관)되면 loadData가 새 lastSyncedAt 받음 → 자동 무효화
  const [receptionCache, setReceptionCache] = useState<{ data: ReceptionItemForUI[]; cachedFor: string | null } | null>(null)
  const [receptionError, setReceptionError] = useState<string | null>(null)
  const [searchCache, setSearchCache] = useState<{ data: SearchItemForUI[]; cachedFor: string | null } | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  // ── 데이터 조회
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await fetchDashboardData()
      setData(d)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류'
      // 401 류 — 로그인 페이지로
      if (msg.includes('401')) {
        router.replace('/login')
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  // ── ktools 동기화 훅 (page가 단일 소스 — sidebar/data-source-admin이 같은 상태 공유)
  const refreshHook = useKtoolsRefresh({
    onRefreshed: loadData,
    onSessionExpired: () => router.replace('/login'),
  })

  // ── 자동 트리거: 12h 초과 시 1회 자동 수집 (옵션 B — 단일 브라우저 in-flight 가드)
  const autoTriggeredRef = useRef(false)
  useEffect(() => {
    if (autoTriggeredRef.current) return
    if (!data) return
    if (refreshHook.running) return

    const last = data.summary.lastSyncedAt ? new Date(data.summary.lastSyncedAt).getTime() : 0
    const age = Date.now() - last
    if (!last || age > STALE_THRESHOLD_MS) {
      autoTriggeredRef.current = true
      refreshHook.refresh('auto')
    }
  }, [data, refreshHook])

  // ── reception 뷰 진입 시 페치 (lastSyncedAt 변하면 자동 재페치)
  const currentSync = data?.summary.lastSyncedAt ?? null
  useEffect(() => {
    if (view !== 'reception') return
    if (receptionCache && receptionCache.cachedFor === currentSync) return  // 캐시 유효
    let aborted = false
    fetchReceptionItems()
      .then(rows => { if (!aborted) setReceptionCache({ data: mapReceptionItems(rows), cachedFor: currentSync }) })
      .catch(e => {
        if (aborted) return
        const msg = e instanceof Error ? e.message : '알 수 없는 오류'
        setReceptionError(msg)
      })
    return () => { aborted = true }
  }, [view, receptionCache, currentSync])

  // ── search 뷰 진입 시 페치 (동일 패턴)
  useEffect(() => {
    if (view !== 'search') return
    if (searchCache && searchCache.cachedFor === currentSync) return
    let aborted = false
    fetchSearchItems()
      .then(rows => { if (!aborted) setSearchCache({ data: mapSearchItems(rows), cachedFor: currentSync }) })
      .catch(e => {
        if (aborted) return
        const msg = e instanceof Error ? e.message : '알 수 없는 오류'
        setSearchError(msg)
      })
    return () => { aborted = true }
  }, [view, searchCache, currentSync])

  // ── 로그아웃
  const handleLogout = useCallback(async () => {
    try { await fetch('/api/ktools/logout', { method: 'POST' }) } catch { /* 무시 */ }
    router.replace('/login')
  }, [router])

  // ── 컴포넌트 친화 매핑 (memo)
  const summaryForUI = useMemo(() => {
    if (!data) return null
    return {
      총건수: data.summary.total,
      미처리건수: data.summary.unprocessed,
      교정임박건수: data.summary.upcoming30,
      평균소요일: data.summary.avgDurationDays,
      데이터시점: data.summary.lastSyncedAt ?? new Date().toISOString(),
    }
  }, [data])

  const unprocessedForUI = useMemo(
    () => data ? mapUnprocessed(data.unprocessed) : [],
    [data],
  )

  const upcomingForUI = useMemo(
    () => data ? mapUpcoming(data.upcoming, data.summary.avgDurationDays, data.byManufacturer) : null,
    [data],
  )

  const monthlyForUI = useMemo(
    () => data ? mapMonthlyForUI(data.monthlyTrend) : [],
    [data],
  )

  // ── 렌더
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        activeView={view}
        onViewChange={setView}
        onLogout={handleLogout}
        미처리건수={data?.summary.unprocessed}
        교정임박건수={data?.summary.upcoming30}
        syncing={refreshHook.running}
      />

      <main className="flex-1 p-6 lg:p-8 overflow-x-auto">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center h-96 text-slate-400">데이터 불러오는 중...</div>
        ) : !data ? (
          <div className="flex items-center justify-center h-96 text-slate-400">데이터 없음</div>
        ) : (
          <>
            {view === 'home' && (
              <div className="space-y-6">
                {summaryForUI && (
                  <SummaryCards
                    총건수={summaryForUI.총건수}
                    미처리건수={summaryForUI.미처리건수}
                    교정임박건수={summaryForUI.교정임박건수}
                    평균소요일={summaryForUI.평균소요일}
                    데이터시점={summaryForUI.데이터시점}
                  />
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <StatusPieChart data={data.byStatus} />
                  <MonthlyBarChart data={monthlyForUI} />
                  <HorizontalBarChart data={data.byManufacturer.slice(0, 10)} title={t.chart.mfrDist} />
                  <HorizontalBarChart data={data.byManager.slice(0, 10)} title={t.chart.managerDist} />
                </div>
              </div>
            )}

            {view === 'unprocessed' && (
              <UnprocessedTable items={unprocessedForUI} />
            )}

            {view === 'upcoming' && upcomingForUI && (
              <UpcomingCalibration data={upcomingForUI} />
            )}

            {view === 'data-source' && (
              <DataSourceAdmin
                status={{ total: data.summary.total, lastSyncedAt: data.summary.lastSyncedAt }}
                refresh={{
                  running: refreshHook.running,
                  progress: refreshHook.progress,
                  error: refreshHook.error,
                  source: refreshHook.source,
                  onRefresh: () => refreshHook.refresh('manual'),
                }}
              />
            )}

            {view === 'reception' && (
              receptionError ? (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                  {receptionError}
                </div>
              ) : !receptionCache || receptionCache.cachedFor !== currentSync ? (
                <div className="flex items-center justify-center h-96 text-slate-400">접수 데이터 불러오는 중...</div>
              ) : (
                <ReceptionCheck items={receptionCache.data} />
              )
            )}

            {view === 'search' && (
              searchError ? (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                  {searchError}
                </div>
              ) : !searchCache || searchCache.cachedFor !== currentSync ? (
                <div className="flex items-center justify-center h-96 text-slate-400">장비 목록 불러오는 중...</div>
              ) : (
                // useSearchParams가 SSR 분기에서 Suspense 요구 — boundary 명시
                <Suspense fallback={<div className="flex items-center justify-center h-96 text-slate-400">로딩 중...</div>}>
                  <EquipmentSearch
                    items={searchCache.data}
                    onOpenDetail={() => setView('equipment-detail')}
                  />
                </Suspense>
              )
            )}

            {(view === 'profiles' || view === 'report' || view === 'equipment-detail') && (
              <div className="flex items-center justify-center h-96 text-slate-400 bg-white rounded-md border border-slate-200">
                해당 화면은 Phase C2에서 연결 예정입니다.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
