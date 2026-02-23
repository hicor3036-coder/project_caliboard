'use client'

import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import type { HealthCheckResult, HealthScore, CyclePrediction, Prescription, TrendSeries } from '@/lib/equipment-health'
import { analyzeEquipmentHealth, buildHealthReasoningInput } from '@/lib/equipment-health'
import { useT, fmt } from '@/lib/i18n'

// ─── Props ───

interface Props {
  series: TrendSeries[]
  calDates: string[]
  certCount: number
  affcCyclCd: string | null
}

// ─── 등급 색상 ───

const GRADE_COLORS: Record<string, { gauge: string; text: string; bg: string; border: string }> = {
  A: { gauge: '#22c55e', text: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  B: { gauge: '#3b82f6', text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  C: { gauge: '#f59e0b', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  D: { gauge: '#f97316', text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  F: { gauge: '#ef4444', text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
}

// ─── 공통 아이콘 래퍼 ───

function Icon({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

// ─── 섹션 헤더 (기존 패턴 재사용) ───

function Header({ icon, title, color, badge }: { icon: string; title: string; color: string; badge?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon d={icon} className={`w-4 h-4 ${color}`} />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
      </div>
      {badge}
    </div>
  )
}

// ─── 건강 진단 카드 ───

function HealthScoreCard({ score }: { score: HealthScore }) {
  const { t } = useT()
  const c = GRADE_COLORS[score.grade]
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score.total / 100) * circumference

  const radarData = [
    { axis: t.health.tolProximity, value: score.components.toleranceProximity, fullMark: 100 },
    { axis: t.health.longStability, value: score.components.longTermStability, fullMark: 100 },
    { axis: t.health.shortStability, value: score.components.shortTermStability, fullMark: 100 },
    { axis: t.health.failHistory, value: score.components.failHistory, fullMark: 100 },
    { axis: t.health.dataAvail, value: score.components.dataAvailability, fullMark: 100 },
  ]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <Header
        icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        title={t.health.healthDiag}
        color="text-emerald-500"
        badge={
          <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${c.bg} ${c.text} border ${c.border}`}>
            {score.grade} / {score.gradeLabel}
          </span>
        }
      />

      {/* 종합 점수 + 레이더 차트 */}
      <div className="flex items-center gap-2 mt-2 max-w-[480px] mx-auto">
        {/* 원형 게이지 (좌측) */}
        <div className="shrink-0">
          <div className="relative w-[120px] h-[120px]">
            <svg width="120" height="120" className="-rotate-90">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="9" />
              <circle
                cx="60" cy="60" r={radius} fill="none"
                stroke={c.gauge} strokeWidth="9"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-slate-800">{score.total}</span>
              <span className={`text-[10px] font-semibold ${c.text}`}>{score.gradeLabel}</span>
            </div>
          </div>
        </div>

        {/* 레이더 차트 (우측) */}
        <div className="flex-1 min-w-0 h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis
                dataKey="axis"
                tick={({ x, y, payload }) => {
                  const lines = (payload.value as string).split('\n')
                  return (
                    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-slate-400" style={{ fontSize: 9 }}>
                      {lines.map((line: string, i: number) => (
                        <tspan key={i} x={x} dy={i === 0 ? 0 : 11}>{line}</tspan>
                      ))}
                    </text>
                  )
                }}
              />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                dataKey="value"
                stroke={c.gauge}
                fill={c.gauge}
                fillOpacity={0.2}
                strokeWidth={2}
                dot={{ r: 3, fill: c.gauge, stroke: '#fff', strokeWidth: 1.5 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 세부 점수 테이블 */}
      <table className="w-full mt-2 text-[11px]">
        <tbody>
          {radarData.map(d => {
            const pct = d.value
            const barColor = pct >= 75 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
            const textColor = pct >= 75 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'
            return (
              <tr key={d.axis} className="border-b border-slate-50 last:border-0">
                <td className="py-1 text-slate-500 font-medium w-[80px]">{d.axis.replace('\n', '')}</td>
                <td className="py-1 px-2">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </td>
                <td className={`py-1 text-right font-bold w-[36px] ${textColor}`}>{pct}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── 교정주기 예측 카드 ───

const VERDICT_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  safe:    { icon: '✓', color: 'text-emerald-500', bg: 'bg-emerald-50' },
  caution: { icon: '⚠', color: 'text-amber-500', bg: 'bg-amber-50' },
  danger:  { icon: '✕', color: 'text-red-500', bg: 'bg-red-50' },
}

function CyclePredictionCard({ prediction, llmStatus, onRequestAi }: { prediction: CyclePrediction; llmStatus: 'idle' | 'loading' | 'done' | 'error'; onRequestAi?: () => void }) {
  const { t } = useT()
  const [expandedCycle, setExpandedCycle] = useState<number | null>(null)

  const verdictLabels: Record<string, string> = {
    safe: t.health.safe,
    caution: t.health.caution,
    danger: t.health.dangerLabel,
  }

  const dirStyles: Record<string, string> = {
    shorten: 'text-red-600 bg-red-50 border-red-200',
    extend: 'text-green-600 bg-green-50 border-green-200',
    maintain: 'text-blue-600 bg-blue-50 border-blue-200',
    insufficient: 'text-slate-400 bg-slate-50 border-slate-200',
  }
  const style = dirStyles[prediction.direction]
  const sim = prediction.simulation
  const sigCount = prediction.details.filter(d => d.significant).length
  const urgentCount = prediction.details.filter(d =>
    (d.yearsToLimit != null && d.yearsToLimit < 3) ||
    (d.usageRatio != null && d.usageRatio > 80)
  ).length

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* 헤더 + 방향 배지 */}
      <Header
        icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        title={t.health.cyclePred}
        color="text-indigo-500"
        badge={prediction.direction !== 'insufficient' ? (
          <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${style}`}>
            {prediction.directionLabel}
          </span>
        ) : undefined}
      />

      {/* 주기 비교 */}
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="p-3 bg-slate-50 rounded-lg text-center">
          <span className="text-[10px] text-slate-400 uppercase">{t.health.currentCycle}</span>
          <p className="text-2xl font-bold text-slate-800 mt-0.5">
            {prediction.currentCycleMonths ?? '-'}
            <span className="text-xs font-normal text-slate-400 ml-0.5">{t.detail.months}</span>
          </p>
        </div>
        {prediction.recommendedCycleMonths != null ? (
          <div className={`p-3 rounded-lg text-center border border-dashed ${style}`}>
            <span className="text-[10px] uppercase">{t.health.recCycle}</span>
            <p className="text-2xl font-bold mt-0.5">
              {prediction.recommendedCycleMonths}
              <span className="text-xs font-normal ml-0.5">{t.detail.months}</span>
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-lg text-center border border-dashed border-slate-200 bg-slate-50/50">
            <span className="text-[10px] text-slate-300 uppercase">{t.health.recCycle}</span>
            <p className="text-2xl font-bold text-slate-200 mt-0.5">
              --<span className="text-xs font-normal ml-0.5">{t.detail.months}</span>
            </p>
          </div>
        )}
      </div>

      {/* 판단 근거 + 시뮬레이션 */}
      {prediction.direction !== 'insufficient' && sim && (
        <div className="mt-4 space-y-3">
          {/* 판단 근거 */}
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-slate-600">{t.health.reasoning}</p>
            <div className="text-[11px] text-slate-500 space-y-0.5">
              {prediction.direction === 'shorten' ? (
                <>
                  {sim.shortestPoint && (
                    <p>· {t.health.shortestLimit}: <span className="font-semibold text-slate-700">{sim.shortestPoint.label}</span>, {fmt(t.health.yearsAfter, sim.shortestPoint.yearsToLimit)} ({fmt(t.health.monthsAfter, Math.round(sim.shortestPoint.yearsToLimit * 12))})</p>
                  )}
                  <p>· {t.health.sigTrend} {fmt(t.health.sigOf, sigCount, prediction.details.length)} (p&lt;0.05)</p>
                  {urgentCount > 0 && (
                    <p>· {t.health.riskPoints}: {fmt(t.health.riskCount, urgentCount)}</p>
                  )}
                </>
              ) : prediction.direction === 'extend' ? (
                <>
                  <p>· {t.health.rateBelow}</p>
                  <p>· {t.health.sigTrend} {fmt(t.health.sigOf, 0, prediction.details.length)}</p>
                </>
              ) : sigCount > 0 ? (
                <>
                  {sim.shortestPoint && (
                    <p>· {t.health.shortestLimit}: <span className="font-semibold text-slate-700">{sim.shortestPoint.label}</span>, {fmt(t.health.yearsAfter, sim.shortestPoint.yearsToLimit)}</p>
                  )}
                  <p>· {t.health.changeDetected} {fmt(t.health.sigOf, sigCount, prediction.details.length)}, {t.health.marginSufficient}</p>
                </>
              ) : (
                <p>· {t.health.allPointsStable}</p>
              )}
            </div>
          </div>

          {/* 타임라인 */}
          {sim.rows.length >= 2 && (
            <div className="relative">
              <div className="flex items-center justify-between px-1">
                {sim.rows.map((row, i) => {
                  const isRecommended = row.cycleMonths === prediction.recommendedCycleMonths
                  const isCurrent = row.cycleMonths === prediction.currentCycleMonths
                  const vi = VERDICT_ICONS[row.verdict]
                  return (
                    <div key={row.cycleMonths} className="flex flex-col items-center relative z-10">
                      {/* 아이콘 */}
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isRecommended ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-300' :
                        `${vi.bg} ${vi.color}`
                      }`}>
                        {isRecommended ? '★' : vi.icon}
                      </span>
                      {/* 라벨 */}
                      <span className={`text-[10px] mt-1 ${isRecommended ? 'font-bold text-indigo-600' : 'text-slate-400'}`}>
                        {row.cycleMonths}{t.detail.months}
                      </span>
                      <span className={`text-[9px] ${
                        isRecommended ? 'text-indigo-400' : isCurrent ? 'text-slate-400' : 'text-slate-300'
                      }`}>
                        {isRecommended ? t.health.recommend : isCurrent ? t.health.current : verdictLabels[row.verdict]}
                      </span>
                    </div>
                  )
                })}
              </div>
              {/* 연결선 */}
              <div className="absolute top-3 left-4 right-4 h-px bg-slate-200" />
            </div>
          )}

          {/* 시뮬레이션 테이블 (건강점수 + 위험 포인트) */}
          {sim.rows.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-600 mb-1.5">{t.health.simTitle}</p>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left py-1 font-medium">{t.health.simCycle}</th>
                    <th className="text-center py-1 font-medium">{t.health.simHealth}</th>
                    <th className="text-right py-1 font-medium">{t.health.simRisk}</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.rows.map(row => {
                    const isRecommended = row.cycleMonths === prediction.recommendedCycleMonths
                    const gc = GRADE_COLORS[row.grade] ?? GRADE_COLORS.C
                    const isExpanded = expandedCycle === row.cycleMonths
                    return (
                      <tr key={row.cycleMonths} className="group">
                        <td colSpan={3} className="p-0">
                          {/* 메인 행 */}
                          <div className={`flex items-center py-1.5 px-1 border-b border-slate-50 ${isRecommended ? 'bg-indigo-50/50' : ''}`}>
                            <span className={`flex-1 ${isRecommended ? 'font-semibold' : ''}`}>
                              {row.cycleMonths}{t.detail.months}
                              {isRecommended && <span className="text-[9px] text-indigo-400 ml-1">{t.health.recommend}</span>}
                            </span>
                            <span className={`w-[80px] text-center font-semibold ${gc.text}`}>
                              {fmt(t.health.scorePoint, row.healthScore % 1 === 0 ? row.healthScore : row.healthScore.toFixed(1), row.grade)}
                            </span>
                            {row.dangerCount > 0 ? (
                              <button
                                onClick={() => setExpandedCycle(isExpanded ? null : row.cycleMonths)}
                                className="w-[80px] text-right text-red-500 hover:text-red-700 cursor-pointer font-medium"
                              >
                                {fmt(t.health.dangerCount, row.dangerCount)} {isExpanded ? '▼' : '▶'}
                              </button>
                            ) : (
                              <span className="w-[80px] text-right text-emerald-500">{fmt(t.health.dangerCount, 0)}</span>
                            )}
                          </div>
                          {/* 펼침: 위험 포인트 상세 */}
                          {isExpanded && row.dangerPoints.length > 0 && (
                            <div className="bg-red-50/50 px-3 py-2 border-b border-red-100">
                              {row.dangerPoints.map((dp, i) => (
                                <div key={`${dp.label}-${i}`} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                                  <span className="text-slate-600">{dp.label}</span>
                                  <span className="text-red-500 font-medium ml-auto">{fmt(t.health.simUsageRatio, dp.usageRatio)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 결론 텍스트 (규칙 기반, 항상 표시) */}
          <div className="text-[11px] text-slate-500 leading-relaxed">
            {prediction.direction === 'shorten' ? (
              <>{fmt(t.health.shortenNote, prediction.currentCycleMonths ?? '-', sim.shortestPoint?.label ?? '-', prediction.recommendedCycleMonths ?? '-')}</>
            ) : prediction.direction === 'extend' ? (
              <>{t.health.extendNote}</>
            ) : (
              <>{t.health.maintainNote}</>
            )}
          </div>
        </div>
      )}

      {/* AI 인사이트 (LLM 호출 후) */}
      {llmStatus === 'done' && prediction.reasoning && (
        <div className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100 space-y-1.5">
          {prediction.reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
            <p key={i} className="leading-relaxed">{line}</p>
          ))}
          <div className="flex items-center gap-1 mt-2">
            <span className="text-[9px] text-indigo-300 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">{t.health.aiInsight}</span>
          </div>
        </div>
      )}

      {/* AI 호출 버튼 / 로딩 / 에러 */}
      {llmStatus === 'idle' && onRequestAi && prediction.direction !== 'insufficient' && (
        <div className="mt-3 text-center py-2">
          <button onClick={onRequestAi} className="inline-flex items-center gap-1.5 text-[11px] text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t.health.requestAi}
          </button>
        </div>
      )}
      {llmStatus === 'loading' && (
        <div className="flex items-center justify-center gap-1.5 mt-3 py-2 text-[10px] text-indigo-400">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t.health.aiLoading}
        </div>
      )}
      {llmStatus === 'error' && onRequestAi && (
        <div className="mt-3 text-center py-2">
          <button onClick={onRequestAi} className="inline-flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {t.detail.retry}
          </button>
        </div>
      )}

      {/* ISO 참조 */}
      {prediction.direction !== 'insufficient' && (
        <p className="text-[10px] text-slate-300 mt-3 pt-2 border-t border-slate-50">
          {t.health.isoRef}
        </p>
      )}
    </div>
  )
}

// ─── 처방 / 권고사항 ───

const PRIORITY_STYLES: Record<string, { border: string; badge: string }> = {
  high: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700' },
  medium: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-700' },
  low: { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
}

const CATEGORY_ICONS: Record<string, string> = {
  cycle: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  replacement: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  focus: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  data: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
  general: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
}

function PrescriptionList({ prescriptions, llmStatus }: { prescriptions: Prescription[]; llmStatus: 'idle' | 'loading' | 'done' | 'error' }) {
  const { t } = useT()
  if (prescriptions.length === 0) return null

  const priorityLabels: Record<string, string> = {
    high: t.health.priHigh,
    medium: t.health.priMed,
    low: t.health.priLow,
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <Header
        icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        title={t.health.prescription}
        color="text-purple-500"
        badge={llmStatus === 'done' ? <span className="text-[9px] text-indigo-300 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">{t.health.aiInsight}</span> : undefined}
      />

      <div className="space-y-2.5">
        {prescriptions.map((rx, i) => {
          const ps = PRIORITY_STYLES[rx.priority]
          const iconD = CATEGORY_ICONS[rx.category] || CATEGORY_ICONS.general
          return (
            <div key={i} className={`rounded-lg border-l-4 ${ps.border} p-3.5 bg-slate-50/50`}>
              <div className="flex items-start gap-2.5">
                <Icon d={iconD} className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ps.badge}`}>{priorityLabels[rx.priority]}</span>
                    <span className="text-[10px] text-slate-400">{rx.categoryLabel}</span>
                  </div>
                  <p className="text-sm font-medium text-slate-700 leading-snug">{rx.title}</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{rx.description}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 카테고리 라벨 매핑 ───

function useCategoryLabels() {
  const { t } = useT()
  return useMemo(() => ({
    cycle: t.health.catCycle,
    replacement: t.health.catReplace,
    focus: t.health.catFocus,
    data: t.health.catData,
    general: t.health.catGeneral,
  }), [t])
}

// ─── 메인 패널 ───

export default function EquipmentHealthPanel({ series, calDates, certCount, affcCyclCd }: Props) {
  const categoryLabels = useCategoryLabels()
  // 1. 규칙 기반 결과 즉시 계산
  const result = useMemo(
    () => analyzeEquipmentHealth(series, calDates, certCount, affcCyclCd),
    [series, calDates, certCount, affcCyclCd],
  )

  // 2. LLM 강화 상태
  const [llmReasoning, setLlmReasoning] = useState<string | null>(null)
  const [llmPrescriptions, setLlmPrescriptions] = useState<Prescription[] | null>(null)
  const [llmStatus, setLlmStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  // result 변경 시 LLM 상태 리셋
  useEffect(() => {
    setLlmReasoning(null)
    setLlmPrescriptions(null)
    setLlmStatus('idle')
  }, [result])

  // 3. 사용자가 능동적으로 호출
  const requestAi = useCallback(async () => {
    if (result.prediction.direction === 'insufficient') return
    setLlmStatus('loading')
    try {
      const input = buildHealthReasoningInput(result)
      const response = await fetch('/api/ai/health-reasoning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()

      if (data.reasoning) setLlmReasoning(data.reasoning)
      if (Array.isArray(data.prescriptions)) {
        setLlmPrescriptions(data.prescriptions.map((p: { priority: string; category: string; title: string; description: string }) => ({
          ...p,
          categoryLabel: categoryLabels[p.category as keyof typeof categoryLabels] || p.category,
        })))
      }
      setLlmStatus('done')
    } catch {
      setLlmStatus('error')
    }
  }, [result, categoryLabels])

  // 4. 최종 렌더링 데이터 (AI 인사이트만 표시, 규칙 기반 텍스트 숨김)
  const displayPrediction = useMemo(() => ({
    ...result.prediction,
    reasoning: llmReasoning ?? '',
  }), [result.prediction, llmReasoning])

  const displayPrescriptions = llmPrescriptions ?? []

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthScoreCard score={result.score} />
        <CyclePredictionCard prediction={displayPrediction} llmStatus={llmStatus} onRequestAi={requestAi} />
      </div>
      <PrescriptionList prescriptions={displayPrescriptions} llmStatus={llmStatus} />
    </>
  )
}
