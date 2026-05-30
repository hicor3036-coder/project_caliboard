'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar, { type ViewType } from '@/components/sidebar'
import SummaryCards from '@/components/summary-cards'
import UnprocessedTable from '@/components/unprocessed-table'
import UpcomingCalibration from '@/components/upcoming-calibration'
import { StatusPieChart, MonthlyBarChart, HorizontalBarChart } from '@/components/charts'
import EquipmentSearch from '@/components/equipment-search'
import EquipmentDetailPage from '@/components/equipment-detail-page'
import EquipmentProfiles from '@/components/equipment-profiles'
import ManagementReport from '@/components/management-report'
import ReceptionCheck from '@/components/reception-check'
import DataSourceAdmin from '@/components/data-source-admin'
import { useT, fmt } from '@/lib/i18n'

interface EquipmentItem {
  acptNo: string; entpPrdNm: string; prdnCmpnNm: string;
  stszNm: string; mctlNo: string; custEqpmSrno: string;
  rcpnYmd: string; pgstNm: string; mngmRsprNm: string;
  nxtrExrsYmd: string; exrsWrtnYmd: string; groupNm: string; groupCnt: number
}

interface AnalysisData {
  summary: {
    총건수: number
    미처리건수: number
    교정임박건수: number
    평균소요일: number
    데이터시점: string
  }
  전체장비: EquipmentItem[]
  미처리현황: Array<{
    acptNo: string; rcpnYmd: string; 체류일수: number;
    예상완료일: string | null; 남은일수: number | null;
    entpPrdNm: string; prdnCmpnNm: string; stszNm: string;
    mctlNo: string; custEqpmSrno: string; mngmRsprNm: string; fnshScdlYmd: string; groupNm: string; groupCnt: number
  }>
  차기교정임박: {
    평균소요일: number; 여유일: number;
    장기경과: number; 만료: number; d30: number; d60: number; d90: number;
    items: Array<{
      acptNo: string; entpPrdNm: string; prdnCmpnNm: string;
      stszNm: string; mctlNo: string; custEqpmSrno: string;
      nxtrExrsYmd: string; dDay: number; 접수권장일: string;
      접수시급: boolean; 구간: string; groupNm: string; groupCnt: number
    }>
    제조사별: { label: string; value: number }[]
    시급건수: number
  }
  진행상태분포: { label: string; value: number }[]
  월별접수추이: { month: string; 건수: number }[]
  제조사별분포: { label: string; value: number }[]
  담당자별처리량: { label: string; value: number }[]
  cache?: { cached: boolean; remainingMs?: number }
}

interface Progress {
  stage: string
  current: number
  total: number
  message: string
}

// URL ↔ 상태 동기화 헬퍼
const VALID_VIEWS: ViewType[] = ['home', 'search', 'unprocessed', 'upcoming', 'profiles', 'report', 'reception', 'data-source']

function viewFromParams(params: URLSearchParams): { view: ViewType; equipment: { groupNm: string; equipmentName: string } | null } {
  const v = params.get('view')
  if (v === 'equipment-detail') {
    const groupNm = params.get('groupNm')
    const name = params.get('name') ?? ''
    if (groupNm) return { view: 'equipment-detail', equipment: { groupNm, equipmentName: name } }
  }
  if (v && VALID_VIEWS.includes(v as ViewType)) return { view: v as ViewType, equipment: null }
  return { view: 'home', equipment: null }
}

function buildUrl(view: ViewType, equipment?: { groupNm: string; equipmentName: string } | null): string {
  const params = new URLSearchParams()
  if (view !== 'home') params.set('view', view)
  if (view === 'equipment-detail' && equipment) {
    params.set('groupNm', equipment.groupNm)
    if (equipment.equipmentName) params.set('name', equipment.equipmentName)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : '/'
}

export default function Page() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  )
}

function Dashboard() {
  const { t, lang } = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [previousView, setPreviousView] = useState<ViewType>('home')

  // URL에서 현재 뷰/장비 파싱
  const { view: activeView, equipment: selectedEquipment } = viewFromParams(searchParams)

  // 뷰 변경 → URL 업데이트
  const setActiveView = useCallback((view: ViewType) => {
    router.push(buildUrl(view), { scroll: false })
  }, [router])

  const openEquipmentDetail = useCallback((groupNm: string, equipmentName: string) => {
    setPreviousView(activeView !== 'equipment-detail' ? activeView : previousView)
    router.push(buildUrl('equipment-detail', { groupNm, equipmentName }), { scroll: false })
  }, [activeView, previousView, router])

  // 캐시된 데이터 로드 (프로그레스바 불필요)
  const fetchCached = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ktools')
      if (res.status === 401) { router.push('/login'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.collect.loadFail)
    } finally {
      setLoading(false)
    }
  }, [router])

  // SSE 스트리밍 수집 (프로그레스바 표시)
  const fetchWithProgress = useCallback(async () => {
    setLoading(true)
    setError(null)
    setProgress({ stage: 'login', current: 0, total: 0, message: t.collect.connecting })

    try {
      const res = await fetch('/api/ktools/stream')
      if (res.status === 401) { router.push('/login'); return }
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
              setData(payload)
              setProgress(null)
            } else if (eventType === 'error') {
              throw new Error(payload.message)
            }
            eventType = ''
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t.collect.collectFail)
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }, [router])

  async function handleLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* 무시 */ }
    // 페이지를 통째로 교체하여 잔여 화면 깜빡임 방지
    window.location.replace('/login')
  }

  // 로그인 직후 자동 진입 흐름:
  // ① 캐시 신선 → 즉시 대시보드 표시 (fetchCached)
  // ② 캐시 없거나 만료 → 진행률 바와 함께 자동 수집 (fetchWithProgress)
  // ─ React Strict Mode에서 useEffect가 2번 실행되어도 부트스트랩은 단 1회만 수행
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/ktools/status')
        if (res.status === 401) { router.push('/login'); return }
        const json = await res.json()
        if (json.cached && !json.expired) {
          await fetchCached()
        } else {
          await fetchWithProgress()
        }
      } catch { /* 무시 */ }
      setInitialized(true)
    })()
  }, [router, fetchCached, fetchWithProgress])

  // 뷰별 콘텐츠 렌더링
  function renderContent() {
    // 데이터 소스 관리: k-tools 데이터 없이도 접근 가능 (캐시 자체를 관리하는 화면)
    if (activeView === 'data-source') {
      return (
        <DataSourceAdmin
          onCacheChanged={() => {
            // 캐시가 새로고침/초기화되면 대시보드 데이터도 갱신
            void fetchCached()
          }}
        />
      )
    }

    // 장비사전정보: k-tools 데이터 없이도 접근 가능
    if (activeView === 'profiles') {
      return <EquipmentProfiles equipmentItems={data?.전체장비 ?? null} />
    }

    // 장비 상세: k-tools 데이터 없이도 직접 URL 접근 가능
    if (activeView === 'equipment-detail' && selectedEquipment) {
      return (
        <EquipmentDetailPage
          groupNm={selectedEquipment.groupNm}
          equipmentName={selectedEquipment.equipmentName}
          onBack={() => router.back()}
        />
      )
    }

    // 로딩 (최초 수집 또는 초기화 전)
    if (!initialized || (loading && !data)) {
      return (
        <div className="flex flex-col items-center justify-center py-32">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center max-w-md w-full">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-700 rounded-full animate-spin mx-auto mb-5" />
            <p className="text-slate-700 font-medium mb-1">
              {progress?.message ?? t.collect.loading}
            </p>
            {progress?.stage === 'fetch' && progress.total > 0 ? (
              <>
                <div className="w-full bg-slate-100 rounded-full h-2.5 mt-4 overflow-hidden">
                  <div
                    className="bg-slate-700 h-2.5 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min((progress.current / progress.total) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {Math.round((progress.current / progress.total) * 100)}%
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-400 mt-2">{t.collect.wait}</p>
            )}
          </div>
        </div>
      )
    }

    // 에러
    if (error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <button
            onClick={() => fetchWithProgress()}
            className="mt-3 px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
          >
            {t.collect.retry}
          </button>
        </div>
      )
    }

    // 데이터 있을 때 뷰별 렌더링
    if (!data) return null

    switch (activeView) {
      case 'home':
        return (
          <div className="space-y-6">
            {/* 히어로 헤더 */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{t.dashboard.title}</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {fmt(t.dashboard.equipStatus, data.summary.총건수.toLocaleString())}
                </p>
              </div>
              <div className="text-right text-xs text-slate-400">
                <p>{t.dashboard.lastSync}</p>
                <p className="font-medium text-slate-500">
                  {new Date(data.summary.데이터시점).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            <SummaryCards
              {...data.summary}
              cacheRemaining={data.cache?.remainingMs}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StatusPieChart data={data.진행상태분포} />
              <MonthlyBarChart data={data.월별접수추이} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <HorizontalBarChart data={data.제조사별분포} title={t.chart.mfrDist} />
              <HorizontalBarChart data={data.담당자별처리량} title={t.chart.managerDist} />
            </div>
          </div>
        )
      case 'unprocessed':
        return <UnprocessedTable items={data.미처리현황} onOpenDetail={openEquipmentDetail} />
      case 'upcoming':
        return <UpcomingCalibration data={data.차기교정임박} onOpenDetail={openEquipmentDetail} />
      case 'search':
        return <EquipmentSearch items={data.전체장비} onOpenDetail={openEquipmentDetail} />
      case 'report':
        return <ManagementReport analysisData={data} onOpenDetail={openEquipmentDetail} />
      case 'reception':
        return <ReceptionCheck items={data.전체장비} />
      case 'equipment-detail':
        // 상단에서 이미 처리됨 (data 없이도 접근 가능)
        return null
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* 사이드바 */}
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onLogout={handleLogout}
        미처리건수={data?.summary.미처리건수}
        교정임박건수={data?.summary.교정임박건수}
      />

      {/* 메인 콘텐츠 */}
      <main className="flex-1 min-w-0 p-6 overflow-auto">
        {renderContent()}
      </main>

      {/* 새로고침 오버레이 */}
      {loading && data && progress && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center max-w-sm w-full mx-4">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-700 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-700 font-medium mb-1">
              {progress.message}
            </p>
            {progress.stage === 'fetch' && progress.total > 0 ? (
              <>
                <div className="w-full bg-slate-100 rounded-full h-2.5 mt-3 overflow-hidden">
                  <div
                    className="bg-slate-700 h-2.5 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min((progress.current / progress.total) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {Math.round((progress.current / progress.total) * 100)}%
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-400 mt-2">{t.collect.wait}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
