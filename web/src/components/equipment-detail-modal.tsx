'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import DataTable, { type Column, fmtDate } from './data-table'

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
  onClose: () => void
}


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

export default function EquipmentDetailModal({ groupNm, equipmentName, onClose }: Props) {
  const [items, setItems] = useState<DetailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const info = items[0]

  const tableData: TableRow[] = useMemo(() =>
    [...items]
      .sort((a, b) => (b.rcpnYmd ?? '').localeCompare(a.rcpnYmd ?? ''))
      .map((item, idx) => ({ ...item, no: idx + 1 })),
    [items]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-5xl w-full mx-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-800 truncate">{equipmentName || '장비 상세'}</h2>
            {info && (
              <p className="text-sm text-slate-500 mt-0.5">
                {info.prdNm && <span className="text-slate-600 font-medium">{info.prdNm}</span>}
                {info.prdNm && (info.prdnCmpnNm || info.stszNm) && <span> · </span>}
                {info.prdnCmpnNm}{info.stszNm && ` · ${info.stszNm}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-red-600 mb-2">{error}</p>
              <button onClick={fetchDetail} className="text-sm text-blue-600 hover:underline">재시도</button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="text-center py-12 text-gray-400">상세 이력이 없습니다</div>
          )}

          {!loading && !error && info && (
            <div className="space-y-5">
              {/* 장비 기본 정보 — 2단 카드 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 장비 식별 */}
                <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">장비 정보</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <InfoRow label="제조사" value={info.prdnCmpnNm} />
                    <InfoRow label="모델" value={info.stszNm} />
                    <InfoRow label="기기번호" value={info.mctlNo} />
                    <InfoRow label="관리번호" value={info.custEqpmSrno} />
                  </div>
                </div>

                {/* 교정 관리 */}
                <div className="bg-blue-50/50 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">교정 관리</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <InfoRow label="교정주기" value={info.affcCyclCd ? `${info.affcCyclCd}개월` : '-'} />
                    <InfoRow label="차기교정" value={fmtDate(info.nxtrExrsYmd)} />
                    <InfoRow label="교정 이력" value={`${items.length}건`} />
                    <DdayBadge nxtrExrsYmd={info.nxtrExrsYmd} />
                  </div>
                </div>
              </div>

              {/* 교정 이력 테이블 (DataTable 공통 컴포넌트) */}
              <DataTable
                columns={historyColumns}
                data={tableData}
                rowKey={i => `${i.acptNo}-${i.no}`}
                defaultSort={{ key: 'no', direction: 'asc' }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-gray-400 whitespace-nowrap min-w-[52px]">{label}</span>
      <span className="text-sm text-gray-800 font-medium truncate" title={value}>{value || '-'}</span>
    </div>
  )
}

function DdayBadge({ nxtrExrsYmd }: { nxtrExrsYmd: string }) {
  if (!nxtrExrsYmd || nxtrExrsYmd.length < 8) return <div />

  const target = new Date(
    Number(nxtrExrsYmd.slice(0, 4)),
    Number(nxtrExrsYmd.slice(4, 6)) - 1,
    Number(nxtrExrsYmd.slice(6, 8)),
  )
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((target.getTime() - today.getTime()) / 86_400_000)

  let label: string
  let color: string

  if (diff < 0) {
    const abs = Math.abs(diff)
    if (abs >= 365) {
      const y = Math.floor(abs / 365)
      const m = Math.floor((abs % 365) / 30)
      label = m > 0 ? `${y}년 ${m}개월 초과` : `${y}년 초과`
    } else if (abs >= 30) {
      label = `${Math.floor(abs / 30)}개월 초과`
    } else {
      label = `${abs}일 초과`
    }
    color = 'text-red-600 bg-red-50'
  } else if (diff === 0) {
    label = '오늘 만료'
    color = 'text-red-600 bg-red-50'
  } else if (diff <= 30) {
    label = `D-${diff}`
    color = 'text-orange-600 bg-orange-50'
  } else if (diff <= 60) {
    label = `D-${diff}`
    color = 'text-amber-600 bg-amber-50'
  } else if (diff <= 90) {
    label = `D-${diff}`
    color = 'text-blue-600 bg-blue-50'
  } else {
    label = `D-${diff}`
    color = 'text-green-600 bg-green-50'
  }

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-gray-400 whitespace-nowrap min-w-[52px]">만료까지</span>
      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
        {label}
      </span>
    </div>
  )
}
