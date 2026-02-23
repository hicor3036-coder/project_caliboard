'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import type { TrendSeries } from '@/lib/equipment-health'
import { analyzeEquipmentHealth, buildCalibrationInstructionInput } from '@/lib/equipment-health'

// ─── Props ───

interface Props {
  series: TrendSeries[]
  calDates: string[]
  certCount: number
  affcCyclCd: string | null
  equipmentName: string
  manufacturer: string
  model: string
}

// ─── LLM 응답 타입 ───

interface AiPoint {
  label: string
  level: string
  levelLabel: string
  priority: string
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

// ─── 메인 패널 ───

export default function CalibrationInstructionPanel({
  series, calDates, certCount, affcCyclCd,
  equipmentName, manufacturer, model,
}: Props) {
  const result = useMemo(
    () => analyzeEquipmentHealth(series, calDates, certCount, affcCyclCd),
    [series, calDates, certCount, affcCyclCd],
  )

  const [instruction, setInstruction] = useState<AiInstruction | null>(null)
  const [llmStatus, setLlmStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  useEffect(() => {
    setInstruction(null)
    setLlmStatus('idle')
  }, [result])

  const requestAi = useCallback(async () => {
    if (result.prediction.direction === 'insufficient') return
    setLlmStatus('loading')
    try {
      const input = buildCalibrationInstructionInput(result, { equipmentName, manufacturer, model })
      const res = await fetch('/api/ai/calibration-instruction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (Array.isArray(data.points)) {
        setInstruction({
          points: data.points,
          schedule: data.schedule ?? [],
          environmentNotes: data.environmentNotes ?? [],
        })
        setLlmStatus('done')
      } else {
        throw new Error('형식 불일치')
      }
    } catch {
      setLlmStatus('error')
    }
  }, [result, equipmentName, manufacturer, model])

  if (result.prediction.direction === 'insufficient') return null

  // 집중 포인트 (high/medium)와 안정 포인트 (low) 분리
  const focusPoints = instruction?.points.filter(p => p.priority !== 'low') ?? []
  const stablePoints = instruction?.points.filter(p => p.priority === 'low') ?? []

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

      {/* AI 호출 전: 빈 상태 */}
      {!instruction && llmStatus !== 'loading' && (
        <div className="text-center py-6 text-slate-300">
          <p className="text-xs">AI 인사이트을 요청하면 포인트별 교정 지시서가 생성됩니다</p>
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
      {instruction && (
        <>
          {/* 집중 관리 포인트 (high/medium) — 강조 카드 */}
          {focusPoints.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {focusPoints.map((pt, i) => {
                const s = ROW_STYLES[pt.priority] ?? ROW_STYLES.medium
                return (
                  <div key={i} className={`rounded-lg ${s.bg} px-3 py-2.5 border border-transparent`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
                      <span className={`text-xs font-bold ${s.text}`}>{pt.label}</span>
                      <span className={`text-[10px] ${s.text} opacity-70`}>{pt.levelLabel}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug">{pt.reason}</p>
                    <p className="text-[11px] text-slate-800 font-medium mt-0.5">{pt.action}</p>
                  </div>
                )
              })}
            </div>
          )}

          {/* 안정 포인트 (low) — 압축 테이블 */}
          {stablePoints.length > 0 && (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-400">
                    <th className="text-left px-3 py-1.5 font-medium">포인트</th>
                    <th className="text-left px-3 py-1.5 font-medium">상태</th>
                    <th className="text-left px-3 py-1.5 font-medium">조치</th>
                  </tr>
                </thead>
                <tbody>
                  {stablePoints.map((pt, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 text-slate-600 font-medium">{pt.label}</td>
                      <td className="px-3 py-1.5 text-slate-400">{pt.reason}</td>
                      <td className="px-3 py-1.5 text-slate-400">{pt.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 안정 포인트만 있는 경우 메시지 */}
          {focusPoints.length === 0 && stablePoints.length > 0 && (
            <p className="text-[11px] text-emerald-500 font-medium mt-2">전 포인트 안정 — 특별 주의 포인트 없음</p>
          )}

          {/* 재점검 + 주의사항 — 한 줄로 */}
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
      )}
    </div>
  )
}
