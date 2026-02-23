'use client'

import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList } from 'recharts'
import DataTable, { type Column } from './data-table'
import { useT, fmt } from '@/lib/i18n'

// ─── 타입 ───

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
  제조사별: { label: string; value: number }[]
  시급건수: number
}

// ─── 유틸 ───

function formatDDay(d: number, time?: { yearOver: string; yearMonthOver: string; monthOver: string; dayOver: string }): string {
  if (d >= 0) return `D-${d}`
  const abs = Math.abs(d)
  const t = time
  if (abs >= 365) {
    let y = Math.floor(abs / 365)
    let m = Math.floor((abs % 365) / 30)
    if (m >= 12) { y += 1; m = 0 }
    if (t) return m > 0 ? fmt(t.yearMonthOver, y, m) : fmt(t.yearOver, y)
    return m > 0 ? `${y}년 ${m}개월 초과` : `${y}년 초과`
  }
  if (abs >= 30) {
    const months = Math.floor(abs / 30)
    return t ? fmt(t.monthOver, months) : `${months}개월 초과`
  }
  return t ? fmt(t.dayOver, abs) : `${abs}일 초과`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MiniTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-slate-700">
      {label && <p className="text-slate-300 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium">
          {p.name ?? p.dataKey}: <span className="text-blue-300">{Number(p.value).toLocaleString()}건</span>
        </p>
      ))}
    </div>
  )
}

// ─── 테이블 컬럼 ───

function useColumns() {
  const { t } = useT()
  return useMemo<Column<UpcomingItem>[]>(() => [
    {
      key: 'acptNo', header: t.table.acptNo, sortValue: i => i.acptNo,
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
      key: '상태', header: t.table.status, align: 'center',
      sortValue: i => i.접수시급 ? 0 : i.구간 === '장기경과' ? 2 : 1,
      render: i => i.구간 === '장기경과'
        ? <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">{t.upcoming.longTerm}</span>
        : i.접수시급
        ? <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">{t.upcoming.urgent}</span>
        : <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">{t.upcoming.scheduled}</span>,
    },
    { key: 'entpPrdNm', header: t.table.entpPrdNm, sortValue: i => i.entpPrdNm, render: i => <span className="text-gray-800 font-medium max-w-[200px] truncate block" title={i.entpPrdNm}>{i.entpPrdNm}</span> },
    { key: 'prdnCmpnNm', header: t.table.prdnCmpnNm, sortValue: i => i.prdnCmpnNm, render: i => <span className="text-gray-600">{i.prdnCmpnNm}</span> },
    { key: 'stszNm', header: t.table.stszNm, sortValue: i => i.stszNm, render: i => <span className="text-gray-600 max-w-[120px] truncate block" title={i.stszNm}>{i.stszNm || '-'}</span> },
    { key: 'mctlNo', header: t.table.mctlNo, sortValue: i => i.mctlNo, render: i => <span className="font-mono text-xs text-gray-500">{i.mctlNo || '-'}</span> },
    { key: 'custEqpmSrno', header: t.table.custEqpmSrno, sortValue: i => i.custEqpmSrno, render: i => <span className="font-mono text-xs text-gray-500">{i.custEqpmSrno || '-'}</span> },
    { key: 'nxtrExrsYmd', header: t.table.calExpiry, sortValue: i => i.nxtrExrsYmd, render: i => <span className="text-gray-600">{i.nxtrExrsYmd}</span> },
    {
      key: 'dDay', header: t.table.elapsed, sortValue: i => i.dDay,
      render: i => (
        <span className={`text-xs font-medium ${
          i.dDay < -730 ? 'text-slate-400' :
          i.dDay <= 0 ? 'text-red-600' :
          i.dDay <= 30 ? 'text-orange-600' :
          'text-gray-600'
        }`}>
          {formatDDay(i.dDay, t.time)}
        </span>
      ),
    },
    { key: '접수권장일', header: t.table.recDate, sortValue: i => i.접수권장일, render: i => <span className="text-gray-600">{i.접수권장일}</span> },
  ], [t])
}

// ─── 필터 칩 ───

function FilterChip({ label, color, onRemove }: { label: string; color: string; onRemove: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border ${color}`}>
      {label}
      <button onClick={onRemove} className="ml-0.5 opacity-50 hover:opacity-100">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}

// ─── 메인 컴포넌트 ───

export default function UpcomingCalibration({ data, onOpenDetail }: { data: UpcomingData; onOpenDetail?: (groupNm: string, equipmentName: string) => void }) {
  const { t } = useT()
  const columns = useColumns()
  const [excludeLongTerm, setExcludeLongTerm] = useState(true)
  const [chartsOpen, setChartsOpen] = useState(false)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null)
  const [batchMode, setBatchMode] = useState<'product' | 'manufacturer' | 'mfr_model'>('mfr_model')

  // 장기경과 건수: 서버 집계 + 클라이언트 dDay 기반 보정 (캐시 데이터 대응)
  const 장기건수 = useMemo(() =>
    data.items.filter(i => i.구간 === '장기경과' || i.dDay < -730).length
  , [data.items])

  // 1. baseItems: 장기경과 토글만 적용 (dDay 기준으로 이중 체크 — 캐시 데이터 대응)
  const baseItems = useMemo(() =>
    excludeLongTerm ? data.items.filter(i => i.구간 !== '장기경과' && i.dDay >= -730) : data.items
  , [data.items, excludeLongTerm])

  // 2. 요약 카드용 건수 (dDay 기준 — 임박/예비/안전/최근만료/방치)
  const cardCounts = useMemo(() => {
    let 임박 = 0, 예비 = 0, 안전 = 0, 최근만료 = 0, 방치 = 0
    for (const i of baseItems) {
      if (i.구간 === '장기경과') continue
      const d = i.dDay
      if (d >= 0 && d <= 14) 임박++           // 0~14일 남음
      else if (d >= 15 && d <= 30) 예비++      // 15~30일 남음
      else if (d > 30) 안전++                  // 31일 이상
      else if (d < 0) {
        const abs = Math.abs(d)
        if (abs <= 90) 최근만료++              // 만료 3개월 이내
        else 방치++                            // 만료 3개월 초과 (~2년)
      }
    }
    return { 임박, 예비, 안전, 최근만료, 방치 }
  }, [baseItems])

  // 4. sectionFiltered: 카드+제조사 필터만 적용 (일괄 배너의 동적 그룹핑 기준)
  const sectionFiltered = useMemo(() => {
    let result = baseItems
    if (selectedSection === '임박') {
      result = result.filter(i => i.dDay >= 0 && i.dDay <= 14)
    } else if (selectedSection === '예비') {
      result = result.filter(i => i.dDay >= 15 && i.dDay <= 30)
    } else if (selectedSection === '안전') {
      result = result.filter(i => i.dDay > 30)
    } else if (selectedSection === '최근만료') {
      result = result.filter(i => i.dDay < 0 && Math.abs(i.dDay) <= 90)
    } else if (selectedSection === '방치') {
      result = result.filter(i => i.dDay < 0 && Math.abs(i.dDay) > 90)
    }
    if (selectedManufacturer) result = result.filter(i => (i.prdnCmpnNm || '(없음)') === selectedManufacturer)
    return result
  }, [baseItems, selectedSection, selectedManufacturer])

  // 5. 일괄 신청 그룹 (sectionFiltered 기준 — 카드 필터에 따라 동적 갱신)
  const batchGroups = useMemo(() => {
    const map = new Map<string, { label: string; key: string; count: number }>()
    for (const item of sectionFiltered) {
      if (item.구간 === '장기경과') continue
      let key: string, label: string
      if (batchMode === 'product') {
        const v = item.entpPrdNm || '(없음)'
        key = `P|||${v}`
        label = v
      } else if (batchMode === 'manufacturer') {
        const v = item.prdnCmpnNm || '(없음)'
        key = `M|||${v}`
        label = v
      } else {
        const mfr = item.prdnCmpnNm || '(없음)'
        const mdl = item.stszNm || '(없음)'
        key = `MM|||${mfr}|||${mdl}`
        label = `${mfr} / ${mdl}`
      }
      const prev = map.get(key)
      if (prev) prev.count++
      else map.set(key, { label, key, count: 1 })
    }
    return Array.from(map.values())
      .filter(g => g.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [sectionFiltered, batchMode])

  // 6. filtered: sectionFiltered + 일괄 필터 → 테이블용
  const filtered = useMemo(() => {
    let result = sectionFiltered
    if (selectedBatch) {
      const parts = selectedBatch.split('|||')
      if (parts[0] === 'P') {
        result = result.filter(i => (i.entpPrdNm || '(없음)') === parts[1])
      } else if (parts[0] === 'M') {
        result = result.filter(i => (i.prdnCmpnNm || '(없음)') === parts[1])
      } else if (parts[0] === 'MM') {
        result = result.filter(i => (i.prdnCmpnNm || '(없음)') === parts[1] && (i.stszNm || '(없음)') === parts[2])
      }
    }
    return result
  }, [sectionFiltered, selectedBatch])

  // 7. 구간분포 차트 (dDay 기준, selectedSection 제외, selectedManufacturer 적용)
  const 구간분포 = useMemo(() => {
    let base = baseItems
    if (selectedManufacturer) base = base.filter(i => (i.prdnCmpnNm || '(없음)') === selectedManufacturer)
    return [
      { name: '방치', 건수: base.filter(i => i.dDay < 0 && Math.abs(i.dDay) > 90).length, fill: '#94a3b8', filterKey: '방치' },
      { name: '최근 만료', 건수: base.filter(i => i.dDay < 0 && Math.abs(i.dDay) <= 90).length, fill: '#ef4444', filterKey: '최근만료' },
      { name: '임박', 건수: base.filter(i => i.dDay >= 0 && i.dDay <= 14).length, fill: '#f97316', filterKey: '임박' },
      { name: '예비', 건수: base.filter(i => i.dDay >= 15 && i.dDay <= 30).length, fill: '#f59e0b', filterKey: '예비' },
      { name: '안전', 건수: base.filter(i => i.dDay > 30).length, fill: '#22c55e', filterKey: '안전' },
    ]
  }, [baseItems, selectedManufacturer])

  // 8. 제조사별 차트 (selectedManufacturer 제외, selectedSection 적용 — sectionFiltered 재활용)
  const 제조사별 = useMemo(() => {
    const base = selectedSection ? sectionFiltered : baseItems
    const map = new Map<string, number>()
    for (const item of base) {
      if (item.구간 === '장기경과') continue
      const key = item.prdnCmpnNm || '(없음)'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [baseItems, sectionFiltered, selectedSection])

  // 차트 이름 → 필터 값 매핑 (구간분포 차트 클릭용)
  const sectionToFilter = (name: string) => {
    const entry = 구간분포.find(d => d.name === name)
    return entry?.filterKey ?? null
  }

  const unit = t.common.unit
  const filterCards = [
    { key: '임박', label: t.upcoming.imminent, count: cardCounts.임박, color: 'text-red-600', activeColor: 'border-red-400 bg-red-50', dotColor: 'bg-red-500', desc: t.upcoming.imminentDesc },
    { key: '예비', label: t.upcoming.reserve, count: cardCounts.예비, color: 'text-orange-600', activeColor: 'border-orange-400 bg-orange-50', dotColor: 'bg-orange-500', desc: t.upcoming.reserveDesc },
    { key: '안전', label: t.upcoming.safe, count: cardCounts.안전, color: 'text-emerald-600', activeColor: 'border-emerald-400 bg-emerald-50', dotColor: 'bg-emerald-500', desc: t.upcoming.safeDesc },
    { key: '최근만료', label: t.upcoming.recentExpired, count: cardCounts.최근만료, color: 'text-rose-600', activeColor: 'border-rose-400 bg-rose-50', dotColor: 'bg-rose-500', desc: t.upcoming.recentExpiredDesc },
    { key: '방치', label: t.upcoming.neglected, count: cardCounts.방치, color: 'text-slate-500', activeColor: 'border-slate-400 bg-slate-50', dotColor: 'bg-slate-400', desc: t.upcoming.neglectedDesc },
  ]

  const hasFilter = selectedSection || selectedManufacturer || selectedBatch

  return (
    <div className="space-y-4">
      {/* [A] 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <h2 className="text-lg font-bold">
            {t.upcoming.title} <span className="text-red-500 text-base font-normal ml-1">{filtered.length}{unit}</span>
          </h2>
          <span className="text-sm text-slate-500">
            {t.upcoming.avgDays} <span className="font-semibold text-slate-700">{data.평균소요일}{t.common.days}</span>
            <span className="text-slate-300 mx-1">+</span>
            {t.upcoming.margin} <span className="font-semibold text-slate-700">{data.여유일}{t.common.days}</span> {t.upcoming.basis}
          </span>
        </div>
        {장기건수 > 0 && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs text-gray-500">
              {t.upcoming.excludeLong} <span className="text-slate-400">({장기건수}{unit}, {t.upcoming.longTermTag})</span>
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
        )}
      </div>

      {!excludeLongTerm && 장기건수 > 0 && (
        <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500">
          {fmt(t.upcoming.longTermNote, 장기건수)}
        </div>
      )}

      {/* [B] 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {filterCards.map(c => {
          const isActive = selectedSection === c.key
          return (
            <button
              key={c.key}
              onClick={() => { setSelectedSection(isActive ? null : c.key); setSelectedBatch(null) }}
              className={`rounded-xl shadow-sm border px-4 py-3 text-left transition-all cursor-pointer ${
                isActive ? c.activeColor + ' ring-1 ring-offset-0' : 'bg-white border-gray-100 hover:border-gray-200'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${c.dotColor}`} />
                <span className="text-xs text-gray-400">{c.label}</span>
              </div>
              <p className={`text-lg font-bold ${c.count > 0 ? c.color : 'text-gray-400'}`}>{c.count.toLocaleString()}{unit}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{c.desc}</p>
            </button>
          )
        })}
      </div>

      {/* [B-2] 일괄 신청 배너 */}
      <div className="px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-blue-700">{t.upcoming.batchTitle}</p>
          <div className="flex gap-0.5 bg-blue-100 rounded p-0.5">
            {([
              { mode: 'product' as const, label: t.upcoming.batchProduct },
              { mode: 'manufacturer' as const, label: t.upcoming.batchMfr },
              { mode: 'mfr_model' as const, label: t.upcoming.batchMfrModel },
            ]).map(t => (
              <button
                key={t.mode}
                onClick={() => { setBatchMode(t.mode); setSelectedBatch(null) }}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  batchMode === t.mode
                    ? 'bg-white text-blue-700 font-semibold shadow-sm'
                    : 'text-blue-500 hover:text-blue-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {batchGroups.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {batchGroups.map(g => {
              const isActive = selectedBatch === g.key
              return (
                <button
                  key={g.key}
                  onClick={() => setSelectedBatch(isActive ? null : g.key)}
                  className={`text-xs rounded px-2.5 py-1 transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-blue-600 bg-white border border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  {g.label} <span className="font-bold">{fmt(t.upcoming.batchUnit, g.count)}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-[11px] text-blue-400">{t.upcoming.batchEmpty}</p>
        )}
      </div>

      {/* [C] 접이식 차트 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <button
          onClick={() => setChartsOpen(!chartsOpen)}
          className="w-full flex items-center justify-between px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <span>{t.upcoming.detail}</span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${chartsOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {chartsOpen && (
          <div className="px-6 pb-5 grid grid-cols-1 lg:grid-cols-2 gap-6 border-t border-gray-100 pt-4">
            {/* 구간 분포 */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                {t.upcoming.ddayDist}
                <span className="text-[10px] font-normal text-slate-400 ml-2">{t.upcoming.clickFilter}</span>
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={구간분포}
                  barCategoryGap="20%"
                  margin={{ top: 20, right: 0, bottom: 0, left: 0 }}
                  onClick={(state) => {
                    const label = state?.activeLabel != null ? String(state.activeLabel) : null
                    if (label) {
                      const filterVal = sectionToFilter(label)
                      if (filterVal) setSelectedSection(prev => prev === filterVal ? null : filterVal)
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<MiniTooltip />} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="건수" radius={[6, 6, 0, 0]}>
                    {구간분포.map((entry, i) => {
                      const filterVal = sectionToFilter(entry.name)
                      const dimmed = selectedSection && selectedSection !== filterVal
                      return <Cell key={i} fill={dimmed ? '#cbd5e1' : entry.fill} />
                    })}
                    <LabelList dataKey="건수" position="top" fontSize={11} fill="#64748b" formatter={(v) => Number(v) > 0 ? `${v}${unit}` : ''} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 제조사별 분포 */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                {t.upcoming.mfrDist}
                <span className="text-[10px] font-normal text-slate-400 ml-2">{t.upcoming.clickFilter}</span>
              </h3>
              <div className="max-h-[200px] overflow-y-auto">
                <ResponsiveContainer width="100%" height={Math.max(200, 제조사별.length * 25 + 30)}>
                  <BarChart
                    data={제조사별}
                    layout="vertical"
                    margin={{ left: 30, right: 40 }}
                    barCategoryGap="15%"
                    onClick={(state) => {
                      const label = state?.activeLabel != null ? String(state.activeLabel) : null
                      if (label) setSelectedManufacturer(prev => prev === label ? null : label)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={({ x, y, payload }: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                        const isSelected = selectedManufacturer === payload.value
                        return (
                          <text
                            x={x} y={y}
                            textAnchor="end"
                            dominantBaseline="central"
                            fontSize={11}
                            fill={selectedManufacturer ? (isSelected ? '#1e293b' : '#cbd5e1') : '#475569'}
                            fontWeight={isSelected ? 700 : 400}
                          >
                            {payload.value.length > 15 ? payload.value.slice(0, 15) + '…' : payload.value}
                          </text>
                        )
                      }}
                      width={100}
                      interval={0}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<MiniTooltip />} cursor={{ fill: '#f8fafc' }} />
                    <Bar dataKey="value" name={unit || 'count'} radius={[0, 6, 6, 0]}>
                      {제조사별.map((entry) => (
                        <Cell
                          key={entry.label}
                          fill={selectedManufacturer ? (selectedManufacturer === entry.label ? '#1e3a5f' : '#cbd5e1') : '#1e3a5f'}
                        />
                      ))}
                      <LabelList dataKey="value" position="right" fontSize={11} fill="#64748b" formatter={(v) => Number(v) > 0 ? `${v}${unit}` : ''} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* [D] 활성 필터 칩 */}
      {hasFilter && (
        <div className="flex items-center gap-2">
          {selectedSection && (
            <FilterChip
              label={filterCards.find(c => c.key === selectedSection)?.label ?? selectedSection}
              color="bg-amber-50 text-amber-700 border-amber-200"
              onRemove={() => setSelectedSection(null)}
            />
          )}
          {selectedManufacturer && (
            <FilterChip
              label={selectedManufacturer}
              color="bg-blue-50 text-blue-700 border-blue-200"
              onRemove={() => setSelectedManufacturer(null)}
            />
          )}
          {selectedBatch && (
            <FilterChip
              label={fmt(t.upcoming.batchLabel, selectedBatch.split('|||').slice(1).join(' / '))}
              color="bg-indigo-50 text-indigo-700 border-indigo-200"
              onRemove={() => setSelectedBatch(null)}
            />
          )}
          <span className="text-xs text-gray-400">{filtered.length}{unit}</span>
          <button
            onClick={() => { setSelectedSection(null); setSelectedManufacturer(null); setSelectedBatch(null) }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
            title={t.upcoming.reset}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {t.upcoming.reset}
          </button>
        </div>
      )}

      {/* [E] 데이터 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <DataTable columns={columns} data={filtered} rowKey={i => i.acptNo} defaultSort={{ key: '접수권장일', direction: 'asc' }} onRowClick={item => { if (item.groupNm && onOpenDetail) onOpenDetail(item.groupNm, item.entpPrdNm) }} />
      </div>
    </div>
  )
}
