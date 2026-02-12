'use client'

import { useState, useMemo, useCallback } from 'react'
import DataTable, { type Column } from './data-table'

// === 타입 ===

interface EquipmentItem {
  acptNo: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  rcpnYmd: string
  pgstNm: string
  mngmRsprNm: string
  nxtrExrsYmd: string
  exrsWrtnYmd: string
}

// === 검색 대상 필드 (통합 텍스트 검색) ===

const SEARCH_FIELDS: (keyof EquipmentItem)[] = [
  'acptNo', 'entpPrdNm', 'prdnCmpnNm', 'stszNm',
  'mctlNo', 'custEqpmSrno', 'mngmRsprNm',
]

// === 테이블 컬럼 정의 ===

const columns: Column<EquipmentItem>[] = [
  {
    key: 'acptNo', header: '접수번호',
    sortValue: i => i.acptNo,
    render: i => <span className="font-mono text-xs text-gray-500">{i.acptNo}</span>,
  },
  {
    key: 'entpPrdNm', header: '업체품명',
    sortValue: i => i.entpPrdNm,
    render: i => (
      <span className="text-gray-800 font-medium max-w-[200px] truncate block" title={i.entpPrdNm}>
        {i.entpPrdNm || '-'}
      </span>
    ),
  },
  {
    key: 'prdnCmpnNm', header: '제조사',
    sortValue: i => i.prdnCmpnNm,
    render: i => <span className="text-gray-600">{i.prdnCmpnNm || '-'}</span>,
  },
  {
    key: 'stszNm', header: '모델',
    sortValue: i => i.stszNm,
    render: i => (
      <span className="text-gray-600 max-w-[120px] truncate block" title={i.stszNm}>
        {i.stszNm || '-'}
      </span>
    ),
  },
  {
    key: 'mctlNo', header: '기기번호',
    sortValue: i => i.mctlNo,
    render: i => <span className="font-mono text-xs text-gray-500">{i.mctlNo || '-'}</span>,
  },
  {
    key: 'custEqpmSrno', header: '관리번호',
    sortValue: i => i.custEqpmSrno,
    render: i => <span className="font-mono text-xs text-gray-500">{i.custEqpmSrno || '-'}</span>,
  },
  {
    key: 'rcpnYmd', header: '접수일',
    sortValue: i => i.rcpnYmd,
    render: i => <span className="text-gray-600">{i.rcpnYmd || '-'}</span>,
  },
  {
    key: 'pgstNm', header: '진행상태',
    sortValue: i => i.pgstNm,
    render: i => {
      const s = i.pgstNm
      const color = s.includes('미처리') ? 'bg-amber-100 text-amber-700'
        : s.includes('완료') ? 'bg-green-100 text-green-700'
        : 'bg-gray-100 text-gray-600'
      return (
        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
          {s || '-'}
        </span>
      )
    },
  },
  {
    key: 'mngmRsprNm', header: '담당자',
    sortValue: i => i.mngmRsprNm,
    render: i => <span className="text-gray-600">{i.mngmRsprNm || '-'}</span>,
  },
  {
    key: 'nxtrExrsYmd', header: '차기교정',
    sortValue: i => i.nxtrExrsYmd,
    render: i => <span className="text-gray-600">{i.nxtrExrsYmd || '-'}</span>,
  },
]

// === 필터 드롭다운 컴포넌트 ===

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[140px]"
    >
      <option value="">{label} 전체</option>
      {options.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  )
}

// === 메인 컴포넌트 (부모에서 items를 props로 전달받음) ===

export default function EquipmentSearch({ items }: { items: EquipmentItem[] }) {
  // 필터 상태
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [manager, setManager] = useState('')

  // 필터 드롭다운 옵션 — items에서 고유값 추출
  const filterOptions = useMemo(() => {
    const statusSet = new Set<string>()
    const manufacturerSet = new Set<string>()
    const managerSet = new Set<string>()
    for (const item of items) {
      if (item.pgstNm) statusSet.add(item.pgstNm)
      if (item.prdnCmpnNm) manufacturerSet.add(item.prdnCmpnNm)
      if (item.mngmRsprNm) managerSet.add(item.mngmRsprNm)
    }
    return {
      진행상태: Array.from(statusSet).sort(),
      제조사: Array.from(manufacturerSet).sort(),
      담당자: Array.from(managerSet).sort(),
    }
  }, [items])

  const resetFilters = useCallback(() => {
    setQuery('')
    setStatus('')
    setManufacturer('')
    setManager('')
  }, [])

  // 클라이언트 사이드 필터링 (텍스트 + 드롭다운 AND 조합)
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return items.filter(item => {
      if (q && !SEARCH_FIELDS.some(f => item[f].toLowerCase().includes(q))) return false
      if (status && item.pgstNm !== status) return false
      if (manufacturer && item.prdnCmpnNm !== manufacturer) return false
      if (manager && item.mngmRsprNm !== manager) return false
      return true
    })
  }, [items, query, status, manufacturer, manager])

  const hasActiveFilter = query || status || manufacturer || manager

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          전체 장비 <span className="text-slate-500 text-base font-normal ml-2">{items.length.toLocaleString()}건</span>
        </h2>
      </div>

      {/* 검색 + 필터 영역 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        {/* 검색바 */}
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="접수번호, 품명, 제조사, 모델, 기기번호, 관리번호, 담당자 검색"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 placeholder:text-gray-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 필터 드롭다운 + 초기화 */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect label="진행상태" value={status} options={filterOptions.진행상태} onChange={setStatus} />
          <FilterSelect label="제조사" value={manufacturer} options={filterOptions.제조사} onChange={setManufacturer} />
          <FilterSelect label="담당자" value={manager} options={filterOptions.담당자} onChange={setManager} />

          {hasActiveFilter && (
            <button
              onClick={resetFilters}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              초기화
            </button>
          )}

          {hasActiveFilter && (
            <span className="ml-auto text-xs text-gray-400">
              검색 결과 <span className="font-medium text-gray-600">{filtered.length.toLocaleString()}</span>건
            </span>
          )}
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {hasActiveFilter ? '검색 결과가 없습니다' : '장비 데이터가 없습니다'}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            rowKey={i => i.acptNo}
            defaultSort={{ key: 'rcpnYmd', direction: 'desc' }}
            defaultPageSize={30}
          />
        )}
      </div>
    </div>
  )
}
