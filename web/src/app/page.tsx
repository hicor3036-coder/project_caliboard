'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar, { type ViewType } from '@/components/sidebar'
import SummaryCards from '@/components/summary-cards'
import UnprocessedTable from '@/components/unprocessed-table'
import UpcomingCalibration from '@/components/upcoming-calibration'
import { StatusPieChart, MonthlyBarChart, HorizontalBarChart } from '@/components/charts'
import EquipmentSearch from '@/components/equipment-search'

interface EquipmentItem {
  acptNo: string; entpPrdNm: string; prdnCmpnNm: string;
  stszNm: string; mctlNo: string; custEqpmSrno: string;
  rcpnYmd: string; pgstNm: string; mngmRsprNm: string;
  nxtrExrsYmd: string; exrsWrtnYmd: string
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
    mctlNo: string; custEqpmSrno: string; mngmRsprNm: string; fnshScdlYmd: string
  }>
  차기교정임박: {
    평균소요일: number; 여유일: number;
    장기경과: number; 만료: number; d30: number; d60: number; d90: number;
    items: Array<{
      acptNo: string; entpPrdNm: string; prdnCmpnNm: string;
      stszNm: string; mctlNo: string; custEqpmSrno: string;
      nxtrExrsYmd: string; dDay: number; 접수권장일: string;
      접수시급: boolean; 구간: string
    }>
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

export default function Dashboard() {
  const router = useRouter()
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [activeView, setActiveView] = useState<ViewType>('home')

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
      setError(e instanceof Error ? e.message : '데이터 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [router])

  // SSE 스트리밍 수집 (프로그레스바 표시)
  const fetchWithProgress = useCallback(async () => {
    setLoading(true)
    setError(null)
    setProgress({ stage: 'login', current: 0, total: 0, message: '연결 중...' })

    try {
      const res = await fetch('/api/ktools/stream')
      if (res.status === 401) { router.push('/login'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('스트림 읽기 실패')

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
      setError(e instanceof Error ? e.message : '데이터 수집 실패')
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  // 캐시 존재 여부만 빠르게 확인
  useEffect(() => {
    async function checkCache() {
      try {
        const res = await fetch('/api/ktools/status')
        if (res.status === 401) { router.push('/login'); return }
        const json = await res.json()
        if (json.cached) {
          fetchCached()
        }
      } catch { /* 무시 */ }
      setInitialized(true)
    }
    checkCache()
  }, [router, fetchCached])

  // 뷰별 콘텐츠 렌더링
  function renderContent() {
    // 초기 화면: 데이터 수집 전
    if (initialized && !data && !loading && !error) {
      return (
        <div className="flex flex-col items-center justify-center py-32">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center max-w-md">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">데이터 수집</h2>
            <p className="text-slate-500 text-sm mb-6">
              k-tools에서 교정 장비 데이터를 수집합니다.<br />
              약 9,000건 수집에 수 초 소요됩니다.
            </p>
            <button
              onClick={() => fetchWithProgress()}
              className="px-6 py-3 bg-slate-700 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors"
            >
              수집 시작
            </button>
          </div>
        </div>
      )
    }

    // 로딩 (최초 수집)
    if (loading && !data) {
      return (
        <div className="flex flex-col items-center justify-center py-32">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center max-w-md w-full">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-700 rounded-full animate-spin mx-auto mb-5" />
            <p className="text-slate-700 font-medium mb-1">
              {progress?.message ?? 'k-tools에서 데이터 수집 중...'}
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
              <p className="text-xs text-slate-400 mt-2">잠시만 기다려주세요</p>
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
            재시도
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
            <SummaryCards
              {...data.summary}
              cacheRemaining={data.cache?.remainingMs}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StatusPieChart data={data.진행상태분포} />
              <MonthlyBarChart data={data.월별접수추이} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <HorizontalBarChart data={data.제조사별분포} title="제조사별 분포 (Top 10)" />
              <HorizontalBarChart data={data.담당자별처리량} title="담당자별 처리량" />
            </div>
          </div>
        )
      case 'unprocessed':
        return <UnprocessedTable items={data.미처리현황} />
      case 'upcoming':
        return <UpcomingCalibration data={data.차기교정임박} />
      case 'search':
        return <EquipmentSearch items={data.전체장비} />
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* 사이드바 */}
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onRefresh={fetchWithProgress}
        onLogout={handleLogout}
        loading={loading}
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
              <p className="text-xs text-slate-400 mt-2">잠시만 기다려주세요</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
