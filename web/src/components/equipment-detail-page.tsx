'use client'

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import DataTable, { type Column, fmtDate } from './data-table'

// === 타입 ===

interface DetailItem {
  prjcCd: string
  acptNo: string
  rcpnYmd: string
  exrsWrtnYmd: string
  fnshScdlYmd: string
  snctYmd: string
  isncYmd: string
  smplOutDate: string
  pgstNm: string
  gyeoljeStatus: string
  mngmRsprNm: string
  mngmDvsnNm: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  prdNm: string
  mctlNo: string
  custEqpmSrno: string
  affcCyclCd: string
  nxtrExrsYmd: string
  totalFee: number
  totalVat: number
  totalSum: number
  apcnCmnm: string
  apcnNm: string
  apcnTlno: string
  apcnEmlAdrs: string
}

interface TableRow extends DetailItem {
  no: number
}

interface Props {
  groupNm: string
  equipmentName: string
  onBack: () => void
}

// === 유틸 ===

function parseYmd(ymd: string): Date | null {
  if (!ymd || ymd.length < 8) return null
  return new Date(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
  )
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil(Math.abs(b.getTime() - a.getTime()) / 86_400_000)
}

// === 테이블 컬럼 ===

const historyColumns: Column<TableRow>[] = [
  {
    key: 'no', header: 'No', align: 'center',
    sortValue: i => i.no,
    render: i => <span className="text-gray-400">{i.no}</span>,
  },
  {
    key: 'prjcCd', header: '과제',
    sortValue: i => i.prjcCd,
    render: i => <span className="font-mono text-gray-500">{i.prjcCd}</span>,
  },
  {
    key: 'acptNo', header: '접수번호',
    sortValue: i => i.acptNo,
    render: i => <span className="font-mono text-gray-500">{i.acptNo}</span>,
  },
  {
    key: 'rcpnYmd', header: '접수일',
    sortValue: i => i.rcpnYmd,
    render: i => <span className="text-gray-600">{fmtDate(i.rcpnYmd)}</span>,
  },
  {
    key: 'exrsWrtnYmd', header: '교정완료일',
    sortValue: i => i.exrsWrtnYmd,
    render: i => <span className="text-gray-600">{fmtDate(i.exrsWrtnYmd)}</span>,
  },
  {
    key: 'nxtrExrsYmd', header: '차기교정일',
    sortValue: i => i.nxtrExrsYmd,
    render: i => <span className="text-gray-600">{fmtDate(i.nxtrExrsYmd)}</span>,
  },
  {
    key: 'totalSum', header: '비용',
    sortValue: i => i.totalSum,
    render: i => <span className="text-gray-600">{i.totalSum ? `${i.totalSum.toLocaleString()}원` : '-'}</span>,
  },
  {
    key: 'pgstNm', header: '상태',
    sortValue: i => i.pgstNm,
    render: i => {
      const s = i.pgstNm
      const color = s.includes('미처리') ? 'bg-amber-100 text-amber-700'
        : s.includes('완료') ? 'bg-green-100 text-green-700'
        : 'bg-gray-100 text-gray-600'
      return <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${color}`}>{s || '-'}</span>
    },
  },
  {
    key: 'mngmRsprNm', header: '교정담당자',
    sortValue: i => i.mngmRsprNm,
    render: i => <span className="text-gray-600">{i.mngmRsprNm || '-'}</span>,
  },
]

// === 커스텀 툴팁 ===

/* eslint-disable @typescript-eslint/no-explicit-any */
function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-slate-700">
      <p className="text-slate-300 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium">
          {p.name}: <span className="text-blue-300">
            {p.dataKey === '비용' ? `${Number(p.value).toLocaleString()}원` : `${p.value}일`}
          </span>
        </p>
      ))}
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// === 메인 컴포넌트 ===

export default function EquipmentDetailPage({ groupNm, equipmentName, onBack }: Props) {
  const [items, setItems] = useState<DetailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)      // 원본
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null) // 썸네일 (빠른 로딩)
  const [imageLoading, setImageLoading] = useState(true)
  const [imageError, setImageError] = useState(false)

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
      setError(e instanceof Error ? e.message : '조회 실패')
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

    const params = new URLSearchParams({ q })

    setImageLoading(true)
    setImageError(false)
    fetch(`/api/images/search?${params}`)
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

  // ESC로 뒤로가기
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onBack])

  const info = items[0]

  const tableData: TableRow[] = useMemo(() =>
    [...items]
      .sort((a, b) => (b.rcpnYmd ?? '').localeCompare(a.rcpnYmd ?? ''))
      .map((item, idx) => ({ ...item, no: idx + 1 })),
    [items]
  )

  // 타임라인 데이터 (접수일 기준 오름차순)
  const timelineData = useMemo(() =>
    [...items]
      .filter(item => item.rcpnYmd)
      .sort((a, b) => a.rcpnYmd.localeCompare(b.rcpnYmd))
      .map(item => {
        const rcpn = parseYmd(item.rcpnYmd)
        const exrs = parseYmd(item.exrsWrtnYmd)
        return {
          rcpnYmd: item.rcpnYmd,
          exrsWrtnYmd: item.exrsWrtnYmd,
          prjcCd: item.prjcCd,
          pgstNm: item.pgstNm,
          소요일: rcpn && exrs ? daysBetween(rcpn, exrs) : null,
          acptNo: item.acptNo,
        }
      }),
    [items]
  )

  // 트렌드 차트 데이터
  const trendData = useMemo(() =>
    [...items]
      .filter(item => item.rcpnYmd && item.exrsWrtnYmd)
      .sort((a, b) => a.rcpnYmd.localeCompare(b.rcpnYmd))
      .map(item => {
        const rcpn = parseYmd(item.rcpnYmd)!
        const exrs = parseYmd(item.exrsWrtnYmd)!
        return {
          교정일: fmtDate(item.rcpnYmd),
          소요일: daysBetween(rcpn, exrs),
          비용: item.totalSum || 0,
        }
      }),
    [items]
  )

  // D-day 계산
  const dday = useMemo(() => {
    if (!info?.nxtrExrsYmd || info.nxtrExrsYmd.length < 8) return null
    const target = parseYmd(info.nxtrExrsYmd)!
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
  }, [info])

  // 로딩 스켈레톤
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

  // 에러
  if (error) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          뒤로
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <button onClick={fetchDetail} className="mt-3 px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
            재시도
          </button>
        </div>
      </div>
    )
  }

  if (!info) return null

  return (
    <div className="space-y-6">
      {/* ===== 헤더 ===== */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-800 truncate">{equipmentName || '장비 상세'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {info.prdNm && <span className="text-slate-600 font-medium">{info.prdNm}</span>}
            {info.prdNm && (info.prdnCmpnNm || info.stszNm) && <span> · </span>}
            {info.prdnCmpnNm}{info.stszNm && ` · ${info.stszNm}`}
          </p>
        </div>
        {dday !== null && <DdayBadge dday={dday} />}
      </div>

      {/* ===== 장비 프로필 (이미지 + 정보) ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 이미지 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center justify-center min-h-[240px]">
          {imageLoading ? (
            <div className="w-full h-full bg-gray-50 rounded-lg animate-pulse flex items-center justify-center min-h-[200px]">
              <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          ) : (thumbnailUrl || imageUrl) && !imageError ? (
            <img
              src={thumbnailUrl || imageUrl!}
              alt={equipmentName}
              className="max-w-full max-h-[240px] object-contain rounded-lg"
              onError={() => {
                // 썸네일 실패 시 원본 시도, 원본도 실패 시 에러
                if (thumbnailUrl && imageUrl) {
                  setThumbnailUrl(null)
                } else {
                  setImageError(true)
                }
              }}
            />
          ) : (
            <div className="w-full min-h-[200px] bg-gray-50 rounded-lg flex flex-col items-center justify-center text-gray-400">
              <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="text-xs">장비 이미지 없음</span>
            </div>
          )}
        </div>

        {/* 장비 정보 카드 */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 장비 식별 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <SectionHeader
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />}
              title="장비 정보"
              color="text-slate-400"
            />
            <div className="space-y-2.5">
              <InfoRow label="제조사" value={info.prdnCmpnNm} />
              <InfoRow label="모델" value={info.stszNm} />
              <InfoRow label="기기번호" value={info.mctlNo} />
              <InfoRow label="관리번호" value={info.custEqpmSrno} />
              <InfoRow label="제품명" value={info.prdNm} />
            </div>
          </div>

          {/* 교정 관리 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <SectionHeader
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
              title="교정 관리"
              color="text-blue-400"
            />
            <div className="space-y-2.5">
              <InfoRow label="교정주기" value={info.affcCyclCd ? `${info.affcCyclCd}개월` : '-'} />
              <InfoRow label="차기교정" value={fmtDate(info.nxtrExrsYmd)} />
              <InfoRow label="최근교정" value={fmtDate(info.exrsWrtnYmd)} />
              <InfoRow label="교정이력" value={`${items.length}건`} />
              <InfoRow label="담당자" value={info.mngmRsprNm} />
            </div>
          </div>
        </div>
      </div>

      {/* ===== AI 건강 요약 (placeholder) ===== */}
      <AiPlaceholder
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />}
        title="장비 상태 요약"
        description="AI가 이 장비의 교정 이력, 경년 변화, 교정 주기를 종합 분석하여 건강 상태를 한 줄로 요약합니다."
      />

      {/* ===== 교정 이력 타임라인 ===== */}
      {timelineData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-5">교정 이력 타임라인</h3>
          <div className="overflow-x-auto">
            <div className="flex items-start gap-0 min-w-max px-4 pb-2">
              {timelineData.map((item, idx) => {
                const isLast = idx === timelineData.length - 1
                const statusColor = item.pgstNm.includes('완료') ? 'bg-green-500' :
                  item.pgstNm.includes('미처리') ? 'bg-amber-500' : 'bg-blue-500'

                // 이전 교정 완료일과의 간격 계산
                let gapDays: number | null = null
                if (!isLast) {
                  const curEnd = parseYmd(item.exrsWrtnYmd)
                  const nextStart = parseYmd(timelineData[idx + 1].rcpnYmd)
                  if (curEnd && nextStart) {
                    gapDays = daysBetween(curEnd, nextStart)
                  }
                }

                return (
                  <div key={item.acptNo} className="flex items-start">
                    {/* 노드 */}
                    <div className="flex flex-col items-center min-w-[120px] group relative">
                      <div className={`w-3.5 h-3.5 rounded-full ${statusColor} ring-4 ring-white shadow-sm z-10`} />
                      <div className="mt-2 text-center">
                        <p className="text-xs font-medium text-slate-700">{fmtDate(item.rcpnYmd)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{item.prjcCd}</p>
                        {item.소요일 !== null && (
                          <p className="text-[10px] text-blue-500 mt-0.5">소요 {item.소요일}일</p>
                        )}
                        <span className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          item.pgstNm.includes('완료') ? 'bg-green-50 text-green-600' :
                          item.pgstNm.includes('미처리') ? 'bg-amber-50 text-amber-600' :
                          'bg-gray-50 text-gray-500'
                        }`}>{item.pgstNm}</span>
                      </div>
                    </div>
                    {/* 연결선 + 간격 표시 */}
                    {!isLast && (
                      <div className="flex flex-col items-center mt-[6px]">
                        <div className="w-20 h-0.5 bg-gray-200" />
                        {gapDays !== null && (
                          <span className="text-[10px] text-slate-400 mt-1 whitespace-nowrap">
                            {gapDays}일
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== 트렌드 분석 차트 ===== */}
      {trendData.length >= 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">트렌드 분석</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={trendData} margin={{ left: 10, right: 10 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="교정일"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                label={{ value: '소요일', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}만`}
                label={{ value: '비용', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#94a3b8' } }}
              />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar yAxisId="left" dataKey="소요일" name="소요일" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
              <Line yAxisId="right" dataKey="비용" name="비용" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-6 mt-2">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-3 h-3 rounded-sm bg-blue-500" />
              교정 소요일
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-3 h-1 rounded bg-amber-500" />
              비용 추이
            </div>
          </div>
        </div>
      )}

      {/* ===== 2열: 교정주기 예측 + 적합성 분석 ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 교정주기 예측 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <SectionHeader
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />}
              title="교정주기 예측"
              color="text-indigo-400"
            />
            <span className="px-2 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-500 rounded-full">AI 준비 중</span>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">현재 교정주기</span>
              <span className="text-lg font-bold text-slate-800">
                {info.affcCyclCd ? `${info.affcCyclCd}개월` : '-'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-indigo-50/50 rounded-lg border border-dashed border-indigo-200">
              <span className="text-sm text-indigo-600">AI 추천 주기</span>
              <span className="text-lg font-bold text-indigo-400">- -</span>
            </div>
            <p className="text-xs text-slate-400">
              교정 이력과 경년 데이터를 기반으로 최적 교정주기를 AI가 권고합니다.
            </p>
          </div>
        </div>

        {/* 적합성 분석 (placeholder) */}
        <AiPlaceholder
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />}
          title="적합성 분석"
          description="장비 매뉴얼을 AI가 분석하여 교정 기준 대비 적합성을 판단하고, 특이사항을 안내합니다."
        />
      </div>

      {/* ===== 특이사항/알림 (placeholder) ===== */}
      <AiPlaceholder
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />}
        title="특이사항 / 알림"
        description="매뉴얼 기반 주의사항, 이상 징후, 교정 시 특기 사항을 AI가 자동으로 정리하여 안내합니다."
      />

      {/* ===== 교정 이력 상세 테이블 ===== */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">교정 이력 상세</h3>
        {tableData.length === 0 ? (
          <div className="text-center py-12 text-gray-400">상세 이력이 없습니다</div>
        ) : (
          <DataTable
            columns={historyColumns}
            data={tableData}
            rowKey={i => `${i.acptNo}-${i.no}`}
            defaultSort={{ key: 'no', direction: 'asc' }}
          />
        )}
      </div>
    </div>
  )
}

// === 하위 컴포넌트 ===

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-gray-400 whitespace-nowrap min-w-[56px]">{label}</span>
      <span className="text-sm text-gray-800 font-medium truncate" title={value}>{value || '-'}</span>
    </div>
  )
}

function SectionHeader({ icon, title, color }: { icon: ReactNode; title: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icon}
      </svg>
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
    </div>
  )
}

function DdayBadge({ dday }: { dday: number }) {
  let label: string
  let color: string

  if (dday < 0) {
    const abs = Math.abs(dday)
    if (abs >= 365) {
      const y = Math.floor(abs / 365)
      const m = Math.floor((abs % 365) / 30)
      label = m > 0 ? `${y}년 ${m}개월 초과` : `${y}년 초과`
    } else if (abs >= 30) {
      label = `${Math.floor(abs / 30)}개월 초과`
    } else {
      label = `${abs}일 초과`
    }
    color = 'text-red-600 bg-red-50 border-red-200'
  } else if (dday === 0) {
    label = '오늘 만료'
    color = 'text-red-600 bg-red-50 border-red-200'
  } else if (dday <= 30) {
    label = `D-${dday}`
    color = 'text-orange-600 bg-orange-50 border-orange-200'
  } else if (dday <= 60) {
    label = `D-${dday}`
    color = 'text-amber-600 bg-amber-50 border-amber-200'
  } else if (dday <= 90) {
    label = `D-${dday}`
    color = 'text-blue-600 bg-blue-50 border-blue-200'
  } else {
    label = `D-${dday}`
    color = 'text-green-600 bg-green-50 border-green-200'
  }

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-bold border ${color}`}>
      {label}
    </span>
  )
}

function AiPlaceholder({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="ml-auto px-2 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-500 rounded-full">
          AI 준비 중
        </span>
      </div>
      <div className="bg-slate-50 rounded-lg p-4 border border-dashed border-slate-200">
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}
