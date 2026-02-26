/**
 * 장비 상세페이지 — ISO 10012 탭 구조
 * 5개 탭: 기본정보 | 교정이력 | 측정분석 | 소급성·환경 | AI 분석
 */
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useT } from '@/lib/i18n'
import type { CertResult } from '@/lib/cert-cache'
import {
  type DetailItem, parseYmd, loadCachedCerts,
  useCertData, computeConformityTrend,
} from './equipment-detail/shared-utils'
import { DdayBadge } from './equipment-detail/shared-components'
import TabIdentity from './equipment-detail/tab-identity'
import TabHistory from './equipment-detail/tab-history'
import TabTraceability from './equipment-detail/tab-traceability'
import CertDetailModal from './equipment-detail/cert-detail-modal'

// 무거운 탭은 lazy loading
const TabMeasurement = dynamic(() => import('./equipment-detail/tab-measurement'), { ssr: false })
const TabAiAnalysis = dynamic(() => import('./equipment-detail/tab-ai-analysis'), { ssr: false })

// ──────────────────────────── 탭 정의 ────────────────────────────

type TabKey = 'identity' | 'history' | 'measurement' | 'traceability' | 'ai'

const TAB_ORDER: TabKey[] = ['identity', 'history', 'measurement', 'traceability', 'ai']

const TAB_ICONS: Record<TabKey, string> = {
  identity:      'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z',
  history:       'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  measurement:   'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  traceability:  'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  ai:            'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
}

// ──────────────────────────── Props ────────────────────────────

interface Props {
  groupNm: string
  equipmentName: string
  onBack: () => void
}

// ──────────────────────────── 메인 ────────────────────────────

export default function EquipmentDetailPage({ groupNm, equipmentName, onBack }: Props) {
  const { t } = useT()

  // 탭 상태
  const [activeTab, setActiveTab] = useState<TabKey>('identity')

  // 공유 데이터 상태
  const [items, setItems] = useState<DetailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(true)
  const [imageError, setImageError] = useState(false)
  const [selectedCert, setSelectedCert] = useState<{ acptNo: string; cert: CertResult } | null>(null)
  // 허용오차 + MPE 분리 상태
  const [tolerance, setTolerance] = useState<{ value: number; unit: string; note: string | null } | null>(null)
  const [mpePercent, setMpePercent] = useState<number | null>(null)

  // 성적서 데이터
  const { certs, setCerts, errors: certErrors, progress: certProgress, certLoading, certDone, fetchCerts } = useCertData(groupNm)

  // items 로드 후 localStorage 캐시 자동 로드
  useEffect(() => {
    if (!items.length || certs.size > 0 || certLoading || certDone) return
    const acptNos = items.filter(i => i.acptNo).map(i => i.acptNo)
    const cached = loadCachedCerts(acptNos)
    if (cached.size > 0) setCerts(cached)
  }, [items, certs.size, certLoading, certDone, setCerts])

  // 상세 데이터 로딩
  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ktools/detail?groupNm=${encodeURIComponent(groupNm)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setItems(json.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : t.detail.queryFail)
    } finally {
      setLoading(false)
    }
  }, [groupNm])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  // 장비 이미지 검색
  useEffect(() => {
    if (!items.length) return
    const info = items[0]
    const q = [info.prdnCmpnNm, info.stszNm].filter(Boolean).join(' ')
    if (!q.trim()) { setImageLoading(false); return }
    setImageLoading(true)
    setImageError(false)
    fetch(`/api/images/search?${new URLSearchParams({ q })}`)
      .then(res => res.json())
      .then(json => {
        if (json.thumbnailUrl || json.imageUrl) {
          setThumbnailUrl(json.thumbnailUrl || null)
          setImageUrl(json.imageUrl || null)
        } else {
          setImageError(true)
        }
      })
      .catch(() => setImageError(true))
      .finally(() => setImageLoading(false))
  }, [items])

  // 장비 사전정보에서 허용오차 + MPE 조회
  useEffect(() => {
    if (!items.length) return
    const info = items[0]
    if (!info.prdnCmpnNm || !info.stszNm) return
    fetch(`/api/profiles?manufacturer=${encodeURIComponent(info.prdnCmpnNm)}&model=${encodeURIComponent(info.stszNm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(profile => {
        if (!profile?.spec) return
        if (profile.spec.tolerance) setTolerance(profile.spec.tolerance)
        if (profile.spec.mpe_percent != null) setMpePercent(profile.spec.mpe_percent)
      })
      .catch(() => {})
  }, [items])

  // ESC로 모달 닫기 또는 뒤로가기
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedCert) setSelectedCert(null)
        else onBack()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onBack, selectedCert])

  const info = items[0]

  // D-day 계산
  const dday = useMemo(() => {
    if (!info?.nxtrExrsYmd || info.nxtrExrsYmd.length < 8) return null
    const target = parseYmd(info.nxtrExrsYmd)!
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
  }, [info])

  // 적합성 트렌드 계산
  const specForTrend = useMemo(() => tolerance || mpePercent != null ? { tolerance, mpePercent } : null, [tolerance, mpePercent])
  const conformityTrend = useMemo(
    () => computeConformityTrend(certs, t, specForTrend),
    [certs, t, specForTrend],
  )

  // 탭 라벨 매핑
  const tabLabels: Record<TabKey, string> = {
    identity: t.detail.tabIdentity,
    history: t.detail.tabHistory,
    measurement: t.detail.tabMeasurement,
    traceability: t.detail.tabTraceability,
    ai: t.detail.tabAi,
  }

  // ──────────────────────────── 로딩 / 에러 ────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          <div className="lg:col-span-2 h-64 bg-gray-100 rounded-xl animate-pulse" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {t.detail.back}
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <button onClick={fetchDetail} className="mt-3 px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
            {t.detail.retry}
          </button>
        </div>
      </div>
    )
  }

  if (!info) return null

  // ──────────────────────────── 렌더링 ────────────────────────────

  return (
    <div className="space-y-0">
      {/* ===== 헤더 (탭 상위 고정) ===== */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={onBack}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-800 truncate">{equipmentName || t.detail.equipmentDetail}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {info.prdNm && <span className="text-slate-600 font-medium">{info.prdNm}</span>}
            {info.prdNm && (info.prdnCmpnNm || info.stszNm) && <span> · </span>}
            {info.prdnCmpnNm}{info.stszNm && ` · ${info.stszNm}`}
          </p>
        </div>
        {dday !== null && <DdayBadge dday={dday} />}
      </div>

      {/* ===== 탭 네비게이션 ===== */}
      <div className="flex gap-1 bg-slate-50 rounded-xl p-1 mb-6 overflow-x-auto">
        {TAB_ORDER.map(tabKey => {
          const isActive = activeTab === tabKey
          const needsCert = ['measurement', 'traceability', 'ai'].includes(tabKey)
          const hasCerts = certs.size > 0
          return (
            <button
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={TAB_ICONS[tabKey]} />
              </svg>
              {tabLabels[tabKey]}
              {certLoading && needsCert && (
                <svg className="w-3 h-3 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {!certLoading && hasCerts && needsCert && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          )
        })}
      </div>

      {/* ===== 탭 콘텐츠 ===== */}
      <div className="min-h-[400px]">
        {activeTab === 'identity' && (
          <TabIdentity
            info={info}
            items={items}
            imageUrl={imageUrl}
            thumbnailUrl={thumbnailUrl}
            imageLoading={imageLoading}
            imageError={imageError}
            setThumbnailUrl={setThumbnailUrl}
            setImageError={setImageError}
            equipmentName={equipmentName}
            tolerance={tolerance}
            mpePercent={mpePercent}
            onSpecChange={(tol, mpe) => { setTolerance(tol); setMpePercent(mpe) }}
          />
        )}

        {activeTab === 'history' && (
          <TabHistory
            items={items}
            certs={certs}
            certErrors={certErrors}
            certProgress={certProgress}
            certLoading={certLoading}
            certDone={certDone}
            fetchCerts={fetchCerts}
            onSelectCert={(acptNo, cert) => setSelectedCert({ acptNo, cert })}
          />
        )}

        {activeTab === 'measurement' && (
          conformityTrend ? (
            <TabMeasurement
              conformityTrend={conformityTrend}
              tolerance={tolerance}
              mpePercent={mpePercent}
              onGoIdentity={() => setActiveTab('identity')}
            />
          ) : (
            <NoCertPlaceholder onGoHistory={() => setActiveTab('history')} />
          )
        )}

        {activeTab === 'traceability' && (
          <TabTraceability
            certs={certs}
            certDone={certDone}
            onGoHistory={() => setActiveTab('history')}
          />
        )}

        {activeTab === 'ai' && (
          conformityTrend ? (
            <TabAiAnalysis
              conformityTrend={conformityTrend}
              info={info}
              equipmentName={equipmentName}
            />
          ) : (
            <NoCertPlaceholder onGoHistory={() => setActiveTab('history')} />
          )
        )}
      </div>

      {/* ===== 성적서 상세 모달 ===== */}
      {selectedCert && (
        <CertDetailModal
          acptNo={selectedCert.acptNo}
          cert={selectedCert.cert}
          onClose={() => setSelectedCert(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────── 보조 컴포넌트 ────────────────────────────

function NoCertPlaceholder({ onGoHistory }: { onGoHistory: () => void }) {
  const { t } = useT()
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
      <svg className="w-12 h-12 text-slate-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-sm text-slate-500 mb-2">{t.detail.traceNoCert}</p>
      <button onClick={onGoHistory}
        className="px-4 py-2 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
      >{t.detail.traceGoHistory}</button>
    </div>
  )
}
