'use client'

import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { HealthCheckResult, HealthScore, CyclePrediction, Prescription, TrendSeries } from '@/lib/equipment-health'
import { analyzeEquipmentHealth, buildHealthReasoningInput } from '@/lib/equipment-health'

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
  const c = GRADE_COLORS[score.grade]
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score.total / 100) * circumference

  const bars: { label: string; value: number; weight: string }[] = [
    { label: '허용오차 여유', value: score.components.toleranceProximity, weight: '20%' },
    { label: '장기 안정도', value: score.components.longTermStability, weight: '15%' },
    { label: '단기 안정도', value: score.components.shortTermStability, weight: '20%' },
    { label: '적합 이력', value: score.components.failHistory, weight: '30%' },
    { label: '데이터 충분성', value: score.components.dataAvailability, weight: '15%' },
  ]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <Header
        icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        title="장비 건강 진단"
        color="text-emerald-500"
        badge={
          <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${c.bg} ${c.text} border ${c.border}`}>
            {score.grade} / {score.gradeLabel}
          </span>
        }
      />

      {/* 원형 게이지 */}
      <div className="flex justify-center my-2">
        <div className="relative w-[140px] h-[140px]">
          <svg width="140" height="140" className="-rotate-90">
            <circle cx="70" cy="70" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="10" />
            <circle
              cx="70" cy="70" r={radius} fill="none"
              stroke={c.gauge} strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-slate-800">{score.total}</span>
            <span className={`text-xs font-semibold ${c.text}`}>{score.gradeLabel}</span>
          </div>
        </div>
      </div>

      {/* 세부 점수 바 */}
      <div className="space-y-2.5 mt-3">
        {bars.map(bar => {
          const barColor = bar.value >= 75 ? 'bg-green-400' : bar.value >= 50 ? 'bg-amber-400' : 'bg-red-400'
          return (
            <div key={bar.label}>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="text-slate-500">{bar.label}</span>
                <span className="text-slate-400">{bar.value}점 <span className="text-slate-300">({bar.weight})</span></span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full">
                <div
                  className={`h-1.5 rounded-full ${barColor} transition-all duration-700 ease-out`}
                  style={{ width: `${bar.value}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 교정주기 예측 카드 ───

function CyclePredictionCard({ prediction, llmStatus, onRequestAi }: { prediction: CyclePrediction; llmStatus: 'idle' | 'loading' | 'done' | 'error'; onRequestAi?: () => void }) {
  const dirStyles: Record<string, string> = {
    shorten: 'text-red-600 bg-red-50 border-red-200',
    extend: 'text-green-600 bg-green-50 border-green-200',
    maintain: 'text-blue-600 bg-blue-50 border-blue-200',
    insufficient: 'text-slate-400 bg-slate-50 border-slate-200',
  }
  const style = dirStyles[prediction.direction]
  const ex = prediction.extrapolation

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <Header
        icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        title="교정주기 예측"
        color="text-indigo-500"
        badge={
          <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${style}`}>
            {prediction.directionLabel}
          </span>
        }
      />

      {/* 주기 비교 */}
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="p-3 bg-slate-50 rounded-lg text-center">
          <span className="text-[10px] text-slate-400 uppercase">현재 주기</span>
          <p className="text-2xl font-bold text-slate-800 mt-0.5">
            {prediction.currentCycleMonths ?? '-'}
            <span className="text-xs font-normal text-slate-400 ml-0.5">개월</span>
          </p>
        </div>
        <div className={`p-3 rounded-lg text-center border border-dashed ${style}`}>
          <span className="text-[10px] uppercase">AI 추천</span>
          <p className="text-2xl font-bold mt-0.5">
            {prediction.recommendedCycleMonths ?? '--'}
            <span className="text-xs font-normal ml-0.5">개월</span>
          </p>
        </div>
      </div>

      {/* 근거 텍스트 */}
      <div className={`text-xs text-slate-500 mt-3 space-y-1.5 transition-opacity duration-300 ${
        llmStatus === 'loading' ? 'opacity-60' : 'opacity-100'
      }`}>
        {prediction.reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
          <p key={i} className="leading-relaxed">{line}</p>
        ))}
      </div>

      {/* AI 분석 버튼/상태 */}
      {llmStatus === 'idle' && onRequestAi && prediction.direction !== 'insufficient' && (
        <button
          onClick={onRequestAi}
          className="mt-3 flex items-center gap-1.5 text-[11px] text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          AI 전문 소견 요청
        </button>
      )}
      {llmStatus === 'loading' && (
        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-indigo-400">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          AI 분석 중...
        </div>
      )}
      {llmStatus === 'done' && (
        <div className="flex items-center gap-1 mt-2">
          <span className="text-[9px] text-indigo-300 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">AI 소견</span>
        </div>
      )}
      {llmStatus === 'error' && onRequestAi && (
        <button
          onClick={onRequestAi}
          className="mt-3 flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          재시도
        </button>
      )}

      {/* 예측 상세 */}
      {ex.regressionSlope != null && ex.currentRatio != null && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">현재 최대 비율</span>
            <span className="font-medium text-slate-600">{ex.currentRatio.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">연간 변화량</span>
            <span className={`font-medium ${ex.regressionSlope > 0 ? 'text-red-500' : 'text-green-500'}`}>
              {ex.regressionSlope > 0 ? '+' : ''}{ex.regressionSlope}%p/년
            </span>
          </div>
          {ex.predictedDate100 && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">허용오차 도달 예상</span>
              <span className="font-medium text-red-500">{ex.predictedDate100}</span>
            </div>
          )}
        </div>
      )}

      {/* 포인트별 분석 근거 */}
      {prediction.details.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">측정포인트별 추세 분석</p>
          <div className="space-y-2">
            {prediction.details.map((d, i) => {
              const sigColor = d.significant ? 'border-l-amber-400 bg-amber-50/40' : 'border-l-green-400 bg-green-50/30'
              const dir = d.slope > 0 ? '증가' : '감소'
              const pText = d.pValue < 0.01 ? '<0.01' : d.pValue.toFixed(3)
              return (
                <div key={i} className={`rounded border-l-[3px] ${sigColor} px-2.5 py-2`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-slate-700 truncate mr-2">{d.label}</span>
                    <span className={`text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded ${
                      d.significant ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {d.significant ? '유의미' : '안정'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500">
                    <span>기울기 <span className={`font-medium ${d.slope > 0 ? 'text-red-500' : 'text-blue-500'}`}>{d.slope > 0 ? '+' : ''}{d.slope}</span>/년 ({dir})</span>
                    <span>p={pText}</span>
                    <span>{d.recentYears[0]}~{d.recentYears[d.recentYears.length - 1]}</span>
                  </div>
                  {d.significant && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      {d.recentYears.length}회 측정에서 오차값 {dir} 추세 감지 (95% 신뢰수준)
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 처방 / 권고사항 ───

const PRIORITY_STYLES: Record<string, { border: string; badge: string; label: string }> = {
  high: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700', label: '긴급' },
  medium: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-700', label: '권고' },
  low: { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: '참고' },
}

const CATEGORY_ICONS: Record<string, string> = {
  cycle: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  replacement: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  focus: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  data: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
  general: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
}

function PrescriptionList({ prescriptions, llmStatus }: { prescriptions: Prescription[]; llmStatus: 'idle' | 'loading' | 'done' | 'error' }) {
  if (prescriptions.length === 0) return null

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <Header
        icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        title="처방 / 권고사항"
        color="text-purple-500"
        badge={llmStatus === 'done' ? <span className="text-[9px] text-indigo-300 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">AI 소견</span> : undefined}
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
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ps.badge}`}>{ps.label}</span>
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

const CATEGORY_LABELS: Record<string, string> = {
  cycle: '교정주기',
  replacement: '장비 교체',
  focus: '집중 관리',
  data: '데이터 관리',
  general: '종합 관리',
}

// ─── 메인 패널 ───

export default function EquipmentHealthPanel({ series, calDates, certCount, affcCyclCd }: Props) {
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
          categoryLabel: CATEGORY_LABELS[p.category] || p.category,
        })))
      }
      setLlmStatus('done')
    } catch {
      setLlmStatus('error')
    }
  }, [result])

  // 4. 최종 렌더링 데이터
  const displayPrediction = useMemo(() => ({
    ...result.prediction,
    reasoning: llmReasoning ?? result.prediction.reasoning,
  }), [result.prediction, llmReasoning])

  const displayPrescriptions = llmPrescriptions ?? result.prescriptions

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
