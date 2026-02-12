'use client'

import { useState, useMemo, useCallback, useRef, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  align?: 'left' | 'center' | 'right'
  headerClassName?: string
  minWidth?: number
  sortValue?: (item: T) => string | number | null
  render: (item: T) => ReactNode
}

type SortDirection = 'asc' | 'desc'

interface SortState {
  key: string
  direction: SortDirection
}

const PAGE_SIZES = [10, 30, 50] as const

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (item: T) => string
  defaultSort?: { key: string; direction: SortDirection }
  defaultPageSize?: number
  onRowClick?: (item: T) => void
}

export default function DataTable<T>({ columns, data, rowKey, defaultSort, defaultPageSize = 10, onRowClick }: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  // 컬럼 리사이즈 상태
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  // 리사이즈 핸들 드래그 시작
  const onResizeStart = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault()
    e.stopPropagation()

    // 현재 th의 실제 너비를 초기값으로
    const th = (e.target as HTMLElement).closest('th')
    const startW = colWidths[colKey] || th?.offsetWidth || 100

    resizing.current = { key: colKey, startX: e.clientX, startW }

    const onMove = (ev: MouseEvent) => {
      const r = resizing.current
      if (!r) return
      const diff = ev.clientX - r.startX
      const minW = columns.find(c => c.key === r.key)?.minWidth ?? 50
      const newW = Math.max(minW, r.startW + diff)
      setColWidths(prev => ({ ...prev, [r.key]: newW }))
    }

    const onUp = () => {
      resizing.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [colWidths, columns])

  const handleSort = useCallback((col: Column<T>) => {
    if (!col.sortValue) return
    setSort(prev => {
      if (prev?.key === col.key) {
        return prev.direction === 'asc'
          ? { key: col.key, direction: 'desc' }
          : null
      }
      return { key: col.key, direction: 'asc' }
    })
  }, [])

  const sorted = useMemo(() => {
    if (!sort) return data
    const col = columns.find(c => c.key === sort.key)
    if (!col?.sortValue) return data

    const getValue = col.sortValue
    return [...data].sort((a, b) => {
      const va = getValue(a)
      const vb = getValue(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      if (typeof va === 'number' && typeof vb === 'number') {
        return sort.direction === 'asc' ? va - vb : vb - va
      }
      const sa = String(va)
      const sb = String(vb)
      return sort.direction === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
  }, [data, sort, columns])

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paged = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize)

  // 데이터 변경 시 첫 페이지로
  const dataLen = data.length
  useMemo(() => { setPage(0) }, [dataLen, pageSize])

  const showPagination = sorted.length > PAGE_SIZES[0]

  return (
    <div>
      {/* 상단: 건수 + 페이지 크기 드롭다운 (우측 정렬) */}
      {showPagination && (
        <div className="flex items-center justify-end gap-2 mb-2 text-xs text-gray-500">
          <span>전체 {sorted.length.toLocaleString()}건</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
            className="border border-gray-200 rounded px-2 py-1 text-xs bg-white text-gray-600 cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
          >
            {PAGE_SIZES.map(s => (
              <option key={s} value={s}>{s}건씩</option>
            ))}
          </select>
        </div>
      )}

      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full text-xs" style={{ tableLayout: Object.keys(colWidths).length > 0 ? 'fixed' : 'auto' }}>
          {/* colgroup: 리사이즈된 컬럼에 너비 적용 */}
          {Object.keys(colWidths).length > 0 && (
            <colgroup>
              {columns.map(col => (
                <col key={col.key} style={colWidths[col.key] ? { width: colWidths[col.key] } : undefined} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr className="border-b-2 border-gray-200 bg-gray-50 text-left">
              {columns.map((col, i) => {
                const sortable = !!col.sortValue
                const isActive = sort?.key === col.key
                return (
                  <th
                    key={col.key}
                    onClick={sortable ? () => handleSort(col) : undefined}
                    className={`relative py-2.5 px-2 whitespace-nowrap text-xs font-bold uppercase tracking-wide ${
                      i < columns.length - 1 ? 'pr-3' : ''
                    } ${
                      col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''
                    } ${
                      isActive ? 'text-gray-900' : 'text-gray-600'
                    } ${
                      sortable ? 'cursor-pointer select-none hover:text-gray-900 hover:bg-gray-100 transition-colors' : ''
                    } ${col.headerClassName ?? ''}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {col.header}
                      {sortable && (
                        <span className="inline-flex flex-col -space-y-1">
                          <svg className={`w-3 h-3 ${isActive && sort.direction === 'asc' ? 'text-slate-800' : 'text-gray-300'}`} viewBox="0 0 12 12" fill="currentColor">
                            <path d="M6 2L10 7H2L6 2Z" />
                          </svg>
                          <svg className={`w-3 h-3 ${isActive && sort.direction === 'desc' ? 'text-slate-800' : 'text-gray-300'}`} viewBox="0 0 12 12" fill="currentColor">
                            <path d="M6 10L2 5H10L6 10Z" />
                          </svg>
                        </span>
                      )}
                    </span>
                    {/* 리사이즈 핸들 (마지막 컬럼 제외) */}
                    {i < columns.length - 1 && (
                      <span
                        onMouseDown={e => onResizeStart(e, col.key)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/40 active:bg-blue-500/50 z-10"
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {paged.map(item => (
              <tr
                key={rowKey(item)}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={`border-b border-gray-50 hover:bg-gray-50${onRowClick ? ' cursor-pointer' : ''}`}
              >
                {columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={`py-2 px-2 whitespace-nowrap overflow-hidden text-ellipsis ${
                      i < columns.length - 1 ? 'pr-3' : ''
                    } ${
                      col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 하단: 페이지네이션 (중앙 정렬) */}
      {showPagination && (
        <div className="flex justify-center mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={safePage === 0}
              className="px-2.5 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {'«'}
            </button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-2.5 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {'‹'}
            </button>

            {(() => {
              const pages: number[] = []
              const start = Math.max(0, safePage - 2)
              const end = Math.min(totalPages - 1, safePage + 2)
              for (let i = start; i <= end; i++) pages.push(i)
              return pages.map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`min-w-[32px] px-2 py-1.5 text-sm rounded transition-colors ${
                    p === safePage
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {p + 1}
                </button>
              ))
            })()}

            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-2.5 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {'›'}
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={safePage >= totalPages - 1}
              className="px-2.5 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {'»'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
