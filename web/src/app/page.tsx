'use client'

// 대시보드 메인 페이지 (Phase C)
// ─ 9개 supabase READ atom을 useEffect로 병렬 호출
// ─ atom 응답(snake_case) → 컴포넌트 친화 형태로 매핑은 lib/supabase-fetch.ts 책임
// ─ ktools 수집 SSE는 useKtoolsRefresh 훅이 단일 소스 — sidebar/data-source-admin이 같은 상태 공유
// ─ 자동 트리거: 로그인/홈 진입 시 12h 초과면 1회 자동 수집 (옵션 B: 단일 브라우저 in-flight 가드)
// ─ 활성 뷰: home / unprocessed / upcoming / reception / search / equipment-detail / data-source
//   미연결: profiles / report (후속 작업)
// ─ reception/search: 전체 row 필요 → 뷰 진입 시 lazy fetch (캐시)
// ─ equipment-detail: search 행 클릭 → detailContext 채워지면 EquipmentDetailPage 렌더

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar, { type ViewType } from '@/components/sidebar'
import SummaryCards from '@/components/summary-cards'
import UnprocessedTable from '@/components/unprocessed-table'
import UpcomingCalibration from '@/components/upcoming-calibration'
import ReceptionCheck from '@/components/reception-check'
import EquipmentSearch from '@/components/equipment-search'
import EquipmentDetailPage, { type SeedInfo } from '@/components/equipment-detail-page'
import EquipmentProfiles from '@/components/equipment-profiles'
import { StatusPieChart, MonthlyBarChart, HorizontalBarChart } from '@/components/charts'
import DataSourceAdmin from '@/components/data-source-admin'
import { useT } from '@/lib/i18n'
import { STALE_THRESHOLD_MS } from '@/lib/freshness'
import { useKtoolsRefresh } from '@/lib/use-ktools-refresh'
import {
  fetchDashboardData,
  fetchSummaryOnly,
  fetchRestOfDashboard,
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

// ── 대시보드 sessionStorage 캐시 (탭/창 닫으면 사라짐, F5 후엔 유지)
// ─ value 키 cachedFor는 summary.lastSyncedAt 스냅샷
const DASHBOARD_CACHE_KEY = 'caliboard:dashboard:v1'
function readDashboardCache(): { data: DashboardData } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(DASHBOARD_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}
function writeDashboardCache(data: DashboardData) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ data }))
  } catch { /* quota 초과 등 무시 */ }
}

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

  // ── 장비 상세 진입 컨텍스트 (search/unprocessed 등에서 행 클릭 시 채워짐)
  // ─ origin: 뒤로가기 시 복귀할 뷰
  // ─ seedInfo: 진입 시점에 이미 알고 있는 행 데이터 — k-tools 응답 전에 헤더/장비카드를 즉시 채우는 용도
  const [detailContext, setDetailContext] = useState<{
    groupNm: string
    equipmentName: string
    origin: ViewType
    seedInfo: SeedInfo | null
  } | null>(null)

  // ── 데이터 조회
  // sessionStorage 캐시 정책:
  //   1) 캐시 있으면 즉시 화면 표시 (loading 풀림)
  //   2) summary 1개만 호출해 신선도 검사
  //   3) lastSyncedAt 같으면 끝, 다르면 나머지 8개 atom 페치 + 화면 갱신
  // ktools 새로고침 직후엔 force=true로 캐시 무시 (어차피 lastSyncedAt 달라짐)
  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    setError(null)
    const force = opts?.force === true

    // 1) sessionStorage 캐시 즉시 표시
    const cached = !force ? readDashboardCache() : null
    if (cached) {
      setData(cached.data)
      setLoading(false)
    } else {
      setLoading(true)
    }

    try {
      // 2) summary 신선도 검사 (force면 곧장 9개 페치)
      if (!force && cached) {
        const summary = await fetchSummaryOnly()
        if (summary.lastSyncedAt === cached.data.summary.lastSyncedAt) {
          return  // 캐시 신선
        }
        // stale — 나머지 8개 페치 후 통합
        const fresh = await fetchRestOfDashboard(summary)
        setData(fresh)
        writeDashboardCache(fresh)
        return
      }

      // 3) 캐시 없음 또는 force — 9개 전부
      const fresh = await fetchDashboardData()
      setData(fresh)
      writeDashboardCache(fresh)
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
  // 수집 완료 후엔 force=true — summary 검사 없이 9개 즉시 페치
  const refreshHook = useKtoolsRefresh({
    onRefreshed: () => loadData({ force: true }),
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

  // ── search/profiles 뷰 진입 시 페치 (동일 패턴 — profiles 컴포넌트도 search 13컬럼 사용)
  useEffect(() => {
    if (view !== 'search' && view !== 'profiles') return
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
              <UnprocessedTable
                items={unprocessedForUI}
                onOpenDetail={(groupNm, equipmentName) => {
                  const row = unprocessedForUI.find(r => r.groupNm === groupNm)
                  const seedInfo: SeedInfo | null = row ? {
                    prdnCmpnNm: row.prdnCmpnNm,
                    stszNm: row.stszNm,
                    mctlNo: row.mctlNo,
                    custEqpmSrno: row.custEqpmSrno,
                    entpPrdNm: row.entpPrdNm,
                    mngmRsprNm: row.mngmRsprNm,
                    nxtrExrsYmd: '',
                    exrsWrtnYmd: '',
                    groupCnt: row.groupCnt,
                  } : null
                  setDetailContext({ groupNm, equipmentName, origin: 'unprocessed', seedInfo })
                  setView('equipment-detail')
                }}
              />
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
                    onOpenDetail={(groupNm, equipmentName) => {
                      const row = searchCache.data.find(r => r.groupNm === groupNm)
                      const seedInfo: SeedInfo | null = row ? {
                        prdnCmpnNm: row.prdnCmpnNm,
                        stszNm: row.stszNm,
                        mctlNo: row.mctlNo,
                        custEqpmSrno: row.custEqpmSrno,
                        entpPrdNm: row.entpPrdNm,
                        mngmRsprNm: row.mngmRsprNm,
                        nxtrExrsYmd: row.nxtrExrsYmd,
                        exrsWrtnYmd: row.exrsWrtnYmd,
                        groupCnt: row.groupCnt,
                      } : null
                      setDetailContext({ groupNm, equipmentName, origin: 'search', seedInfo })
                      setView('equipment-detail')
                    }}
                  />
                </Suspense>
              )
            )}

            {view === 'equipment-detail' && (
              detailContext ? (
                <EquipmentDetailPage
                  groupNm={detailContext.groupNm}
                  equipmentName={detailContext.equipmentName}
                  seedInfo={detailContext.seedInfo}
                  onBack={() => {
                    const origin = detailContext.origin
                    setDetailContext(null)
                    setView(origin)
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-96 text-slate-400 bg-white rounded-md border border-slate-200">
                  장비를 선택하려면 &ldquo;장비 검색&rdquo;에서 행을 클릭하세요.
                </div>
              )
            )}

            {view === 'profiles' && (
              searchError ? (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                  {searchError}
                </div>
              ) : !searchCache || searchCache.cachedFor !== currentSync ? (
                <div className="flex items-center justify-center h-96 text-slate-400">장비 목록 불러오는 중...</div>
              ) : (
                <EquipmentProfiles equipmentItems={searchCache.data} />
              )
            )}

            {view === 'report' && (
              <div className="flex items-center justify-center h-96 text-slate-400 bg-white rounded-md border border-slate-200">
                해당 화면은 후속 작업에서 연결 예정입니다.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
