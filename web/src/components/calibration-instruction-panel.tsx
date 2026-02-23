'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import type { TrendSeries } from '@/lib/equipment-health'
import { analyzeEquipmentHealth, buildCalibrationInstructionInput } from '@/lib/equipment-health'

// ─── Props ───

interface QuantityTrend {
  series: TrendSeries[]
  [key: string]: unknown
}

interface Props {
  series: TrendSeries[]
  calDates: string[]
  certCount: number
  affcCyclCd: string | null
  equipmentName: string
  manufacturer: string
  model: string
  byQuantity?: Map<string, QuantityTrend>
  quantityKeys?: string[]
}

// ─── LLM 응답 타입 ───

interface AiPoint {
  label: string
  level: string
  levelLabel: string
  priority: string
  headline: string
  reason: string
  action: string
}

interface AiInstruction {
  points: AiPoint[]
  schedule: { label: string; timing: string; reason: string }[]
  environmentNotes: string[]
}

// ─── 스타일 매핑 ───

const ROW_STYLES: Record<string, { dot: string; bg: string; text: string }> = {
  high:   { dot: 'bg-red-500',    bg: 'bg-red-50',    text: 'text-red-700' },
  medium: { dot: 'bg-amber-400',  bg: 'bg-amber-50',  text: 'text-amber-700' },
  low:    { dot: 'bg-emerald-400', bg: '',              text: 'text-slate-500' },
}

const QUANTITY_LABELS: Record<string, string> = {
  Temperature: '온도', Humidity: '습도', Pressure: '압력',
  Vibration: '진동', Frequency: '주파수', 'Sound Level': '소음',
  Voltage: '전압', Current: '전류', Resistance: '저항',
}

function quantityLabel(q: string): string {
  return QUANTITY_LABELS[q] || q
}

// ─── 그룹 설정 ───

const GROUPS: { level: string; priority: string; label: string; dot: string; bg: string; text: string; headerBg: string }[] = [
  { level: 'precision', priority: 'high',   label: '정밀교정', dot: 'bg-red-500',     bg: 'bg-red-50',    text: 'text-red-700',   headerBg: 'bg-red-100 text-red-800' },
  { level: 'standard',  priority: 'medium', label: '표준교정', dot: 'bg-amber-400',   bg: 'bg-amber-50',  text: 'text-amber-700', headerBg: 'bg-amber-100 text-amber-800' },
  { level: 'observation', priority: 'low',  label: '정상',     dot: 'bg-emerald-400', bg: '',              text: 'text-slate-500', headerBg: 'bg-emerald-100 text-emerald-800' },
]

// ─── 결과 렌더링 서브컴포넌트 ───

function InstructionContent({ instruction }: { instruction: AiInstruction }) {
  // 우선순위별 그룹핑 (precision → standard → observation)
  const grouped = GROUPS.map(g => ({
    ...g,
    points: instruction.points.filter(p => p.level === g.level || p.priority === g.priority),
  })).filter(g => g.points.length > 0)

  // observation이 아닌 그룹이 하나도 없으면 전 포인트 안정
  const allStable = grouped.every(g => g.level === 'observation')

  return (
    <>
      {grouped.map(group => {
        // observation(정상) 그룹은 한 줄 요약
        if (group.level === 'observation') {
          return (
            <div key={group.level} className="mt-2">
              <div className="flex items-start gap-2 px-1 py-2 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${group.dot} shrink-0 mt-0.5`} />
                <p className="text-slate-500">
                  <span className="font-medium text-slate-600">
                    정상 ({group.points.map(p => p.label).join(', ')}):
                  </span>
                  {' '}여유 충분, 기본 절차 수행
                </p>
              </div>
            </div>
          )
        }

        // precision / standard 그룹
        return (
          <div key={group.level} className="mb-3">
            {/* 그룹 헤더 */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${group.dot} shrink-0`} />
              <span className={`text-[11px] font-bold ${group.headerBg} px-2 py-0.5 rounded`}>
                {group.label} ({group.points.length}건)
              </span>
            </div>
            {/* 카드 그리드 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.points.map((pt, i) => {
                // headline fallback: 없으면 reason 첫 문장 추출
                const headline = pt.headline || pt.reason.split(/[.。]/).filter(Boolean)[0] || ''
                const reason = pt.headline ? pt.reason : pt.reason.slice(headline.length).replace(/^[.。\s]+/, '')
                return (
                  <div key={i} className={`rounded-lg ${group.bg} px-3 py-2.5 border border-transparent`}>
                    {/* 라벨 + headline */}
                    <div className="mb-1.5">
                      <span className={`text-xs font-bold ${group.text}`}>{pt.label}</span>
                      {headline && (
                        <span className="text-[11px] text-slate-800 font-bold ml-2">— {headline}</span>
                      )}
                    </div>
                    {/* 수치 근거 */}
                    {reason && <p className="text-[11px] text-slate-500 leading-snug">{reason}</p>}
                    {/* 조치 — 시각적 분리 */}
                    <div className="mt-2 pt-1.5 border-t border-black/5 flex gap-1.5 items-start">
                      <span className="text-[10px] font-bold text-slate-400 mt-px shrink-0">▶</span>
                      <p className="text-[11px] text-slate-800 font-medium leading-snug">{pt.action}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 전 포인트 안정 메시지 */}
      {allStable && (
        <p className="text-[11px] text-emerald-500 font-medium mt-1">전 포인트 안정 — 특별 주의 포인트 없음</p>
      )}

      {/* 재점검 + 주의사항 */}
      {(instruction.schedule.length > 0 || instruction.environmentNotes.length > 0) && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-slate-400">
          {instruction.schedule.map((s, i) => (
            <span key={`s${i}`}>
              <span className="font-medium text-slate-500">{s.label}</span> {s.timing}
            </span>
          ))}
          {instruction.environmentNotes.map((note, i) => (
            <span key={`e${i}`}>· {note}</span>
          ))}
        </div>
      )}
    </>
  )
}

// ─── 메인 패널 ───

export default function CalibrationInstructionPanel({
  series, calDates, certCount, affcCyclCd,
  equipmentName, manufacturer, model,
  byQuantity, quantityKeys,
}: Props) {
  // 물리량 탭: '전체' 제외, 실제 물리량만
  const tabs = useMemo(() => {
    if (!quantityKeys || !byQuantity) return []
    const filtered = quantityKeys.filter(q => q !== '전체' && byQuantity.has(q))
    return filtered.length >= 2 ? filtered : []
  }, [quantityKeys, byQuantity])

  const hasMultiQ = tabs.length >= 2
  const [activeTab, setActiveTab] = useState<string | null>(null)

  // 탭이 있으면 첫 번째 탭을 기본 선택
  useEffect(() => {
    if (hasMultiQ && !activeTab) setActiveTab(tabs[0])
  }, [hasMultiQ, tabs, activeTab])

  // 현재 탭에 해당하는 series 결정
  const currentSeries = useMemo(() => {
    if (hasMultiQ && activeTab && byQuantity?.has(activeTab)) {
      return byQuantity.get(activeTab)!.series
    }
    return series
  }, [hasMultiQ, activeTab, byQuantity, series])

  // 전체 series로 direction 확인 (insufficient 체크용)
  const overallResult = useMemo(
    () => analyzeEquipmentHealth(series, calDates, certCount, affcCyclCd),
    [series, calDates, certCount, affcCyclCd],
  )

  // 탭별 AI 결과 캐시 (key: 탭 이름 또는 '__all__')
  const [instructionMap, setInstructionMap] = useState<Map<string, AiInstruction>>(new Map())
  const [statusMap, setStatusMap] = useState<Map<string, 'idle' | 'loading' | 'done' | 'error'>>(new Map())

  const currentKey = hasMultiQ ? (activeTab ?? '__all__') : '__all__'
  const instruction = instructionMap.get(currentKey) ?? null
  const llmStatus = statusMap.get(currentKey) ?? 'idle'

  // series 변경 시 캐시 초기화
  useEffect(() => {
    setInstructionMap(new Map())
    setStatusMap(new Map())
  }, [series])

  const requestAi = useCallback(async () => {
    if (overallResult.prediction.direction === 'insufficient') return
    const key = currentKey
    const targetSeries = currentSeries

    setStatusMap(prev => new Map(prev).set(key, 'loading'))
    try {
      const result = analyzeEquipmentHealth(targetSeries, calDates, certCount, affcCyclCd)
      const input = buildCalibrationInstructionInput(result, { equipmentName, manufacturer, model })
      // 탭별 호출 시 물리량 정보 추가
      if (hasMultiQ && activeTab) {
        input.quantityLabel = quantityLabel(activeTab)
      }
      const res = await fetch('/api/ai/calibration-instruction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (Array.isArray(data.points)) {
        setInstructionMap(prev => new Map(prev).set(key, {
          points: data.points,
          schedule: data.schedule ?? [],
          environmentNotes: data.environmentNotes ?? [],
        }))
        setStatusMap(prev => new Map(prev).set(key, 'done'))
      } else {
        throw new Error('형식 불일치')
      }
    } catch {
      setStatusMap(prev => new Map(prev).set(key, 'error'))
    }
  }, [overallResult, currentKey, currentSeries, calDates, certCount, affcCyclCd, equipmentName, manufacturer, model, hasMultiQ, activeTab])

  if (overallResult.prediction.direction === 'insufficient') return null

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">AI 교정 지시서</span>
        </div>

        {llmStatus === 'done' && (
          <span className="text-[9px] text-indigo-300 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">AI 인사이트</span>
        )}
        {llmStatus === 'idle' && (
          <button
            onClick={requestAi}
            className="flex items-center gap-1.5 text-[11px] text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            AI 인사이트 요청
          </button>
        )}
        {llmStatus === 'loading' && (
          <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            AI 인사이트 생성 중...
          </div>
        )}
        {llmStatus === 'error' && (
          <button
            onClick={requestAi}
            className="flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            재시도
          </button>
        )}
      </div>

      {/* 물리량 탭 */}
      {hasMultiQ && (
        <div className="flex gap-1 mb-4 bg-gray-50 rounded-lg p-1">
          {tabs.map(q => (
            <button
              key={q}
              onClick={() => setActiveTab(q)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === q ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {quantityLabel(q)}
            </button>
          ))}
        </div>
      )}

      {/* AI 호출 전: 빈 상태 */}
      {!instruction && llmStatus !== 'loading' && (
        <div className="text-center py-6 text-slate-300">
          <p className="text-xs">AI 인사이트를 요청하면 포인트별 교정 지시서가 생성됩니다</p>
        </div>
      )}

      {/* 로딩 중 */}
      {llmStatus === 'loading' && !instruction && (
        <div className="text-center py-6 text-slate-300">
          <svg className="animate-spin h-5 w-5 mx-auto mb-2 text-indigo-300" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-xs">AI 인사이트 생성 중...</p>
        </div>
      )}

      {/* AI 결과 */}
      {instruction && <InstructionContent instruction={instruction} />}
    </div>
  )
}
