'use client'

import { useMemo, useState, useCallback } from 'react'
import type { TrendSeries } from '@/lib/equipment-health'
import { analyzeEquipmentHealth, buildCalibrationInstructionInput } from '@/lib/equipment-health'
import { useT, fmt } from '@/lib/i18n'

// ─── Props ───

interface Props {
  series: TrendSeries[]
  calDates: string[]
  certCount: number
  affcCyclCd: string | null
  equipmentName: string
  manufacturer: string
  model: string
  quantityLabel?: string  // 선택된 물리량 라벨 (TabPreventive에서 전달)
  embedded?: boolean
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

// ─── 그룹 설정 ───

const GROUPS: { level: string; priority: string; labelKey: 'precision' | 'standard' | 'normal'; dot: string; bg: string; text: string; headerBg: string }[] = [
  { level: 'precision', priority: 'high',   labelKey: 'precision', dot: 'bg-red-500',     bg: 'bg-red-50',    text: 'text-red-700',   headerBg: 'bg-red-100 text-red-800' },
  { level: 'standard',  priority: 'medium', labelKey: 'standard',  dot: 'bg-amber-400',   bg: 'bg-amber-50',  text: 'text-amber-700', headerBg: 'bg-amber-100 text-amber-800' },
  { level: 'observation', priority: 'low',  labelKey: 'normal',    dot: 'bg-emerald-400', bg: '',              text: 'text-slate-500', headerBg: 'bg-emerald-100 text-emerald-800' },
]

// ─── 결과 렌더링 서브컴포넌트 ───

function InstructionContent({ instruction }: { instruction: AiInstruction }) {
  const { t } = useT()
  // 우선순위별 그룹핑 (precision → standard → observation)
  const grouped = GROUPS.map(g => ({
    ...g,
    label: t.instruction[g.labelKey],
    points: instruction.points.filter(p => p.level === g.level || p.priority === g.priority),
  })).filter(g => g.points.length > 0)

  // observation이 아닌 그룹이 하나도 없으면 전 포인트 안정
  const allStable = grouped.every(g => g.level === 'observation')

  return (
    <>
      {grouped.map(group => {
        // observation(정상) 그룹은 컴팩트 칩 UI
        if (group.level === 'observation') {
          return (
            <div key={group.level} className="mt-2">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${group.dot} shrink-0`} />
                <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                  {t.instruction.normal} ({group.points.length})
                </span>
                <span className="text-xs text-slate-400">{t.instruction.normalSummary}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-4">
                {group.points.map((pt, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md border border-emerald-100">
                    <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {pt.label}
                  </span>
                ))}
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
              <span className={`text-xs font-bold ${group.headerBg} px-2 py-0.5 rounded`}>
                {group.label} ({fmt(t.instruction.groupCount, group.points.length)})
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
                      <span className={`text-sm font-bold ${group.text}`}>{pt.label}</span>
                      {headline && (
                        <span className="text-sm text-slate-800 font-bold ml-2">— {headline}</span>
                      )}
                    </div>
                    {/* 수치 근거 */}
                    {reason && <p className="text-sm text-slate-500 leading-snug">{reason}</p>}
                    {/* 조치 — 시각적 분리 */}
                    <div className="mt-2 pt-1.5 border-t border-black/5 flex gap-1.5 items-start">
                      <span className="text-xs font-bold text-slate-400 mt-px shrink-0">▶</span>
                      <p className="text-sm text-slate-800 font-medium leading-snug">{pt.action}</p>
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
        <p className="text-sm text-emerald-500 font-medium mt-1">{t.instruction.allStable}</p>
      )}

      {/* 재점검 + 주의사항 */}
      {(instruction.schedule.length > 0 || instruction.environmentNotes.length > 0) && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
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
  quantityLabel: qLabel,
  embedded = false,
}: Props) {
  const { t } = useT()

  const overallResult = useMemo(
    () => analyzeEquipmentHealth(series, calDates, certCount, affcCyclCd),
    [series, calDates, certCount, affcCyclCd],
  )

  // series 키별 캐싱 (물리량 탭 전환 시 유지)
  const seriesKey = useMemo(() => series.map(s => s.label).join('|'), [series])
  const [cache, setCache] = useState<Record<string, { instruction: AiInstruction | null; status: 'idle' | 'loading' | 'done' | 'error' }>>({})

  const cached = cache[seriesKey]
  const instruction = cached?.instruction ?? null
  const llmStatus = cached?.status ?? 'idle'

  const setCacheForKey = useCallback((update: Partial<{ instruction: AiInstruction | null; status: 'idle' | 'loading' | 'done' | 'error' }>) => {
    setCache(prev => ({
      ...prev,
      [seriesKey]: { instruction: prev[seriesKey]?.instruction ?? null, status: prev[seriesKey]?.status ?? 'idle', ...update },
    }))
  }, [seriesKey])

  const requestAi = useCallback(async () => {
    if (overallResult.prediction.direction === 'insufficient') return

    setCacheForKey({ status: 'loading' })
    try {
      const result = analyzeEquipmentHealth(series, calDates, certCount, affcCyclCd)
      const input = buildCalibrationInstructionInput(result, { equipmentName, manufacturer, model })
      if (qLabel) input.quantityLabel = qLabel
      const res = await fetch('/api/ai/calibration-instruction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (Array.isArray(data.points)) {
        setCacheForKey({
          instruction: {
            points: data.points,
            schedule: data.schedule ?? [],
            environmentNotes: data.environmentNotes ?? [],
          },
          status: 'done',
        })
      } else {
        throw new Error('형식 불일치')
      }
    } catch {
      setCacheForKey({ status: 'error' })
    }
  }, [overallResult, series, calDates, certCount, affcCyclCd, equipmentName, manufacturer, model, qLabel, setCacheForKey])

  if (overallResult.prediction.direction === 'insufficient') return null

  return (
    <div className={embedded ? '' : 'bg-white rounded-xl shadow-sm border border-gray-100 p-6'}>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{t.instruction.title}</span>
        </div>

        {llmStatus === 'done' && (
          <span className="text-[9px] text-indigo-300 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">{t.instruction.aiInsight}</span>
        )}
        {llmStatus === 'idle' && (
          <button
            onClick={requestAi}
            className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t.instruction.requestAi}
          </button>
        )}
        {llmStatus === 'loading' && (
          <div className="flex items-center gap-1.5 text-xs text-indigo-400">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t.instruction.aiLoading}
          </div>
        )}
        {llmStatus === 'error' && (
          <button
            onClick={requestAi}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {t.instruction.retry}
          </button>
        )}
      </div>

      {/* AI 호출 전: 빈 상태 */}
      {!instruction && llmStatus !== 'loading' && (
        <div className="text-center py-6 text-slate-300">
          <p className="text-sm">{t.instruction.emptyState}</p>
        </div>
      )}

      {/* 로딩 중 */}
      {llmStatus === 'loading' && !instruction && (
        <div className="text-center py-6 text-slate-300">
          <svg className="animate-spin h-5 w-5 mx-auto mb-2 text-indigo-300" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm">{t.instruction.aiLoading}</p>
        </div>
      )}

      {/* AI 결과 */}
      {instruction && <InstructionContent instruction={instruction} />}
    </div>
  )
}
