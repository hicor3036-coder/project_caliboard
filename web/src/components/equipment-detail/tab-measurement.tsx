/**
 * 탭 3: 측정분석 (ISO 10012 §7.3 측정 불확도 및 소급성)
 * — 요약카드 + 트렌드차트 + MPE 이중 판정 + Guard Band 재판정
 */
'use client'

import { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Area, ComposedChart, ErrorBar,
} from 'recharts'
import DataTable, { type Column } from '../data-table'
import { useT, fmt } from '@/lib/i18n'
import type { ConformityTrend, TrendRow, GuardBandVerdict } from './shared-utils'
import { TREND_COLORS, parseNum, quantityLabel } from './shared-utils'
import { StabilityBadge, TrendChartTooltip } from './shared-components'

interface Props {
  conformityTrend: ConformityTrend
  tolerance: { value: number; unit: string; note: string | null } | null
  mpePercent: number | null
  onGoIdentity: () => void  // 허용오차 설정으로 이동
}

export default function TabMeasurement({ conformityTrend, tolerance, mpePercent, onGoIdentity }: Props) {
  const { t, lang } = useT()
  const [activeTrendQuantity, setActiveTrendQuantity] = useState<string | null>(null)
  const [hiddenYears, setHiddenYears] = useState<Set<string>>(new Set())
  const [guardBandMode, setGuardBandMode] = useState(false)

  const hasMultiQ = conformityTrend.quantityKeys.length > 1
  const activeQ = activeTrendQuantity && conformityTrend.byQuantity.has(activeTrendQuantity)
    ? activeTrendQuantity : null
  const currentTrend = activeQ
    ? conformityTrend.byQuantity.get(activeQ)!
    : conformityTrend
  const isSingleCert = conformityTrend.certCount === 1

  // MPE 판정 계산 — 허용오차의 X% 초과 여부
  const effectiveMpe = mpePercent ?? 100
  const showMpe = effectiveMpe < 100  // 100%면 허용오차 판정과 동일하므로 별도 표시 불필요

  const mpeStats = useMemo(() => {
    if (!showMpe) return null
    let exceedCount = 0
    for (const s of currentTrend.series) {
      const lastPoint = [...s.points].reverse().find(p => p.오차 != null)
      if (lastPoint && lastPoint.오차 != null) {
        const ratio = lastPoint.허용오차 != null && lastPoint.허용오차 !== 0
          ? Math.abs(lastPoint.오차) / Math.abs(lastPoint.허용오차) * 100
          : null
        if (ratio != null && ratio > effectiveMpe) exceedCount++
      }
    }
    return { exceedCount, totalPoints: currentTrend.series.length }
  }, [showMpe, effectiveMpe, currentTrend])

  // U/T 비율 통계 (ISO 10012 §7.3 Measurement uncertainty and traceability)
  const utStats = useMemo(() => {
    let total = 0, cautionCount = 0, sumUt = 0, hasAny = false
    for (const s of currentTrend.series) {
      const lastPoint = [...s.points].reverse().find(p => p.utRatio != null)
      if (lastPoint?.utRatio != null) {
        hasAny = true
        total++
        sumUt += lastPoint.utRatio
        if (lastPoint.utRatio > 33) cautionCount++
      }
    }
    if (!hasAny) return null
    return { avgUt: Math.round(sumUt / total * 10) / 10, cautionCount, total }
  }, [currentTrend])

  // Guard Band 통계 (ILAC-G8:09/2019)
  const gbStats = useMemo(() => {
    if (!guardBandMode) return null
    let conformant = 0, conditionalPass = 0, conditionalFail = 0, nonConformant = 0, hasAny = false
    for (const s of currentTrend.series) {
      const lastPoint = [...s.points].reverse().find(p => p.guardBand != null)
      if (lastPoint?.guardBand) {
        hasAny = true
        if (lastPoint.guardBand === 'conformant') conformant++
        else if (lastPoint.guardBand === 'conditional-pass') conditionalPass++
        else if (lastPoint.guardBand === 'conditional-fail') conditionalFail++
        else if (lastPoint.guardBand === 'non-conformant') nonConformant++
      }
    }
    if (!hasAny) return null
    return { conformant, conditionalPass, conditionalFail, nonConformant, suspectCount: conditionalPass + conditionalFail }
  }, [guardBandMode, currentTrend])

  const hasUncData = utStats != null

  // 요약 카드 데이터
  const eval_ = conformityTrend.evaluation
  const latestDate = conformityTrend.calDates[conformityTrend.calDates.length - 1]
  const latestYear = conformityTrend.yearLabels[conformityTrend.yearLabels.length - 1]
  const failCount = conformityTrend.series.filter(s => s.points.some(p => p.판정 === 'FAIL')).length
  const warnCount = conformityTrend.series.filter(s => {
    const r = [...s.points].reverse().find(p => p.비율 != null)?.비율
    return r != null && r > 80 && r <= 100
  }).length

  const stabilityColor = eval_.stability === 'safe'
    ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : eval_.stability === 'warning'
    ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-600 bg-red-50 border-red-200'
  const stabilityLabel = eval_.stability === 'safe' ? t.detail.safe : eval_.stability === 'warning' ? t.detail.warning : t.detail.danger

  // Guard Band 판정 라벨/색상 헬퍼
  const gbLabel = (gb: GuardBandVerdict): string => {
    switch (gb) {
      case 'conformant': return t.detail.gbConformant
      case 'conditional-pass': return t.detail.gbConditionalPass
      case 'conditional-fail': return t.detail.gbConditionalFail
      case 'non-conformant': return t.detail.gbNonConformant
    }
  }
  const gbColor = (gb: GuardBandVerdict): string => {
    switch (gb) {
      case 'conformant': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
      case 'conditional-pass': return 'bg-violet-50 text-violet-700 border-violet-200'
      case 'conditional-fail': return 'bg-orange-50 text-orange-700 border-orange-200'
      case 'non-conformant': return 'bg-red-50 text-red-700 border-red-200'
    }
  }

  // 트렌드 테이블
  const trendRows = useMemo((): TrendRow[] => {
    const src = activeQ ? conformityTrend.byQuantity.get(activeQ)! : conformityTrend
    return src.series.map(s => {
      const errors = s.points.map(p => p.오차).filter((v): v is number => v != null)
      const absErrors = errors.map(Math.abs)
      const trend: 'up' | 'down' | 'stable' = absErrors.length >= 2
        ? absErrors[absErrors.length - 1] > absErrors[0] * 1.1 ? 'up'
        : absErrors[absErrors.length - 1] < absErrors[0] * 0.9 ? 'down'
        : 'stable'
        : 'stable'
      const lastRatio = [...s.points].reverse().find(p => p.비율 != null)?.비율 ?? null
      const lastUtRatio = [...s.points].reverse().find(p => p.utRatio != null)?.utRatio ?? null
      const lastGuardBand = [...s.points].reverse().find(p => p.guardBand != null)?.guardBand ?? null
      const hasFail = s.points.some(p => p.판정 === 'FAIL')
      const hasChange = trend !== 'stable'
      const level: 'safe' | 'warning' | 'danger' = hasFail || (lastRatio != null && lastRatio > 100) ? 'danger'
        : (lastRatio != null && lastRatio > 80) || hasChange ? 'warning'
        : 'safe'

      const errorsMap: Record<string, number | null> = {}
      const 판정Map: Record<string, string> = {}
      s.points.forEach((p, pi) => {
        const y = conformityTrend.yearLabels[pi]
        errorsMap[y] = p.오차 ?? null
        판정Map[y] = p.판정 ?? 'PASS'
      })

      const refNum = parseFloat(s.label.replace(/[^\d.-]/g, ''))

      return {
        key: s.key, label: s.label, unit: s.unit,
        sortNum: isNaN(refNum) ? Infinity : refNum,
        errors: errorsMap, 판정Map, hasFail, lastRatio, lastUtRatio, lastGuardBand, trend, level,
      }
    })
  }, [conformityTrend, activeQ])

  const trendColumns = useMemo((): Column<TrendRow>[] => {
    const totalYears = conformityTrend.yearLabels.length
    const yearCols: Column<TrendRow>[] = conformityTrend.yearLabels
      .filter(y => !hiddenYears.has(y))
      .map((y) => {
        const isLatest = conformityTrend.yearLabels.indexOf(y) === totalYears - 1
        return {
          key: y, header: y, align: 'center' as const,
          headerClassName: isLatest ? 'text-slate-900 font-bold' : '',
          sortValue: (r: TrendRow) => r.errors[y] ?? null,
          render: (r: TrendRow) => {
            const val = r.errors[y]
            const 판정 = r.판정Map[y]
            if (val == null) return <span className="text-slate-300">-</span>
            if (판정 === 'FAIL') {
              return <span className="inline-block px-1.5 py-0.5 bg-red-600 text-white font-bold rounded font-mono">{val > 0 ? '+' : ''}{val}</span>
            }
            const color = val > 0 ? 'text-amber-700 font-medium' : val < 0 ? 'text-blue-700 font-medium' : 'text-slate-400'
            return (
              <span className={`font-mono ${color}`}>
                {val > 0 ? '+' : ''}{val}
                {r.unit && <span className="text-slate-300 text-[11px] ml-0.5">{r.unit}</span>}
              </span>
            )
          },
        }
      })

    // MPE 판정 컬럼 (MPE < 100% 일 때만 표시)
    const mpeCol: Column<TrendRow>[] = showMpe ? [{
      key: 'mpe판정',
      header: t.detail.mpeVerdict,
      align: 'center' as const,
      sortValue: (r: TrendRow) => {
        if (r.lastRatio == null) return 0
        return r.lastRatio > effectiveMpe ? 2 : 0
      },
      render: (r: TrendRow) => {
        if (r.lastRatio == null) return <span className="text-slate-300">-</span>
        const exceeded = r.lastRatio > effectiveMpe
        return exceeded
          ? <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold bg-orange-100 text-orange-700 border border-orange-200">{t.detail.mpeFail}</span>
          : <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold bg-green-50 text-green-600 border border-green-200">{t.detail.mpePass}</span>
      },
    }] : []

    // Guard Band 컬럼 (토글 ON + 불확도 데이터 있을 때만)
    const gbCol: Column<TrendRow>[] = guardBandMode && hasUncData ? [{
      key: 'gb' as const,
      header: t.detail.guardBand,
      align: 'center' as const,
      sortValue: (r: TrendRow) => {
        if (!r.lastGuardBand) return -1
        const order: Record<GuardBandVerdict, number> = { 'non-conformant': 3, 'conditional-fail': 2, 'conditional-pass': 1, 'conformant': 0 }
        return order[r.lastGuardBand]
      },
      render: (r: TrendRow) => {
        if (!r.lastGuardBand) return <span className="text-slate-300">-</span>
        return (
          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold border ${gbColor(r.lastGuardBand)}`}>
            {gbLabel(r.lastGuardBand)}
          </span>
        )
      },
    }] as Column<TrendRow>[] : []

    return [
      {
        key: 'label', header: t.detail.mpHeader,
        sortValue: (r: TrendRow) => r.sortNum,
        render: (r: TrendRow) => <span className="font-semibold text-slate-700 whitespace-nowrap">{r.label}</span>,
      },
      ...yearCols,
      {
        key: 'trend', header: t.detail.trendCol, align: 'center' as const,
        sortValue: (r: TrendRow) => r.trend === 'up' ? 2 : r.trend === 'down' ? 1 : 0,
        render: (r: TrendRow) => {
          if (isSingleCert) return <span className="text-slate-300 text-xs">&mdash;</span>
          if (r.trend === 'up') return (
            <svg className="w-4 h-4 text-red-500 inline-block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 12V4M8 4l3 3M8 4L5 7" /></svg>
          )
          if (r.trend === 'down') return (
            <svg className="w-4 h-4 text-amber-500 inline-block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4v8M8 12l3-3M8 12L5 9" /></svg>
          )
          return (
            <svg className="w-4 h-4 text-slate-400 inline-block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M13 8l-3-3M13 8l-3 3" /></svg>
          )
        },
      },
      ...mpeCol,
      // U/T 비율 컬럼 (토글 ON + 불확도 데이터 있을 때만)
      ...(guardBandMode && hasUncData ? [{
        key: 'ut' as const,
        header: t.detail.utCol,
        headerTitle: t.detail.utHint,
        align: 'center' as const,
        sortValue: (r: TrendRow) => r.lastUtRatio ?? -1,
        render: (r: TrendRow) => {
          if (r.lastUtRatio == null) return <span className="text-slate-300">-</span>
          const color = r.lastUtRatio >= 50
            ? 'bg-red-50 text-red-700 border-red-200'
            : r.lastUtRatio > 33
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          return (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold border ${color}`}>
              {r.lastUtRatio}%
            </span>
          )
        },
      }] as Column<TrendRow>[] : []),
      ...gbCol,
      {
        key: '상태', header: t.detail.statusCol, align: 'center' as const,
        sortValue: (r: TrendRow) => r.level === 'danger' ? 2 : r.level === 'warning' ? 1 : 0,
        render: (r: TrendRow) => (
          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
            r.level === 'safe' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : r.level === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {r.level === 'safe' ? t.detail.safe : r.level === 'warning' ? t.detail.warning : t.detail.danger}
          </span>
        ),
      },
    ]
  }, [conformityTrend, activeQ, hiddenYears, t, showMpe, effectiveMpe, isSingleCert, guardBandMode, hasUncData])

  return (
    <div className="space-y-6">
      {/* 요약 패널 — 3-그룹 */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        {/* A. 교정 요약 — 강조 패널 */}
        <div className={`rounded-xl border-2 p-4 ${stabilityColor}`}>
          <p className="text-xs font-semibold opacity-70 mb-3">{t.detail.calSummary}</p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-2xl font-bold">{stabilityLabel}</p>
              <p className="text-[11px] opacity-60 mt-1">{t.detail.stabilityEval}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-700">{latestDate || latestYear}</p>
              <p className="text-[11px] text-slate-400">{fmt(t.detail.trendCount, conformityTrend.certCount)}</p>
            </div>
          </div>
        </div>

        {/* B. 허용오차 판정 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-400 mb-3">{t.detail.tolVerdict}</p>
          <div className="grid grid-cols-2 gap-2">
            {/* FAIL */}
            <div className={`rounded-lg px-3 py-2 ${failCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-slate-50'}`}>
              <p className={`text-[11px] font-medium mb-0.5 ${failCount > 0 ? 'text-red-500' : 'text-slate-400'}`}>{t.detail.verdict} FAIL</p>
              <p className={`text-lg font-bold ${failCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {failCount > 0 ? fmt('{0}개', failCount) : '없음'}
              </p>
            </div>
            {/* >80% 주의 */}
            <div className={`rounded-lg px-3 py-2 ${warnCount > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
              <p className={`text-[11px] font-medium mb-0.5 ${warnCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{t.detail.warning} ({'>'}80%)</p>
              <p className={`text-lg font-bold ${warnCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                {warnCount > 0 ? fmt('{0}개', warnCount) : '없음'}
              </p>
            </div>
          </div>
          {/* MPE 초과 (조건부) */}
          {showMpe && mpeStats && (
            <div className={`mt-2 rounded-lg px-3 py-2 ${mpeStats.exceedCount > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-slate-50'}`}>
              <div className="flex justify-between items-center">
                <span className={`text-[11px] font-medium ${mpeStats.exceedCount > 0 ? 'text-orange-600' : 'text-slate-400'}`}>{t.detail.mpeExceed}</span>
                <span className={`text-sm font-bold ${mpeStats.exceedCount > 0 ? 'text-orange-700' : 'text-slate-400'}`}>
                  {mpeStats.exceedCount > 0 ? fmt('{0}개', mpeStats.exceedCount) : '없음'}
                </span>
              </div>
              <p className={`text-[10px] mt-0.5 ${mpeStats.exceedCount > 0 ? 'text-orange-400' : 'text-slate-300'}`}>
                {fmt(t.detail.mpePercent, effectiveMpe)}
              </p>
            </div>
          )}
        </div>

        {/* C. 불확도 분석 */}
        {guardBandMode && (utStats || gbStats) ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-400 mb-3">{t.detail.uncAnalysis}</p>
            <div className="space-y-2">
              {utStats && (
                <div className={`rounded-lg px-3 py-2 border ${
                  utStats.avgUt >= 50 ? 'bg-red-50 border-red-200'
                    : utStats.avgUt > 33 ? 'bg-amber-50 border-amber-200'
                    : 'bg-emerald-50 border-emerald-200'
                }`}>
                  <p className={`text-[11px] font-medium mb-0.5 ${
                    utStats.avgUt >= 50 ? 'text-red-500' : utStats.avgUt > 33 ? 'text-amber-600' : 'text-emerald-600'
                  }`} title={t.detail.utHint}>{t.detail.utRatio}</p>
                  <p className={`text-lg font-bold ${
                    utStats.avgUt >= 50 ? 'text-red-600' : utStats.avgUt > 33 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {t.detail.utAvg} {utStats.avgUt}%
                  </p>
                  <p className={`text-[10px] mt-0.5 ${utStats.cautionCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {utStats.cautionCount > 0 ? fmt(t.detail.utCaution, utStats.cautionCount) : t.detail.utSafe}
                  </p>
                </div>
              )}
              {gbStats && (
                <div className={`rounded-lg px-3 py-2 border ${
                  gbStats.suspectCount > 0 ? 'bg-violet-50 border-violet-200' : 'bg-emerald-50 border-emerald-200'
                }`}>
                  <p className={`text-[11px] font-medium mb-0.5 ${
                    gbStats.suspectCount > 0 ? 'text-violet-600' : 'text-emerald-600'
                  }`}>{t.detail.guardBand}</p>
                  <p className={`text-sm font-bold ${
                    gbStats.nonConformant > 0 ? 'text-red-600'
                      : gbStats.suspectCount > 0 ? 'text-violet-600'
                      : 'text-emerald-600'
                  }`}>
                    {gbStats.suspectCount > 0
                      ? fmt(t.detail.gbSuspectCount, gbStats.suspectCount)
                      : fmt(t.detail.gbConformantCount, gbStats.conformant)}
                  </p>
                </div>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">ISO 10012 §7.3.1 측정 불확도 / ILAC-G8</p>
          </div>
        ) : !guardBandMode && hasUncData ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 flex items-center justify-center">
            <p className="text-xs text-slate-400 text-center">
              <span className="block mb-1">{t.detail.uncAnalysis}</span>
              &ldquo;{t.detail.guardBandToggle}&rdquo; {lang === 'ko' ? '활성화 시 표시' : 'shown when enabled'}
            </p>
          </div>
        ) : null}
      </div>

      {/* 트렌드 차트 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800">{t.detail.trendTitle}</h3>
              <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">ISO 10012 §7.3 : 측정불확도 및 소급성 (Measurement uncertainty and traceability)</span>
            </div>
            <span className="text-xs text-slate-400 tracking-wide">{t.detail.trendSub}</span>
            <span className="text-[11px] text-slate-400">{t.detail.reqS73}</span>
          </div>
          <span className="px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 rounded-full border border-slate-200">
            {fmt(t.detail.trendCount, conformityTrend.certCount)}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {/* 불확도 고려 토글 (불확도 데이터 있을 때만) */}
            {hasUncData && (
              <button
                onClick={() => setGuardBandMode(prev => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                  guardBandMode
                    ? 'bg-violet-50 text-violet-700 border-violet-200 shadow-sm'
                    : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600 hover:border-slate-300'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {t.detail.guardBandToggle}
              </button>
            )}
            <StabilityBadge level={currentTrend.evaluation.stability} />
          </div>
        </div>

        {/* 물리량 탭 */}
        {hasMultiQ && (
          <div className="flex gap-1 mb-4 bg-gray-50 rounded-lg p-1">
            <button onClick={() => setActiveTrendQuantity(null)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!activeQ ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >{t.detail.allQuantities}</button>
            {conformityTrend.quantityKeys.filter(q => q !== '전체').map(q => (
              <button key={q} onClick={() => setActiveTrendQuantity(q)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeQ === q ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >{quantityLabel(q, lang, t.detail.allQuantities)}</button>
            ))}
          </div>
        )}

        {/* 차트 */}
        {(() => {
          const totalYears = conformityTrend.yearLabels.length
          const hasTolerance = currentTrend.chartData.some(d => d['허용상한'] != null)
          const hasGbLine = guardBandMode && currentTrend.chartData.some(d => d['GB상한'] != null)
          return (
            <ResponsiveContainer key={`${activeQ ?? '__all__'}_${guardBandMode}`} width="100%" height={300}>
              <ComposedChart data={currentTrend.chartData} margin={{ left: 15, right: 15, top: 10, bottom: 5 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e8ecf1" />
                <XAxis
                  dataKey={currentTrend.chartData.every(d => d._x != null) ? '_x' : '측정포인트'}
                  type={currentTrend.chartData.every(d => d._x != null) ? 'number' : 'category'}
                  tick={{ fontSize: 12, fill: '#475569' }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  angle={-30}
                  textAnchor="end"
                  height={55}
                  tickFormatter={currentTrend.chartData.every(d => d._x != null)
                    ? (v: number) => `${v} ${currentTrend.mpOrder[0]?.refUnit || currentTrend.mpOrder[0]?.unit || ''}`
                    : undefined}
                  domain={currentTrend.chartData.every(d => d._x != null) ? ['dataMin', 'dataMax'] : undefined}
                  ticks={currentTrend.chartData.every(d => d._x != null)
                    ? [...new Set(currentTrend.chartData.map(d => d._x as number))].sort((a, b) => a - b)
                    : undefined}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  label={currentTrend.mpOrder[0]?.unit ? {
                    value: fmt(t.detail.errorAxis, currentTrend.mpOrder[0].unit),
                    angle: -90, position: 'insideLeft',
                    style: { fontSize: 12, fill: '#64748b' },
                    offset: -5,
                  } : undefined}
                />
                <Tooltip content={<TrendChartTooltip yearLabels={conformityTrend.yearLabels} unit={currentTrend.mpOrder[0]?.unit ?? ''} />} />
                {/* 허용오차 밴드 */}
                {hasTolerance && (
                  <>
                    <Area dataKey="허용상한" fill="#dbeafe" stroke="none" fillOpacity={0.45} isAnimationActive={false} />
                    <Area dataKey="허용하한" fill="#dbeafe" stroke="none" fillOpacity={0.45} isAnimationActive={false} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />
                  </>
                )}
                {/* Guard Band 경계선 (T-U) — 토글 ON일 때만 */}
                {hasGbLine && (
                  <>
                    <Line dataKey="GB상한" stroke="#059669" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                    <Line dataKey="GB하한" stroke="#059669" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                  </>
                )}
                {/* MPE 밴드 — 진한 빨간 점선 */}
                {currentTrend.chartData.some(d => d['MPE상한'] != null) && (
                  <>
                    <Line dataKey="MPE상한" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} connectNulls />
                    <Line dataKey="MPE하한" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} connectNulls />
                  </>
                )}
                {conformityTrend.yearLabels.map((label, i) => {
                  const isLatest = i === totalYears - 1
                  const color = TREND_COLORS[i % TREND_COLORS.length]
                  const isHidden = hiddenYears.has(label)
                  const hasUncertainty = guardBandMode && currentTrend.chartData.some(d => d[`${label}_U`] != null)
                  return (
                    <Line key={label} dataKey={label} name={label}
                      stroke={color}
                      strokeWidth={isLatest ? 2.5 : 1.5}
                      strokeOpacity={isLatest ? 1 : 0.55}
                      dot={{ r: isLatest ? 3.5 : 2.5, fill: color, strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                      connectNulls hide={isHidden}
                    >
                      {hasUncertainty && (
                        <ErrorBar dataKey={`${label}_U`} width={4} strokeWidth={1.5} stroke={color} opacity={0.6} />
                      )}
                    </Line>
                  )
                })}
              </ComposedChart>
            </ResponsiveContainer>
          )
        })()}

        {/* 범례 */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-3 text-xs">
          {currentTrend.chartData.some(d => d['허용상한'] != null) && (
            <div className="flex items-center gap-1.5 text-slate-400">
              <svg width="20" height="10"><rect x="0" y="2" width="20" height="6" rx="1" fill="#dbeafe" opacity="0.7" /><line x1="0" y1="5" x2="20" y2="5" stroke="#93c5fd" strokeWidth="1" strokeDasharray="2 2" /></svg>
              <span>{t.detail.tolerance}</span>
            </div>
          )}
          {/* Guard Band 경계선 범례 (T-U) */}
          {guardBandMode && currentTrend.chartData.some(d => d['GB상한'] != null) && (
            <div className="flex items-center gap-1.5 text-emerald-600">
              <svg width="20" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#059669" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
              <span>T-U ({t.detail.gbConformant})</span>
            </div>
          )}
          {currentTrend.chartData.some(d => d['MPE상한'] != null) && (
            <div className="flex items-center gap-1.5 text-red-500">
              <svg width="20" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#dc2626" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>{t.detail.mpe} ({fmt(t.detail.mpePercent, effectiveMpe)})</span>
            </div>
          )}
          {guardBandMode && hasUncData && (
            <div className="flex items-center gap-1.5 text-violet-500">
              <svg width="20" height="14"><line x1="10" y1="1" x2="10" y2="13" stroke="#7c3aed" strokeWidth="1.5" opacity="0.6" /><line x1="6" y1="1" x2="14" y2="1" stroke="#7c3aed" strokeWidth="1.5" opacity="0.6" /><line x1="6" y1="13" x2="14" y2="13" stroke="#7c3aed" strokeWidth="1.5" opacity="0.6" /></svg>
              <span>{t.detail.uncertainty} (±U)</span>
            </div>
          )}
          {conformityTrend.yearLabels.map((label, i) => {
            const isLatest = i === conformityTrend.yearLabels.length - 1
            const color = TREND_COLORS[i % TREND_COLORS.length]
            const isHidden = hiddenYears.has(label)
            return (
              <button key={label}
                className="flex items-center gap-1.5 cursor-pointer select-none transition-opacity hover:opacity-80"
                onClick={() => setHiddenYears(prev => {
                  const next = new Set(prev)
                  if (next.has(label)) next.delete(label); else next.add(label)
                  return next
                })}
              >
                <svg width="18" height="10" className={isHidden ? 'opacity-25' : ''}>
                  <line x1="0" y1="5" x2="18" y2="5" stroke={color} strokeWidth={isLatest ? 2.5 : 1.5} opacity={isLatest ? 1 : 0.55} />
                  <circle cx="9" cy="5" r="2.5" fill={color} stroke="#fff" strokeWidth="1.5" />
                </svg>
                <span className={`${isLatest ? 'font-bold text-slate-700' : 'text-slate-500'} ${isHidden ? 'line-through opacity-40' : ''}`}>{label}</span>
              </button>
            )
          })}
        </div>

        {/* 트렌드 테이블 */}
        <div className="mt-5">
          <DataTable columns={trendColumns} data={trendRows} rowKey={r => r.key} defaultSort={{ key: '상태', direction: 'desc' }} />
        </div>

        {/* 종합 평가 */}
        {currentTrend.evaluation.riskPoints.length > 0 && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-bold text-slate-600 uppercase tracking-wide">{t.detail.stabilityEval}</span>
              <StabilityBadge level={currentTrend.evaluation.stability} />
            </div>
            <div className="space-y-2">
              {currentTrend.evaluation.riskPoints.map((rp, i) => {
                const isDanger = /FAIL|초과|위험|100%/.test(rp)
                const isWarning = /증가|주의|불안정|80%/.test(rp)
                const borderColor = isDanger ? 'border-l-red-500' : isWarning ? 'border-l-amber-500' : 'border-l-blue-400'
                const iconColor = isDanger ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-blue-400'
                const iconPath = isDanger
                  ? 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
                  : isWarning
                  ? 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                return (
                  <div key={i} className={`flex items-start gap-2.5 pl-3 py-2 border-l-[3px] ${borderColor} bg-white rounded-r-md`}>
                    <svg className={`w-3.5 h-3.5 ${iconColor} mt-0.5 shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
                    </svg>
                    <span className="text-sm text-slate-600 leading-relaxed">{rp}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
