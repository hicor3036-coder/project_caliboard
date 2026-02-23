'use client'

import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList } from 'recharts'
import DataTable, { type Column } from './data-table'
import { useT, fmt } from '@/lib/i18n'

interface UnprocessedItem {
  acptNo: string
  rcpnYmd: string
  체류일수: number
  예상완료일: string | null
  남은일수: number | null
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  mngmRsprNm: string
  fnshScdlYmd: string
  groupNm: string
  groupCnt: number
}

function useColumns() {
  const { t } = useT()
  const dUnit = t.unprocessed.daysUnit
  return useMemo<Column<UnprocessedItem>[]>(() => [
    {
      key: 'acptNo', header: t.table.acptNo, sortValue: i => i.acptNo,
      render: i => (
        <span className="inline-flex items-center gap-1.5 font-mono text-gray-500">
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
    { key: 'entpPrdNm', header: t.table.entpPrdNm, sortValue: i => i.entpPrdNm, render: i => <span className="text-gray-800 font-medium max-w-[200px] truncate block" title={i.entpPrdNm}>{i.entpPrdNm}</span> },
    { key: 'prdnCmpnNm', header: t.table.prdnCmpnNm, sortValue: i => i.prdnCmpnNm, render: i => <span className="text-gray-600">{i.prdnCmpnNm}</span> },
    { key: 'stszNm', header: t.table.stszNm, sortValue: i => i.stszNm, render: i => <span className="text-gray-600 max-w-[120px] truncate block" title={i.stszNm}>{i.stszNm || '-'}</span> },
    { key: 'mctlNo', header: t.table.mctlNo, sortValue: i => i.mctlNo, render: i => <span className="font-mono text-gray-500">{i.mctlNo || '-'}</span> },
    { key: 'custEqpmSrno', header: t.table.custEqpmSrno, sortValue: i => i.custEqpmSrno, render: i => <span className="font-mono text-gray-500">{i.custEqpmSrno || '-'}</span> },
    { key: 'rcpnYmd', header: t.table.rcpnYmd, sortValue: i => i.rcpnYmd, render: i => <span className="text-gray-600">{i.rcpnYmd}</span> },
    {
      key: '체류일수', header: t.table.stayDays, align: 'center', sortValue: i => i.체류일수,
      render: i => (
        <span className={`inline-block min-w-[40px] px-1.5 py-0.5 rounded font-medium ${
          i.체류일수 >= 100 ? 'bg-slate-200 text-slate-600' :
          i.체류일수 > 30 ? 'bg-red-100 text-red-700' :
          i.체류일수 > 14 ? 'bg-amber-100 text-amber-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {i.체류일수}{dUnit}
        </span>
      ),
    },
    { key: '예상완료일', header: t.table.estComplete, sortValue: i => i.예상완료일, render: i => <span className="text-gray-600">{i.예상완료일 ?? '-'}</span> },
    {
      key: '남은일수', header: t.table.remaining, align: 'center', sortValue: i => i.남은일수,
      render: i => i.남은일수 !== null ? (
        <span className={`font-medium ${i.남은일수 < 0 ? 'text-red-600' : 'text-gray-600'}`}>
          {i.남은일수 < 0 ? fmt(t.unprocessed.daysOver, Math.abs(i.남은일수)) : `${i.남은일수}${dUnit}`}
        </span>
      ) : <span className="text-gray-400">-</span>,
    },
    { key: 'mngmRsprNm', header: t.table.manager, sortValue: i => i.mngmRsprNm, render: i => <span className="text-gray-600">{i.mngmRsprNm}</span> },
  ], [t, dUnit])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MiniTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-slate-700">
      {label && <p className="text-slate-300 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium">
          {p.name ?? p.dataKey}: <span className="text-blue-300">{Number(p.value).toLocaleString()}{unit}</span>
        </p>
      ))}
    </div>
  )
}

type DaysFilter = 'before' | 'after' | null

export default function UnprocessedTable({ items, onOpenDetail }: { items: UnprocessedItem[]; onOpenDetail?: (groupNm: string, equipmentName: string) => void }) {
  const { t } = useT()
  const columns = useColumns()
  const unit = t.common.unit
  const [excludeLongTerm, setExcludeLongTerm] = useState(true)
  const [chartsOpen, setChartsOpen] = useState(false)
  const [selectedManager, setSelectedManager] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(null)
  const [selectedBin, setSelectedBin] = useState<string | null>(null)

  // 완료예정일 기준 필터
  const matchDaysFilter = (item: UnprocessedItem, filter: DaysFilter) => {
    switch (filter) {
      case 'before': return item.남은일수 === null || item.남은일수 >= 0
      case 'after': return item.남은일수 !== null && item.남은일수 < 0
      default: return true
    }
  }

  // 1. 기본 필터 (장기 미처리 토글만)
  const baseItems = useMemo(() =>
    excludeLongTerm ? items.filter(i => i.체류일수 < 100) : items
  , [items, excludeLongTerm])

  const 장기건수 = useMemo(() => items.filter(i => i.체류일수 >= 100).length, [items])

  // 2. 요약 통계 (장기 미처리 토글만 반영)
  const stats = useMemo(() => {
    if (baseItems.length === 0) return { 평균: 0, before: 0, after: 0 }
    const sum = baseItems.reduce((s, i) => s + i.체류일수, 0)
    const after = baseItems.filter(i => i.남은일수 !== null && i.남은일수 < 0).length
    return {
      평균: Math.round((sum / baseItems.length) * 10) / 10,
      before: baseItems.length - after,
      after,
    }
  }, [baseItems])

  // 3. 체류분포 bin 정의 (장기 토글 기준)
  const 체류bins = useMemo(() => {
    const maxDays = Math.max(...baseItems.map(i => i.체류일수), 0)
    const bu = t.unprocessed.binUpTo
    const br = t.unprocessed.binRange
    const bo = t.unprocessed.binOver
    return maxDays >= 100
      ? [
          { label: fmt(bu, 30), min: 0, max: 30 },
          { label: fmt(br, 30, 60), min: 31, max: 60 },
          { label: fmt(br, 60, 100), min: 61, max: 100 },
          { label: fmt(br, 100, 200), min: 101, max: 200 },
          { label: fmt(bo, 200), min: 201, max: Infinity },
        ]
      : [
          { label: fmt(bu, 7), min: 0, max: 7 },
          { label: fmt(br, 7, 14), min: 8, max: 14 },
          { label: fmt(br, 14, 30), min: 15, max: 30 },
          { label: fmt(br, 30, 60), min: 31, max: 60 },
          { label: fmt(br, 60, 100), min: 61, max: 99 },
        ]
  }, [baseItems, t])

  // bin 매칭 함수
  const matchBin = (체류일수: number, binLabel: string) => {
    const bin = 체류bins.find(b => b.label === binLabel)
    return bin ? 체류일수 >= bin.min && 체류일수 <= bin.max : false
  }

  // 4. 전체 필터링 (장기 토글 + 담당자 + daysFilter + selectedBin)
  const filtered = useMemo(() => {
    let result = baseItems
    if (selectedManager) result = result.filter(i => (i.mngmRsprNm || '(없음)') === selectedManager)
    if (daysFilter) result = result.filter(i => matchDaysFilter(i, daysFilter))
    if (selectedBin) result = result.filter(i => matchBin(i.체류일수, selectedBin))
    return result
  }, [baseItems, selectedManager, daysFilter, selectedBin, 체류bins])

  // 5. 체류분포 차트 (selectedBin 제외, 나머지 필터 적용)
  const 체류분포 = useMemo(() => {
    let base = baseItems
    if (selectedManager) base = base.filter(i => (i.mngmRsprNm || '(없음)') === selectedManager)
    if (daysFilter) base = base.filter(i => matchDaysFilter(i, daysFilter))

    const maxDays = Math.max(...baseItems.map(i => i.체류일수), 0)
    const counts = 체류bins.map(b => ({
      ...b,
      count: base.filter(i => i.체류일수 >= b.min && i.체류일수 <= b.max).length,
    }))
    return counts.map((b, i) => {
      const colors = maxDays >= 100
        ? ['#22c55e', '#eab308', '#f97316', '#ef4444', '#991b1b']
        : ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444']
      return { name: b.label, 건수: b.count, fill: colors[i] }
    })
  }, [baseItems, selectedManager, daysFilter, 체류bins])

  // 6. 담당자별 집계 (selectedManager 제외, 나머지 필터 적용)
  const 담당자별 = useMemo(() => {
    let base = baseItems
    if (daysFilter) base = base.filter(i => matchDaysFilter(i, daysFilter))
    if (selectedBin) base = base.filter(i => matchBin(i.체류일수, selectedBin))
    const map = new Map<string, number>()
    for (const item of base) {
      const key = item.mngmRsprNm || '(없음)'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
  }, [baseItems, daysFilter, selectedBin, 체류bins])

  // 4. 테이블 데이터
  const display = filtered

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold mb-2">{t.unprocessed.title}</h2>
        <div className="text-green-600 bg-green-50 rounded-lg p-4 text-center">
          {t.unprocessed.noItems}
        </div>
      </div>
    )
  }

  const filterCards: { key: DaysFilter; label: string; count: number; color: string; activeColor: string }[] = [
    { key: 'before', label: t.unprocessed.beforeDue, count: stats.before, color: 'text-green-600', activeColor: 'border-green-400 bg-green-50' },
    { key: 'after', label: t.unprocessed.afterDue, count: stats.after, color: 'text-red-600', activeColor: 'border-red-400 bg-red-50' },
  ]

  return (
    <div className="space-y-4">
      {/* 헤더: 제목 + 평균 체류 + 토글 */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <h2 className="text-lg font-bold">
            {t.unprocessed.title} <span className="text-red-500 text-base font-normal ml-1">{fmt(t.unprocessed.count, filtered.length)}</span>
          </h2>
          <span className="text-sm text-slate-500">
            {t.unprocessed.avgStay} <span className="font-semibold text-slate-700">{stats.평균.toFixed(1)}{t.unprocessed.daysUnit}</span>
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-gray-500">
            {t.unprocessed.excludeLong} {장기건수 > 0 && <span className="text-slate-400">({fmt(t.unprocessed.count, 장기건수)})</span>}
          </span>
          <button
            onClick={() => setExcludeLongTerm(!excludeLongTerm)}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              excludeLongTerm ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              excludeLongTerm ? 'translate-x-4' : ''
            }`} />
          </button>
        </label>
      </div>

      {!excludeLongTerm && 장기건수 > 0 && (
        <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500">
          {fmt(t.unprocessed.longTermNote, 장기건수)}
        </div>
      )}

      {/* 필터 카드 (클릭하여 테이블 필터) */}
      <div className="flex gap-3">
        {filterCards.map(c => {
          const isActive = daysFilter === c.key
          return (
            <button
              key={c.key}
              onClick={() => setDaysFilter(isActive ? null : c.key)}
              className={`flex-1 rounded-xl shadow-sm border px-4 py-3 text-left transition-all cursor-pointer ${
                isActive ? c.activeColor + ' ring-1 ring-offset-0' : 'bg-white border-gray-100 hover:border-gray-200'
              }`}
            >
              <p className="text-xs text-gray-400 mb-0.5">{c.label}</p>
              <p className={`text-lg font-bold ${c.count > 0 ? c.color : 'text-gray-400'}`}>{fmt(t.unprocessed.count, c.count)}</p>
            </button>
          )
        })}
      </div>

      {/* 접이식 차트 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <button
          onClick={() => setChartsOpen(!chartsOpen)}
          className="w-full flex items-center justify-between px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <span>{t.unprocessed.detail}</span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${chartsOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {chartsOpen && (
          <div className="px-6 pb-5 grid grid-cols-1 lg:grid-cols-2 gap-6 border-t border-gray-100 pt-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                {t.unprocessed.stayDist}
                <span className="text-[10px] font-normal text-slate-400 ml-2">{t.unprocessed.clickFilter}</span>
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={체류분포}
                  barCategoryGap="20%"
                  margin={{ top: 20, right: 0, bottom: 0, left: 0 }}
                  onClick={(state) => {
                    const label = state?.activeLabel != null ? String(state.activeLabel) : null
                    if (label) setSelectedBin(prev => prev === label ? null : label)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<MiniTooltip unit={unit} />} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="건수" radius={[6, 6, 0, 0]}>
                    {체류분포.map((entry, i) => (
                      <Cell key={i} fill={selectedBin ? (selectedBin === entry.name ? entry.fill : '#cbd5e1') : entry.fill} />
                    ))}
                    <LabelList dataKey="건수" position="top" fontSize={11} fill="#64748b" formatter={(v: unknown) => Number(v) > 0 ? `${v}${unit}` : ''} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                {t.unprocessed.managerDist}
                <span className="text-[10px] font-normal text-slate-400 ml-2">{t.unprocessed.clickFilter}</span>
              </h3>
              <div className="max-h-[200px] overflow-y-auto">
              <ResponsiveContainer width="100%" height={Math.max(200, 담당자별.length * 25 + 30)}>
                <BarChart
                  data={담당자별}
                  layout="vertical"
                  margin={{ left: 30, right: 40 }}
                  barCategoryGap="15%"
                  onClick={(state) => {
                    const label = state?.activeLabel != null ? String(state.activeLabel) : null
                    if (label) setSelectedManager(prev => prev === label ? null : label)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={({ x, y, payload }: any) => {
                      const isSelected = selectedManager === payload.value
                      return (
                        <text
                          x={x} y={y}
                          textAnchor="end"
                          dominantBaseline="central"
                          fontSize={12}
                          fill={selectedManager ? (isSelected ? '#1e293b' : '#cbd5e1') : '#475569'}
                          fontWeight={isSelected ? 700 : 400}
                        >
                          {payload.value}
                        </text>
                      )
                    }}
                    width={60}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<MiniTooltip unit={unit} />} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="value" name={unit || 'count'} radius={[0, 6, 6, 0]}>
                    {담당자별.map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={selectedManager ? (selectedManager === entry.label ? '#1e3a5f' : '#cbd5e1') : '#1e3a5f'}
                      />
                    ))}
                    <LabelList dataKey="value" position="right" fontSize={11} fill="#64748b" formatter={(v: unknown) => Number(v) > 0 ? `${v}${unit}` : ''} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 활성 필터 칩 */}
      {(selectedManager || daysFilter || selectedBin) && (
        <div className="flex items-center gap-2">
          {daysFilter && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 text-sm font-medium rounded-lg border border-amber-200">
              {filterCards.find(c => c.key === daysFilter)?.label}
              <button
                onClick={() => setDaysFilter(null)}
                className="ml-0.5 text-amber-400 hover:text-amber-600"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          {selectedBin && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 text-sm font-medium rounded-lg border border-green-200">
              {fmt(t.unprocessed.stayLabel, selectedBin)}
              <button
                onClick={() => setSelectedBin(null)}
                className="ml-0.5 text-green-400 hover:text-green-600"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          {selectedManager && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-sm font-medium rounded-lg border border-blue-200">
              {selectedManager}
              <button
                onClick={() => setSelectedManager(null)}
                className="ml-0.5 text-blue-400 hover:text-blue-600"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          <span className="text-xs text-gray-400">{fmt(t.unprocessed.count, filtered.length)}</span>
          <button
            onClick={() => { setDaysFilter(null); setSelectedBin(null); setSelectedManager(null) }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
            title={t.unprocessed.reset}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {t.unprocessed.reset}
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <DataTable columns={columns} data={display} rowKey={i => i.acptNo} onRowClick={item => { if (item.groupNm && onOpenDetail) onOpenDetail(item.groupNm, item.entpPrdNm) }} />
      </div>
    </div>
  )
}
