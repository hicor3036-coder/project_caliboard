'use client'

// 대시보드 메인 페이지 (Phase C)
// ─ 9개 supabase READ atom을 useEffect로 병렬 호출
// ─ atom 응답(snake_case) → 컴포넌트 친화 형태로 매핑은 lib/supabase-fetch.ts 책임
// ─ 새로고침: data-source 뷰 안의 DataSourceAdmin 컴포넌트가 task SSE 호출
// ─ 활성 뷰: home / unprocessed / upcoming / data-source
//   미연결: search / profiles / report / reception / equipment-detail (Phase C2)

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar, { type ViewType } from '@/components/sidebar'
import SummaryCards from '@/components/summary-cards'
import UnprocessedTable from '@/components/unprocessed-table'
import UpcomingCalibration from '@/components/upcoming-calibration'
import { StatusPieChart, MonthlyBarChart, HorizontalBarChart } from '@/components/charts'
import DataSourceAdmin from '@/components/data-source-admin'
import { useT } from '@/lib/i18n'
import {
  fetchDashboardData,
  mapUnprocessed,
  mapUpcoming,
  mapMonthlyForUI,
  type DashboardData,
} from '@/lib/supabase-fetch'

export default function Home() {
  const router = useRouter()
  const { t } = useT()

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewType>('home')

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
                onRefreshed={loadData}
                onSessionExpired={() => router.replace('/login')}
              />
            )}

            {(view === 'search' || view === 'profiles' || view === 'report' || view === 'reception' || view === 'equipment-detail') && (
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
