'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import DataTable, { type Column } from './data-table'
import { useT } from '@/lib/i18n'

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
  groupNm: string
  groupCnt: number
}

// === 검색 대상 필드 (통합 텍스트 검색) ===

const SEARCH_FIELDS: (keyof EquipmentItem)[] = [
  'acptNo', 'entpPrdNm', 'prdnCmpnNm', 'stszNm',
  'mctlNo', 'custEqpmSrno', 'mngmRsprNm',
]

// === 테이블 컬럼 정의 ===

function useColumns() {
  const { t } = useT()
  return useMemo<Column<EquipmentItem>[]>(() => [
    {
      key: 'acptNo', header: t.table.acptNo,
      sortValue: i => i.acptNo,
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
      key: 'entpPrdNm', header: t.table.entpPrdNm,
      sortValue: i => i.entpPrdNm,
      render: i => (
        <span className="text-gray-800 font-medium max-w-[200px] truncate block" title={i.entpPrdNm}>
          {i.entpPrdNm || '-'}
        </span>
      ),
    },
    {
      key: 'prdnCmpnNm', header: t.table.prdnCmpnNm,
      sortValue: i => i.prdnCmpnNm,
      render: i => <span className="text-gray-600">{i.prdnCmpnNm || '-'}</span>,
    },
    {
      key: 'stszNm', header: t.table.stszNm,
      sortValue: i => i.stszNm,
      render: i => (
        <span className="text-gray-600 max-w-[120px] truncate block" title={i.stszNm}>
          {i.stszNm || '-'}
        </span>
      ),
    },
    {
      key: 'mctlNo', header: t.table.mctlNo,
      sortValue: i => i.mctlNo,
      render: i => <span className="font-mono text-xs text-gray-500">{i.mctlNo || '-'}</span>,
    },
    {
      key: 'custEqpmSrno', header: t.table.custEqpmSrno,
      sortValue: i => i.custEqpmSrno,
      render: i => <span className="font-mono text-xs text-gray-500">{i.custEqpmSrno || '-'}</span>,
    },
    {
      key: 'rcpnYmd', header: t.table.rcpnYmd,
      sortValue: i => i.rcpnYmd,
      render: i => <span className="text-gray-600">{i.rcpnYmd || '-'}</span>,
    },
    {
      key: 'pgstNm', header: t.table.pgstNm,
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
      key: 'mngmRsprNm', header: t.table.mngmRsprNm,
      sortValue: i => i.mngmRsprNm,
      render: i => <span className="text-gray-600">{i.mngmRsprNm || '-'}</span>,
    },
    {
      key: 'nxtrExrsYmd', header: t.table.nxtrExrsYmd,
      sortValue: i => i.nxtrExrsYmd,
      render: i => <span className="text-gray-600">{i.nxtrExrsYmd || '-'}</span>,
    },
  ], [t])
}

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
      <option value="">{label}</option>
      {options.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  )
}

// === 메인 컴포넌트 (부모에서 items를 props로 전달받음) ===

export default function EquipmentSearch({ items, onOpenDetail, searchParams }: { items: EquipmentItem[]; onOpenDetail: (groupNm: string, equipmentName: string) => void; searchParams: URLSearchParams }) {
  const { t } = useT()
  const columns = useColumns()
  const router = useRouter()

  // URL 파라미터에서 필터 상태 읽기 (드롭다운은 URL 직접 연동)
  const query = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? ''
  const manufacturer = searchParams.get('mfr') ?? ''
  const manager = searchParams.get('mgr') ?? ''
  const urlPage = parseInt(searchParams.get('page') ?? '0', 10) || 0
  const urlPageSize = parseInt(searchParams.get('size') ?? '30', 10) || 30

  // 텍스트 검색은 로컬 state → Enter/버튼 클릭 시에만 URL 반영
  const [inputValue, setInputValue] = useState(query)

  // URL 파라미터 업데이트 헬퍼 (여러 키를 한 번에 업데이트 가능)
  const updateFilter = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    }
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  const submitQuery = useCallback(() => {
    updateFilter({ q: inputValue.trim(), page: '' })
  }, [updateFilter, inputValue])

  const setStatus = useCallback((v: string) => updateFilter({ status: v, page: '' }), [updateFilter])
  const setManufacturer = useCallback((v: string) => updateFilter({ mfr: v, page: '' }), [updateFilter])
  const setManager = useCallback((v: string) => updateFilter({ mgr: v, page: '' }), [updateFilter])

  // 페이지네이션 URL 업데이트 콜백
  const handlePageChange = useCallback((p: number) => {
    updateFilter({ page: p > 0 ? String(p) : '' })
  }, [updateFilter])

  const handlePageSizeChange = useCallback((s: number) => {
    updateFilter({ size: s !== 30 ? String(s) : '', page: '' })
  }, [updateFilter])

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
    setInputValue('')
    router.replace('?view=search', { scroll: false })
  }, [router])

  // 클라이언트 사이드 필터링 (텍스트 + 드롭다운 AND 조합)
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return items.filter(item => {
      if (q && !SEARCH_FIELDS.some(f => String(item[f]).toLowerCase().includes(q))) return false
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
          {t.search.title} <span className="text-slate-500 text-base font-normal ml-2">{items.length.toLocaleString()}{t.common.unit}</span>
        </h2>
      </div>

      {/* 검색 + 필터 영역 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        {/* 검색바 — Enter 키 또는 검색 버튼으로 실행 */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitQuery() }}
              placeholder={t.search.placeholder}
              className="w-full pl-10 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 placeholder:text-gray-400"
            />
            {inputValue && (
              <button
                onClick={() => { setInputValue(''); updateFilter({ q: '', page: '' }) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={submitQuery}
            className="px-4 py-2.5 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors shrink-0"
          >
            {t.search.search}
          </button>
        </div>

        {/* 필터 드롭다운 + 초기화 */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect label={t.search.statusAll} value={status} options={filterOptions.진행상태} onChange={setStatus} />
          <FilterSelect label={t.search.mfrAll} value={manufacturer} options={filterOptions.제조사} onChange={setManufacturer} />
          <FilterSelect label={t.search.managerAll} value={manager} options={filterOptions.담당자} onChange={setManager} />

          {hasActiveFilter && (
            <button
              onClick={resetFilters}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {t.search.reset}
            </button>
          )}

          {hasActiveFilter && (
            <span className="ml-auto text-xs text-gray-400">
              {t.search.result} <span className="font-medium text-gray-600">{filtered.length.toLocaleString()}</span>{t.common.unit}
            </span>
          )}
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {hasActiveFilter ? t.search.noResult : t.search.noData}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            rowKey={i => i.acptNo}
            defaultSort={{ key: 'rcpnYmd', direction: 'desc' }}
            defaultPageSize={30}
            controlledPage={urlPage}
            controlledPageSize={urlPageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            onRowClick={item => { if (item.groupNm) onOpenDetail(item.groupNm, item.entpPrdNm) }}
          />
        )}
      </div>

    </div>
  )
}
