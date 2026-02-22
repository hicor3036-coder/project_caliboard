'use client'

import { useState, useMemo } from 'react'
import DataTable, { type Column } from './data-table'

interface UpcomingItem {
  acptNo: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  nxtrExrsYmd: string
  dDay: number
  접수권장일: string
  접수시급: boolean
  구간: string
  groupNm: string
  groupCnt: number
}

interface UpcomingData {
  평균소요일: number
  여유일: number
  장기경과: number
  만료: number
  d30: number
  d60: number
  d90: number
  items: UpcomingItem[]
}

function formatDDay(d: number): string {
  if (d >= 0) return `D-${d}`
  const abs = Math.abs(d)
  if (abs >= 365) {
    const y = Math.floor(abs / 365)
    const m = Math.floor((abs % 365) / 30)
    return m > 0 ? `${y}년 ${m}개월 초과` : `${y}년 초과`
  }
  if (abs >= 30) return `${Math.floor(abs / 30)}개월 초과`
  return `${abs}일 초과`
}

const columns: Column<UpcomingItem>[] = [
  {
    key: 'acptNo', header: '접수번호', sortValue: i => i.acptNo,
    render: i => (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-gray-500">
        {i.acptNo}
        {i.groupCnt > 1 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 bg-blue-50 rounded px-1 py-px font-sans font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            {i.groupCnt}
          </span>
        )}
      </span>
    ),
  },
  {
    key: '상태', header: '상태', align: 'center',
    sortValue: i => i.접수시급 ? 0 : i.구간 === '장기경과' ? 2 : 1,
    render: i => i.구간 === '장기경과'
      ? <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">장기</span>
      : i.접수시급
      ? <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">시급</span>
      : <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">예정</span>,
  },
  { key: 'entpPrdNm', header: '업체품명', sortValue: i => i.entpPrdNm, render: i => <span className="text-gray-800 font-medium max-w-[200px] truncate block" title={i.entpPrdNm}>{i.entpPrdNm}</span> },
  { key: 'prdnCmpnNm', header: '제조사', sortValue: i => i.prdnCmpnNm, render: i => <span className="text-gray-600">{i.prdnCmpnNm}</span> },
  { key: 'stszNm', header: '모델', sortValue: i => i.stszNm, render: i => <span className="text-gray-600 max-w-[120px] truncate block" title={i.stszNm}>{i.stszNm || '-'}</span> },
  { key: 'mctlNo', header: '기기번호', sortValue: i => i.mctlNo, render: i => <span className="font-mono text-xs text-gray-500">{i.mctlNo || '-'}</span> },
  { key: 'custEqpmSrno', header: '관리번호', sortValue: i => i.custEqpmSrno, render: i => <span className="font-mono text-xs text-gray-500">{i.custEqpmSrno || '-'}</span> },
  { key: 'nxtrExrsYmd', header: '교정만료', sortValue: i => i.nxtrExrsYmd, render: i => <span className="text-gray-600">{i.nxtrExrsYmd}</span> },
  {
    key: 'dDay', header: '경과', sortValue: i => i.dDay,
    render: i => (
      <span className={`text-xs font-medium ${
        i.dDay < -1095 ? 'text-slate-400' :
        i.dDay < 0 ? 'text-red-600' :
        i.dDay <= 30 ? 'text-orange-600' :
        'text-gray-600'
      }`}>
        {formatDDay(i.dDay)}
      </span>
    ),
  },
  { key: '접수권장일', header: '접수권장', sortValue: i => i.접수권장일, render: i => <span className="text-gray-600">{i.접수권장일}</span> },
]

export default function UpcomingCalibration({ data, onOpenDetail }: { data: UpcomingData; onOpenDetail?: (groupNm: string, equipmentName: string) => void }) {
  const [filter, setFilter] = useState<string>('전체')

  const activeCount = data.만료 + data.d30 + data.d60 + data.d90

  const badges = [
    { label: '전체', count: activeCount, color: 'bg-gray-100 text-gray-700' },
    { label: '만료', count: data.만료, color: 'bg-red-100 text-red-700' },
    { label: 'D-30', count: data.d30, color: 'bg-orange-100 text-orange-700' },
    { label: 'D-60', count: data.d60, color: 'bg-amber-100 text-amber-700' },
    { label: 'D-90', count: data.d90, color: 'bg-yellow-100 text-yellow-700' },
    { label: '장기경과', count: data.장기경과, color: 'bg-slate-100 text-slate-500' },
  ]

  const filtered = useMemo(() => {
    if (filter === '전체') return data.items.filter(i => i.구간 !== '장기경과')
    return data.items.filter(i => i.구간 === filter)
  }, [data.items, filter])

  const display = filtered

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold">차기교정 임박</h2>
        <p className="text-xs text-gray-400 mt-1">
          평균 소요 {data.평균소요일}일 + 여유 {data.여유일}일 기준
        </p>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {badges.map(b => {
          if (b.label === '장기경과' && b.count === 0) return null
          return (
            <button
              key={b.label}
              onClick={() => setFilter(b.label)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                filter === b.label ? b.color + ' ring-2 ring-offset-1 ring-gray-300' : 'bg-gray-50 text-gray-400'
              }`}
            >
              {b.label} {b.count.toLocaleString()}
            </button>
          )
        })}
      </div>

      {filter === '장기경과' && (
        <div className="mb-4 px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500">
          3년 이상 교정만료가 경과된 장비입니다. 폐기 또는 교정 비대상일 수 있습니다.
        </div>
      )}

      <DataTable columns={columns} data={display} rowKey={i => i.acptNo} onRowClick={item => { if (item.groupNm && onOpenDetail) onOpenDetail(item.groupNm, item.entpPrdNm) }} />
    </div>
  )
}
