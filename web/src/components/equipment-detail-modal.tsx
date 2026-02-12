'use client'

import { useState, useEffect, useCallback } from 'react'

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

interface Props {
  groupNm: string
  /** 모달 닫기 제목용 장비명 */
  equipmentName: string
  onClose: () => void
}

function fmtDate(d: string): string {
  if (!d || d.length < 8) return '-'
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

function fmtCurrency(n: number): string {
  return n > 0 ? `${n.toLocaleString()}원` : '-'
}

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

  // ESC 키로 닫기
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // 첫 번째 항목에서 장비 기본 정보 추출
  const info = items[0]

  // 이력을 접수일 기준 최신순 정렬
  const sorted = [...items].sort((a, b) => (b.rcpnYmd ?? '').localeCompare(a.rcpnYmd ?? ''))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* 백드롭 */}
      <div className="absolute inset-0 bg-black/50" />

      {/* 모달 */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-800 truncate">{equipmentName || '장비 상세'}</h2>
            {info && (
              <p className="text-sm text-slate-500 mt-0.5">
                {info.prdnCmpnNm} · {info.stszNm || info.mctlNo}
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
              {/* 장비 기본 정보 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <InfoCell label="품목명" value={info.prdNm} />
                <InfoCell label="제조사" value={info.prdnCmpnNm} />
                <InfoCell label="모델" value={info.stszNm} />
                <InfoCell label="기기번호" value={info.mctlNo} />
                <InfoCell label="관리번호" value={info.custEqpmSrno} />
                <InfoCell label="교정주기" value={info.affcCyclCd ? `${info.affcCyclCd}개월` : '-'} />
                <InfoCell label="차기교정" value={fmtDate(info.nxtrExrsYmd)} />
                <InfoCell label="신청업체" value={info.apcnCmnm} />
              </div>

              {/* 교정 이력 */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">
                  교정 이력 <span className="text-slate-400 font-normal ml-1">{sorted.length}건</span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-gray-200 bg-gray-50 text-left">
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600">과제</th>
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600">접수번호</th>
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600">접수일</th>
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600">교정일</th>
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600">상태</th>
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600">결재</th>
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600">담당자</th>
                        <th className="py-2 px-2 text-xs font-bold uppercase text-gray-600 text-right">교정비</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((item, idx) => (
                        <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 px-2 font-mono text-xs text-gray-500">{item.prjcCd}</td>
                          <td className="py-2 px-2 font-mono text-xs text-gray-500">{item.acptNo}</td>
                          <td className="py-2 px-2 text-gray-600">{fmtDate(item.rcpnYmd)}</td>
                          <td className="py-2 px-2 text-gray-600">{fmtDate(item.exrsWrtnYmd)}</td>
                          <td className="py-2 px-2">
                            <StatusBadge status={item.pgstNm} />
                          </td>
                          <td className="py-2 px-2">
                            <ApprovalBadge status={item.gyeoljeStatus} />
                          </td>
                          <td className="py-2 px-2 text-gray-600">{item.mngmRsprNm || '-'}</td>
                          <td className="py-2 px-2 text-right text-gray-600">{fmtCurrency(item.totalSum)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 신청자 정보 */}
              {info.apcnNm && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">신청자 정보</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <InfoCell label="신청자" value={info.apcnNm} />
                    <InfoCell label="연락처" value={info.apcnTlno} />
                    <InfoCell label="이메일" value={info.apcnEmlAdrs} />
                    <InfoCell label="소속" value={info.mngmDvsnNm} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm text-gray-800 font-medium truncate" title={value}>{value || '-'}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color = status.includes('미처리') ? 'bg-amber-100 text-amber-700'
    : status.includes('완료') ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {status || '-'}
    </span>
  )
}

function ApprovalBadge({ status }: { status: string }) {
  const color = status.includes('완료') ? 'text-green-600'
    : status.includes('진행') ? 'text-amber-600'
    : 'text-gray-400'
  return <span className={`text-xs ${color}`}>{status || '-'}</span>
}
