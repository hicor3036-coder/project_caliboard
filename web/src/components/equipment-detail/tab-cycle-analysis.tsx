// 교정주기 분석 탭 (Phase G — 실무 적용형)
//
// 기존 'AI 예방분석' 탭과 완전 별개. 기존 UI/로직 영향 0.
// 5단계 추론을 카드로 분리해 사용자가 "왜 이 주기인지" 납득 가능하게 표시.
//
// 1차 구현 범위:
//   - 1단계 (기준 주기): 완전 구현 — equipment_profiles + affcCyclCd 활용
//   - 2단계 (드리프트):   스켈레톤 — "다음 단계에서 추가" 표시
//   - 3단계 (불확도):     스켈레톤
//   - 5단계 (최종 결정):  step1만으로도 결과 표시 (조정 0)
//   - AI 종합:            1차 제외 (다음 단계)

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  runCycleAnalysis,
  type CycleAnalysisResult,
  type ProfileLike,
  type StepResult,
  type BaselineData,
  type TrendDriftData,
  type UncertaintyRiskData,
} from '@/lib/cycle-analysis'
import type { TrendSeries } from '@/lib/equipment-health'

interface Props {
  manufacturer: string         // info.prdnCmpnNm
  model: string                // info.stszNm
  ktoolsAffcCyclCd: string     // info.affcCyclCd
  series: TrendSeries[]        // conformityTrend.series (있으면)
  calDates: string[]           // conformityTrend.calDates (있으면)
}

export default function TabCycleAnalysis({
  manufacturer,
  model,
  ktoolsAffcCyclCd,
  series,
  calDates,
}: Props) {
  // ── profile 페치 (이 탭이 진입했을 때만) ──
  const [profile, setProfile] = useState<ProfileLike | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    if (!manufacturer || !model) {
      setProfileLoading(false)
      return
    }
    let cancelled = false
    setProfileLoading(true)
    setProfileError(null)
    fetch(`/api/supabase/profiles?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}`)
      .then(async r => {
        if (cancelled) return
        if (r.status === 404) {
          setProfile(null)
          return
        }
        if (!r.ok) {
          setProfileError(`profile 조회 실패: ${r.status}`)
          return
        }
        const data = await r.json()
        setProfile(data as ProfileLike)
      })
      .catch(err => {
        if (!cancelled) setProfileError(err instanceof Error ? err.message : 'profile 조회 실패')
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })
    return () => { cancelled = true }
  }, [manufacturer, model])

  // ── 분석 실행 ──
  const analysis = useMemo<CycleAnalysisResult>(() => {
    return runCycleAnalysis({
      profile,
      ktoolsAffcCyclCd,
      series,
      calDates,
    })
  }, [profile, ktoolsAffcCyclCd, series, calDates])

  // 한 줄 요약 메시지 (결정 영역에 표시 — 사용자가 결과를 즉시 이해하도록)
  const summaryMessage = buildSummaryMessage(analysis)

  return (
    <div className="space-y-8">
      {/* ════════════════════════════════════════════════════════ */}
      {/* 결정 영역 (Decision)                                       */}
      {/* ════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader
          icon="decision"
          title="권고 결정"
          subtitle="5단계 분석 종합 결과"
        />
        <FinalRecommendationCard
          analysis={analysis}
          loading={profileLoading}
          summaryMessage={summaryMessage}
        />
      </section>

      {/* ════════════════════════════════════════════════════════ */}
      {/* 근거 영역 (Evidence)                                       */}
      {/* ════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader
          icon="evidence"
          title="분석 근거"
          subtitle="각 단계의 데이터와 산출 과정"
        />

        <div className="space-y-3">
          <StepCard
            number={1}
            title="기준 주기"
            subtitle="제조사 권장 → k-tools 등록 → 기본 가정 순"
            adjustment={analysis.step1.adjustment}
            isBase={true}
            baseMonths={analysis.step1.data.baseMonths}
            reasons={analysis.step1.reasons}
            warnings={analysis.step1.warnings}
            confidence={analysis.step1.confidence}
          >
            <BaselineDetails data={analysis.step1.data} loading={profileLoading} error={profileError} />
          </StepCard>

          <StepCard
            number={2}
            title="측정 드리프트"
            subtitle="이 장비 고유의 연차별 변화 추세"
            adjustment={analysis.step2.adjustment}
            reasons={analysis.step2.reasons}
            warnings={analysis.step2.warnings}
            confidence={analysis.step2.confidence}
          >
            <TrendDriftDetails data={analysis.step2.data} />
          </StepCard>

          <StepCard
            number={3}
            title="측정 불확도 위험"
            subtitle="Guard Band 분포 + U/T 비율"
            adjustment={analysis.step3.adjustment}
            reasons={analysis.step3.reasons}
            warnings={analysis.step3.warnings}
            confidence={analysis.step3.confidence}
          >
            <UncertaintyRiskDetails data={analysis.step3.data} />
          </StepCard>

          <StepCard
            number={4}
            title="사용 컨텍스트"
            subtitle="사용빈도 / 환경 / 안전등급 (담당자 입력)"
            adjustment={0}
            reasons={[]}
            warnings={[]}
            confidence="low"
            placeholder
          />

          <StepCard
            number={5}
            title="최종 결정"
            subtitle="1~4단계 종합 + 가드레일 적용"
            adjustment={analysis.step5.adjustment}
            isFinal={true}
            reasons={analysis.step5.reasons}
            warnings={analysis.step5.warnings}
            confidence={analysis.step5.confidence}
          >
            <FinalBreakdown analysis={analysis} />
          </StepCard>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════ */}
      {/* AI 종합 평가 (Placeholder)                                  */}
      {/* ════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader
          icon="ai"
          title="AI 종합 평가"
          subtitle="다음 단계에서 추가"
          muted
        />
        <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-400 leading-relaxed">
            5단계 결과를 LLM에 보내 자연어 종합 평가 + 돌발 상황 판단을 받습니다.
            <br />
            예: <span className="italic">&ldquo;제조사 권장 주기와 일치하며 측정 추세도 안정적입니다. 현행 유지를 권고합니다.&rdquo;</span>
          </p>
        </div>
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 최종 권고 카드 (상단)
// ─────────────────────────────────────────────────────────────────

function FinalRecommendationCard({
  analysis,
  loading,
  summaryMessage,
}: {
  analysis: CycleAnalysisResult
  loading: boolean
  summaryMessage: string
}) {
  const final = analysis.step5.data
  const directionColor =
    final.direction === 'shorten' ? 'text-rose-700 bg-rose-50 border-rose-300' :
    final.direction === 'extend' ? 'text-emerald-700 bg-emerald-50 border-emerald-300' :
    'text-slate-700 bg-slate-50 border-slate-300'
  const directionLabel =
    final.direction === 'shorten' ? '단축 권고' :
    final.direction === 'extend' ? '연장 검토' :
    '현행 유지'

  const confLabel = final.confidence === 'high' ? '높음' : final.confidence === 'medium' ? '보통' : '낮음'
  const confColor =
    final.confidence === 'high' ? 'text-emerald-700 bg-emerald-100' :
    final.confidence === 'medium' ? 'text-amber-700 bg-amber-100' :
    'text-slate-600 bg-slate-100'

  return (
    <div className="bg-gradient-to-br from-blue-50 via-white to-white border-2 border-blue-300 rounded-2xl shadow-md overflow-hidden">
      {/* 상단: 권고 주기 큰 표시 + 방향 배지 */}
      <div className="px-6 pt-6 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] text-blue-600/70 font-bold uppercase tracking-widest mb-1">RECOMMENDED CYCLE</div>
            <div className="flex items-baseline gap-3">
              {loading ? (
                <span className="h-14 w-32 bg-slate-100 rounded animate-pulse" />
              ) : (
                <>
                  <span className="text-6xl font-bold text-blue-700 leading-none">{final.finalMonths}</span>
                  <span className="text-2xl text-slate-500 font-medium">개월</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border-2 ${directionColor}`}>
              {final.direction === 'shorten' && '↓'}
              {final.direction === 'extend' && '↑'}
              {final.direction === 'maintain' && '='}
              {directionLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">신뢰도</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${confColor}`}>{confLabel}</span>
            </div>
          </div>
        </div>

        {/* 한 줄 요약 메시지 */}
        {!loading && (
          <div className="mt-4 pt-4 border-t border-blue-100">
            <p className="text-sm text-slate-700 leading-relaxed">
              <span className="text-blue-500 mr-1">💬</span>
              {summaryMessage}
            </p>
          </div>
        )}
      </div>

      {/* 하단: 계산 요약 (기준 + 조정 = 권고) */}
      <div className="bg-white/70 border-t border-blue-100 px-6 py-3">
        <div className="flex items-center justify-center gap-3 text-sm">
          <span className="text-slate-400 text-[10px] uppercase tracking-wide mr-1">계산</span>
          <CalcChip label="기준" value={`${final.breakdown.base}`} />
          <span className="text-slate-300">+</span>
          <CalcChip
            label="조정"
            value={`${analysis.step5.adjustment > 0 ? '+' : ''}${analysis.step5.adjustment}`}
            tone={analysis.step5.adjustment < 0 ? 'rose' : analysis.step5.adjustment > 0 ? 'emerald' : 'slate'}
          />
          <span className="text-slate-300">=</span>
          <CalcChip label="권고" value={`${final.finalMonths}`} primary />
        </div>
      </div>

      {final.guardrail.clamped && (
        <div className="mx-6 mb-5 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-700 flex items-start gap-2">
          <span className="mt-0.5">⚠</span>
          <span>가드레일 적용: {final.guardrail.minMonths}~{final.guardrail.maxMonths}개월 범위로 제한 (원본 합계 {final.breakdown.sum}개월)</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 단계 카드 (공통)
// ─────────────────────────────────────────────────────────────────

interface StepCardProps {
  number: number
  title: string
  subtitle: string
  adjustment: number
  isBase?: boolean
  isFinal?: boolean
  baseMonths?: number
  reasons: string[]
  warnings: string[]
  confidence: 'high' | 'medium' | 'low'
  placeholder?: boolean
  children?: React.ReactNode
}

function StepCard({ number, title, subtitle, adjustment, isBase, isFinal, baseMonths, reasons, warnings, confidence, placeholder, children }: StepCardProps) {
  // 기본 펼침: 1단계(기준), 5단계(최종)는 자동 펼침. placeholder는 접힘.
  const [expanded, setExpanded] = useState(!placeholder && (isBase || isFinal))

  const valueColor = placeholder ? 'text-slate-300' : adjustment < 0 ? 'text-rose-600' : adjustment > 0 ? 'text-emerald-600' : 'text-slate-700'
  const valueText = isBase
    ? `${baseMonths ?? 0}개월`
    : isFinal
    ? `${(baseMonths ?? 0) + adjustment}개월`
    : placeholder
    ? '—'
    : `${adjustment > 0 ? '+' : ''}${adjustment}개월`

  const borderClass = placeholder ? 'border-slate-100' : isFinal ? 'border-blue-300 shadow-sm' : isBase ? 'border-blue-200' : 'border-slate-200'
  const bgClass = placeholder ? 'bg-slate-50/40' : 'bg-white'

  return (
    <div className={`${bgClass} border ${borderClass} rounded-xl overflow-hidden transition-all`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
          placeholder ? 'hover:bg-slate-100/50' : 'hover:bg-slate-50'
        }`}
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          placeholder ? 'bg-slate-100 text-slate-400' :
          isFinal ? 'bg-blue-600 text-white' :
          isBase ? 'bg-blue-100 text-blue-700' :
          'bg-slate-100 text-slate-600'
        }`}>
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${placeholder ? 'text-slate-400' : 'text-slate-800'}`}>{title}</span>
            {!placeholder && (
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                confidence === 'high' ? 'bg-emerald-100 text-emerald-700' :
                confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                'bg-slate-100 text-slate-500'
              }`}>
                신뢰도 {confidence === 'high' ? '높음' : confidence === 'medium' ? '보통' : '낮음'}
              </span>
            )}
            {placeholder && (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">미구현</span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`text-sm font-bold ${valueColor}`}>{valueText}</div>
        </div>
        <svg className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/30">
          {/* 근거 배지 */}
          {reasons.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                  <span className="text-slate-400 mt-0.5">•</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}

          {/* 경고 */}
          {warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                  <span className="text-amber-500 mt-0.5">⚠</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* 단계별 상세 */}
          {children && <div className="mt-4 pt-4 border-t border-slate-100">{children}</div>}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 1단계 상세 (Baseline)
// ─────────────────────────────────────────────────────────────────

function BaselineDetails({ data, loading, error }: { data: BaselineData; loading: boolean; error: string | null }) {
  if (loading) {
    return <p className="text-xs text-slate-400">사양서 조회 중…</p>
  }
  if (error) {
    return <p className="text-xs text-rose-500">{error}</p>
  }

  // 출처 표시 (어디서 가져왔는지 시각화)
  const sourceFlow: { label: string; active: boolean; ok: boolean }[] = [
    {
      label: '제조사 권장',
      active: data.source === 'profile_recommended',
      ok: data.rawProfileValue != null,
    },
    {
      label: 'k-tools 등록',
      active: data.source === 'ktools_registered',
      ok: data.rawKtoolsValue != null,
    },
    {
      label: '기본 가정',
      active: data.source === 'default_fallback',
      ok: true, // fallback은 항상 가능
    },
  ]

  return (
    <div className="space-y-4">
      {/* ─── 상단: 큰 메트릭 박스 ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <MetricBox
          label="기준 주기"
          value={`${data.baseMonths}`}
          unit="개월"
          primary
        />
        <MetricBox
          label="출처"
          value={data.sourceLabel}
          unit=""
          textValue
        />
        <MetricBox
          label="장비군"
          value={data.profileCategory ?? '미등록'}
          unit=""
          textValue
          muted={!data.profileCategory}
        />
      </div>

      {/* ─── 출처 우선순위 흐름 ─── */}
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1">
          <span>출처 우선순위</span>
          <span className="text-slate-300">(왼쪽일수록 신뢰도 높음)</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {sourceFlow.map((s, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                s.active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : s.ok
                  ? 'bg-white text-slate-600 border-slate-200'
                  : 'bg-slate-50 text-slate-300 border-slate-100 line-through'
              }`}>
                {s.active && <span className="mr-1">✓</span>}
                {s.label}
              </span>
              {i < sourceFlow.length - 1 && (
                <span className="text-slate-300 text-xs">→</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ─── 데이터 그리드 ─── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs bg-slate-50 rounded-lg p-3">
        {data.rawProfileValue ? (
          <DataPair label="제조사 권장값" value={data.rawProfileValue} positive />
        ) : (
          <DataPair label="제조사 권장값" value="—" />
        )}
        {data.rawKtoolsValue ? (
          <DataPair label="k-tools 등록값" value={`${data.rawKtoolsValue}개월`} positive />
        ) : (
          <DataPair label="k-tools 등록값" value="—" />
        )}
      </div>

      {/* ─── 적용 표준 ─── */}
      {data.profileStandards.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">적용 표준</div>
          <div className="flex flex-wrap gap-1.5">
            {data.profileStandards.map((s, i) => (
              <span key={i} className="text-[11px] px-2 py-1 bg-blue-50 text-blue-700 rounded-md border border-blue-200 font-medium">
                📖 {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 2단계 상세 (Trend Drift)
// ─────────────────────────────────────────────────────────────────

function TrendDriftDetails({ data }: { data: TrendDriftData }) {
  // 데이터 부족 (3회 미만 이력)
  if (!data.dataQuality.enoughHistory) {
    return (
      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="font-medium text-amber-700 mb-1">📊 데이터 부족</div>
        <p>
          최대 시계열 길이 {data.dataQuality.historyLength}회. 추세 분석은 최소 3회 이력이 있어야 신뢰할 수 있습니다.
          다음 교정 완료 후 재평가를 권장합니다.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 요약 메트릭 박스 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <RiskMetricBox
          label="긴급"
          count={data.summary.urgentPointCount}
          total={data.points.length}
          tone="rose"
        />
        <RiskMetricBox
          label="주의"
          count={data.summary.watchPointCount}
          total={data.points.length}
          tone="amber"
        />
        <RiskMetricBox
          label="안정"
          count={data.summary.safePointCount}
          total={data.points.length}
          tone="emerald"
        />
        <RiskMetricBox
          label="가속 진행"
          count={data.summary.acceleratingCount}
          total={data.points.length}
          tone="purple"
        />
      </div>

      {/* 최대 한계 사용률 */}
      {data.summary.maxLatestRatio != null && (
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">최신 한계 사용률 (전 포인트 중 최댓값)</div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-slate-700">{data.summary.maxLatestRatio.toFixed(1)}%</span>
            <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  data.summary.maxLatestRatio >= 95 ? 'bg-rose-500' :
                  data.summary.maxLatestRatio >= 80 ? 'bg-amber-500' :
                  data.summary.maxLatestRatio >= 50 ? 'bg-emerald-500' :
                  'bg-emerald-300'
                }`}
                style={{ width: `${Math.min(100, data.summary.maxLatestRatio)}%` }}
              />
            </div>
            <div className="text-[10px] text-slate-400 w-12 text-right">80% / 95%</div>
          </div>
        </div>
      )}

      {/* 포인트별 상세 */}
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">포인트별 추세 ({data.points.length}개)</div>
        <div className="space-y-2">
          {data.points.map((p, i) => (
            <PointDriftRow key={i} point={p} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RiskMetricBox({
  label,
  count,
  total,
  tone,
}: {
  label: string
  count: number
  total: number
  tone: 'rose' | 'amber' | 'emerald' | 'purple'
}) {
  const muted = count === 0
  const cls = muted
    ? 'bg-slate-50 border-slate-200 text-slate-400'
    : tone === 'rose' ? 'bg-rose-50 border-rose-200 text-rose-700'
    : tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-700'
    : tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : 'bg-purple-50 border-purple-200 text-purple-700'
  return (
    <div className={`px-3 py-2 border rounded-lg ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold">{count}</span>
        <span className="text-[10px] opacity-60">/ {total}</span>
      </div>
    </div>
  )
}

function PointDriftRow({ point }: { point: import('@/lib/cycle-analysis').PointDriftAnalysis }) {
  const trendIcon = point.trend === 'rising' ? '↗' : point.trend === 'falling' ? '↘' : point.trend === 'volatile' ? '⚡' : '→'
  const trendColor =
    point.trend === 'rising' ? 'text-rose-500' :
    point.trend === 'falling' ? 'text-emerald-500' :
    point.trend === 'volatile' ? 'text-purple-500' :
    'text-slate-400'
  const riskBadge =
    point.riskLevel === 'urgent' ? { label: '긴급', cls: 'bg-rose-100 text-rose-700' } :
    point.riskLevel === 'watch' ? { label: '주의', cls: 'bg-amber-100 text-amber-700' } :
    { label: '안정', cls: 'bg-emerald-100 text-emerald-700' }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${riskBadge.cls}`}>{riskBadge.label}</span>
        <span className="text-xs font-medium text-slate-700 truncate flex-1">{point.label}</span>
        <span className={`text-base ${trendColor}`} title={`추세: ${point.trend}`}>{trendIcon}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <DataMini label="최신" value={point.latestRatio != null ? `${point.latestRatio.toFixed(1)}%` : '—'} />
        <DataMini
          label="한계근접"
          value={`${point.nearLimitCount}/${point.totalCount}회`}
          highlight={point.nearLimitCount >= 2}
        />
        <DataMini
          label="가속"
          value={point.accelerating ? `${point.accelerationRatio?.toFixed(1) ?? '?'}배 ⚡` : '—'}
          highlight={point.accelerating}
        />
        <DataMini label="이력" value={`${point.totalCount}회`} />
      </div>

      {/* 시계열 미니 시각화 */}
      {point.ratioHistory.length >= 2 && <MiniSparkline values={point.ratioHistory} />}
    </div>
  )
}

function DataMini({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[9px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`font-semibold ${highlight ? 'text-rose-600' : 'text-slate-700'}`}>{value}</div>
    </div>
  )
}

/**
 * 한계 사용률 미니 sparkline — 시계열의 변화를 직관적으로 표시
 */
function MiniSparkline({ values }: { values: number[] }) {
  const max = Math.max(100, ...values)
  const min = Math.min(0, ...values)
  const range = max - min || 1
  const width = 100
  const height = 28
  const padding = 2

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - 2 * padding)
    const y = padding + (1 - (v - min) / range) * (height - 2 * padding)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // 80% 경계선의 y 좌표
  const y80 = padding + (1 - (80 - min) / range) * (height - 2 * padding)
  // 95% 경계선의 y 좌표
  const y95 = padding + (1 - (95 - min) / range) * (height - 2 * padding)

  return (
    <div className="mt-2">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block">
        {/* 80% 경계선 */}
        {y80 >= 0 && y80 <= height && (
          <line x1={0} y1={y80} x2={width} y2={y80} stroke="#fbbf24" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />
        )}
        {/* 95% 경계선 */}
        {y95 >= 0 && y95 <= height && (
          <line x1={0} y1={y95} x2={width} y2={y95} stroke="#ef4444" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />
        )}
        {/* 시계열 */}
        <polyline
          points={points}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 마지막 점 */}
        {values.length > 0 && (() => {
          const lastV = values[values.length - 1]
          const lastX = padding + (width - 2 * padding)
          const lastY = padding + (1 - (lastV - min) / range) * (height - 2 * padding)
          const color = lastV >= 95 ? '#ef4444' : lastV >= 80 ? '#f59e0b' : '#3b82f6'
          return <circle cx={lastX} cy={lastY} r="1.8" fill={color} />
        })()}
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 3단계 상세 (Uncertainty Risk)
// ─────────────────────────────────────────────────────────────────

function UncertaintyRiskDetails({ data }: { data: UncertaintyRiskData }) {
  // 데이터 부족
  if (!data.dataQuality.enoughHistory) {
    return (
      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="font-medium text-amber-700 mb-1">📊 데이터 부족</div>
        <p>이력 {data.dataQuality.historyLength}회 — 불확도 위험 평가에 최소 2회 이력 필요</p>
      </div>
    )
  }

  // Guard Band 데이터 자체가 없음
  if (!data.summary.hasGuardBandData) {
    return (
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="font-medium text-slate-600 mb-1">ℹ️ Guard Band 데이터 없음</div>
        <p>성적서에 불확도 정보가 기재되지 않아 정량 위험 평가가 어렵습니다. 다음 교정 시 불확도 보고를 요청하세요.</p>
      </div>
    )
  }

  const total = data.overall.total

  return (
    <div className="space-y-5">
      {/* ─── 섹션 1: 종합 위험 신호 (가장 중요) ─── */}
      <SignalsSection data={data} />

      {/* ─── 섹션 2: Guard Band 누적 분포 ─── */}
      <GuardBandDistributionSection data={data} total={total} />

      {/* ─── 섹션 3: 포인트별 U/T 비율 ─── */}
      <div>
        <SubsectionHeader
          icon="📈"
          title="포인트별 U/T 비율"
          subtitle={`위험도 순 — 측정 포인트 ${data.points.length}개`}
        />
        <PointsSection points={data.points} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 섹션 헤더 (③ 카드 내부 서브 섹션용)
// ─────────────────────────────────────────────────────────────────

function SubsectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-base">{icon}</span>
      <div>
        <h4 className="text-xs font-bold text-slate-700">{title}</h4>
        <p className="text-[10px] text-slate-400">{subtitle}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 종합 위험 신호 (3개 큰 메트릭)
// ─────────────────────────────────────────────────────────────────

function SignalsSection({ data }: { data: UncertaintyRiskData }) {
  // 각 메트릭의 판정/색상 결정
  const utValue = data.summary.maxUtRatioOverall
  const utTone: SignalTone =
    utValue == null ? 'slate' :
    utValue > 50 ? 'rose' :
    utValue > 33 ? 'amber' :
    'emerald'
  const utJudgment =
    utValue == null ? '데이터 없음' :
    utValue > 50 ? '시스템 점검 필요' :
    utValue > 33 ? '높음' :
    utValue > 25 ? '일반적 수준' :
    '양호'

  const dangerCount = data.summary.pointsWithRecentDanger
  const dangerTone: SignalTone = dangerCount > 0 ? 'rose' : 'emerald'
  const dangerJudgment = dangerCount > 0 ? `${dangerCount}개 포인트 주의` : '양호'

  const cpRatio = data.summary.conditionalPassRatio
  const cpTone: SignalTone =
    cpRatio >= 30 ? 'rose' :
    cpRatio > 0 ? 'amber' :
    'emerald'
  const cpJudgment =
    cpRatio >= 30 ? '높음' :
    cpRatio > 0 ? '일부 경계' :
    '없음'

  return (
    <div>
      <SubsectionHeader
        icon="🛡️"
        title="종합 위험 신호"
        subtitle="이 장비의 측정 불확도 상태"
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <SignalCard
          label="최신 U/T 최댓값"
          value={utValue != null ? `${utValue.toFixed(1)}%` : '—'}
          judgment={utJudgment}
          tone={utTone}
          hint="허용오차 대비 측정 불확도"
        />
        <SignalCard
          label="최근 위험 판정"
          value={`${dangerCount}`}
          unit="포인트"
          judgment={dangerJudgment}
          tone={dangerTone}
          hint="실질 위험/부적합 발생"
        />
        <SignalCard
          label="경계 누적 비율"
          value={`${cpRatio.toFixed(1)}%`}
          judgment={cpJudgment}
          tone={cpTone}
          hint="불확도 감안 시 초과 가능"
        />
      </div>
    </div>
  )
}

type SignalTone = 'rose' | 'amber' | 'emerald' | 'slate'

function SignalCard({
  label,
  value,
  unit,
  judgment,
  tone,
  hint,
}: {
  label: string
  value: string
  unit?: string
  judgment: string
  tone: SignalTone
  hint: string
}) {
  const styles =
    tone === 'rose'
      ? { card: 'bg-gradient-to-br from-rose-50 to-white border-rose-200', label: 'text-rose-700', value: 'text-rose-700', badge: 'bg-rose-100 text-rose-700', icon: '❌' }
      : tone === 'amber'
      ? { card: 'bg-gradient-to-br from-amber-50 to-white border-amber-200', label: 'text-amber-700', value: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', icon: '⚠' }
      : tone === 'emerald'
      ? { card: 'bg-gradient-to-br from-emerald-50 to-white border-emerald-200', label: 'text-emerald-700', value: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700', icon: '✓' }
      : { card: 'bg-slate-50 border-slate-200', label: 'text-slate-500', value: 'text-slate-500', badge: 'bg-slate-100 text-slate-500', icon: '—' }

  return (
    <div className={`border rounded-xl p-3 ${styles.card}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${styles.label}`}>{label}</div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className={`text-2xl font-bold ${styles.value}`}>{value}</span>
        {unit && <span className="text-xs text-slate-500 font-medium">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${styles.badge}`}>
          <span className="mr-0.5">{styles.icon}</span>
          {judgment}
        </span>
      </div>
      <p className="text-[10px] text-slate-400 leading-tight">{hint}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Guard Band 누적 분포 (수평 바 + 값)
// ─────────────────────────────────────────────────────────────────

function GuardBandDistributionSection({ data, total }: { data: UncertaintyRiskData; total: number }) {
  const rows: { color: string; label: string; count: number; tone: 'safe' | 'warn' | 'danger' | 'neutral' }[] = [
    { color: 'bg-emerald-400', label: '완전 합격', count: data.overall.conformant, tone: 'safe' },
    { color: 'bg-amber-300',   label: '경계 합격', count: data.overall.conditionalPass, tone: 'warn' },
    { color: 'bg-rose-400',    label: '실질 위험', count: data.overall.conditionalFail, tone: 'danger' },
    { color: 'bg-rose-700',    label: '명백 부적합', count: data.overall.nonConformant, tone: 'danger' },
    { color: 'bg-slate-300',   label: '미기재',    count: data.overall.unknown, tone: 'neutral' },
  ]

  // 값이 있는 행만 + 큰 순서로 정렬
  const visibleRows = rows.filter(r => r.count > 0).sort((a, b) => b.count - a.count)

  return (
    <div>
      <SubsectionHeader
        icon="📊"
        title="Guard Band 누적 분포"
        subtitle={`전 이력 ${total}회 측정 — ILAC G-8 기반 4단계 판정`}
      />
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="space-y-2">
          {visibleRows.map(row => {
            const pct = total > 0 ? (row.count / total) * 100 : 0
            const labelColor =
              row.tone === 'safe' ? 'text-emerald-700' :
              row.tone === 'warn' ? 'text-amber-700' :
              row.tone === 'danger' ? 'text-rose-700' :
              'text-slate-500'
            return (
              <div key={row.label} className="flex items-center gap-2 text-[11px]">
                <span className={`w-20 font-semibold shrink-0 ${labelColor}`}>{row.label}</span>
                <div className="flex-1 relative h-5 bg-slate-50 rounded">
                  <div
                    className={`absolute top-0 bottom-0 left-0 rounded ${row.color} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2">
                    <span className={`text-[10px] font-bold ${pct > 25 ? 'text-white' : 'text-slate-700'}`} style={{ textShadow: pct > 25 ? '0 0 2px rgba(0,0,0,0.3)' : 'none' }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <span className="text-slate-500 w-12 text-right shrink-0 font-semibold">{row.count}회</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// 위험도 우선순위 (낮을수록 위험)
function uncertaintyRiskOrder(gb: 'conformant' | 'conditional-pass' | 'conditional-fail' | 'non-conformant' | null, latestUtRatio: number | null): number {
  if (gb === 'non-conformant') return 0
  if (gb === 'conditional-fail') return 1
  if (gb === 'conditional-pass') return 2
  if (latestUtRatio != null && latestUtRatio > 50) return 2
  if (latestUtRatio != null && latestUtRatio > 33) return 3
  if (gb === 'conformant') return 4
  return 5  // 데이터 없음은 맨 뒤
}

function isRiskyPoint(p: import('@/lib/cycle-analysis').PointUncertaintyAnalysis): boolean {
  if (p.latestGuardBand === 'non-conformant') return true
  if (p.latestGuardBand === 'conditional-fail') return true
  if (p.latestGuardBand === 'conditional-pass') return true
  if (p.latestUtRatio != null && p.latestUtRatio > 33) return true
  return false
}

function PointsSection({ points }: { points: import('@/lib/cycle-analysis').PointUncertaintyAnalysis[] }) {
  const [showAllSafe, setShowAllSafe] = useState(false)

  // 위험도 순 정렬
  const sorted = [...points].sort((a, b) => {
    const oa = uncertaintyRiskOrder(a.latestGuardBand, a.latestUtRatio)
    const ob = uncertaintyRiskOrder(b.latestGuardBand, b.latestUtRatio)
    return oa - ob
  })
  const risky = sorted.filter(isRiskyPoint)
  const safe = sorted.filter(p => !isRiskyPoint(p))

  // 차트 스케일 계산 (위험 포인트의 U/T 최댓값 기준)
  const utValues = risky.map(p => p.latestUtRatio).filter((v): v is number => v != null)
  const utMax = utValues.length > 0 ? Math.max(100, ...utValues) : 100

  return (
    <div className="space-y-3">
      {/* 위험/주의 포인트 — 가로 막대 차트 */}
      {risky.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              위험·주의 포인트 ({risky.length})
            </div>
            <div className="text-[10px] text-slate-400">U/T 비율 기준</div>
          </div>

          {/* 경계선 범례 + 축 */}
          <UtChartAxis utMax={utMax} />

          {/* 차트 행 */}
          <div className="space-y-1 mt-2">
            {risky.map((p, i) => (
              <UtChartRow key={i} point={p} utMax={utMax} />
            ))}
          </div>

          {/* 범례 */}
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
            <LegendDot color="bg-rose-500" label="U/T > 50% (시스템 점검)" />
            <LegendDot color="bg-amber-400" label="U/T > 33% (높음)" />
            <LegendDot color="bg-rose-200" label="경계 합격 / 위험 판정" />
          </div>
        </div>
      )}

      {/* 안전 포인트 — 접기 토글 */}
      {safe.length > 0 && (
        <div>
          <button
            onClick={() => setShowAllSafe(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-emerald-50/50 border border-emerald-100 rounded-lg hover:bg-emerald-50 transition-colors"
          >
            <span className="text-[10px] text-emerald-700 uppercase tracking-wide font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              안전 포인트 ({safe.length})
            </span>
            <svg className={`w-3.5 h-3.5 text-emerald-600 transition-transform ${showAllSafe ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showAllSafe && (
            <div className="mt-2 space-y-1">
              {safe.map((p, i) => (
                <CompactSafeRow key={i} point={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 전부 데이터 없음 */}
      {risky.length === 0 && safe.length === 0 && (
        <div className="text-xs text-slate-400 text-center py-3">포인트 데이터 없음</div>
      )}
    </div>
  )
}

// U/T 차트 축 (33%/50% 경계선 표시)
function UtChartAxis({ utMax }: { utMax: number }) {
  // 차트 영역은 라벨(40% 폭) 다음 우측 60% 폭
  const pct33 = (33 / utMax) * 100
  const pct50 = (50 / utMax) * 100
  const pct100 = (100 / utMax) * 100

  return (
    <div className="relative h-4 ml-[40%] border-b border-slate-200">
      {/* 33% 경계선 */}
      {pct33 < 100 && (
        <div className="absolute top-0 bottom-0 border-l border-dashed border-amber-400" style={{ left: `${pct33}%` }}>
          <span className="absolute -top-3 left-0.5 text-[9px] text-amber-600 whitespace-nowrap">33%</span>
        </div>
      )}
      {/* 50% 경계선 */}
      {pct50 < 100 && (
        <div className="absolute top-0 bottom-0 border-l border-dashed border-rose-400" style={{ left: `${pct50}%` }}>
          <span className="absolute -top-3 left-0.5 text-[9px] text-rose-600 whitespace-nowrap">50%</span>
        </div>
      )}
      {/* 100% 경계선 */}
      {pct100 <= 100 && (
        <div className="absolute top-0 bottom-0 border-l border-slate-300" style={{ left: `${pct100}%` }}>
          <span className="absolute -top-3 -translate-x-1/2 text-[9px] text-slate-500 whitespace-nowrap" style={{ left: `${pct100}%` }}>100%</span>
        </div>
      )}
    </div>
  )
}

// U/T 차트 한 행 — 라벨 + 막대 + 값 + 배지
function UtChartRow({ point, utMax }: { point: import('@/lib/cycle-analysis').PointUncertaintyAnalysis; utMax: number }) {
  const ut = point.latestUtRatio
  const widthPct = ut != null ? (ut / utMax) * 100 : 0

  // 색상 결정 (U/T 비율 + Guard Band 판정)
  const isVerdictDanger = point.latestGuardBand === 'non-conformant' || point.latestGuardBand === 'conditional-fail'
  const barColor =
    ut != null && ut > 50 ? 'bg-rose-500' :
    ut != null && ut > 33 ? 'bg-amber-400' :
    isVerdictDanger ? 'bg-rose-300' :
    point.latestGuardBand === 'conditional-pass' ? 'bg-amber-300' :
    'bg-emerald-400'

  const verdictBadge =
    point.latestGuardBand === 'non-conformant' ? { label: '부적합', cls: 'bg-rose-200 text-rose-800' } :
    point.latestGuardBand === 'conditional-fail' ? { label: '실질위험', cls: 'bg-rose-100 text-rose-700' } :
    point.latestGuardBand === 'conditional-pass' ? { label: '경계', cls: 'bg-amber-100 text-amber-700' } :
    point.latestGuardBand === 'conformant' ? { label: '합격', cls: 'bg-emerald-100 text-emerald-700' } :
    null

  return (
    <div className="flex items-center gap-2 text-[11px] hover:bg-slate-50 rounded px-1 py-0.5">
      {/* 라벨 (좌측 40%) */}
      <div className="w-[40%] flex items-center gap-1.5 min-w-0">
        {verdictBadge && (
          <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${verdictBadge.cls}`}>{verdictBadge.label}</span>
        )}
        <span className="text-slate-700 font-medium truncate" title={point.label}>{point.label}</span>
      </div>
      {/* 차트 막대 (우측 60%) */}
      <div className="flex-1 relative h-5 bg-slate-50 rounded">
        <div
          className={`absolute top-0 bottom-0 left-0 rounded ${barColor} transition-all`}
          style={{ width: `${Math.min(100, widthPct)}%` }}
        />
        {/* 막대 안에 값 표시 (막대가 충분히 크면) */}
        <div className="absolute inset-0 flex items-center justify-end pr-1.5">
          <span className={`text-[10px] font-bold ${widthPct > 20 ? 'text-white' : 'text-slate-700'}`} style={{ textShadow: widthPct > 20 ? '0 0 2px rgba(0,0,0,0.3)' : 'none' }}>
            {ut != null ? `${ut.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>
      {/* 이력 회수 (선택적) */}
      <span className="text-[10px] text-slate-400 w-8 text-right shrink-0">{point.guardBandStats.total}회</span>
    </div>
  )
}

// 안전 포인트용 1줄 컴팩트 표시
function CompactSafeRow({ point }: { point: import('@/lib/cycle-analysis').PointUncertaintyAnalysis }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-100 rounded text-[11px]">
      <span className="text-emerald-600 text-[10px]">✓</span>
      <span className="text-slate-700 font-medium truncate flex-1">{point.label}</span>
      <span className="text-slate-400">
        U/T {point.latestUtRatio != null ? `${point.latestUtRatio.toFixed(1)}%` : '—'}
      </span>
      <span className="text-slate-300">·</span>
      <span className="text-slate-400">{point.guardBandStats.total}회</span>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span>{label}</span>
    </span>
  )
}


// ─────────────────────────────────────────────────────────────────
// 최종 단계 상세 (Breakdown)
// ─────────────────────────────────────────────────────────────────

function FinalBreakdown({ analysis }: { analysis: CycleAnalysisResult }) {
  const final = analysis.step5.data
  return (
    <div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">계산식</div>
      <div className="flex items-center flex-wrap gap-2 text-xs">
        <BreakdownBox label="기준" value={`${final.breakdown.base}`} primary />
        <span className="text-slate-400">+</span>
        <BreakdownBox label="2단계" value={`${formatSigned(final.breakdown.trendAdj)}`} />
        <span className="text-slate-400">+</span>
        <BreakdownBox label="3단계" value={`${formatSigned(final.breakdown.riskAdj)}`} />
        <span className="text-slate-400">+</span>
        <BreakdownBox label="4단계" value={`${formatSigned(final.breakdown.contextAdj)}`} />
        <span className="text-slate-400">=</span>
        <BreakdownBox label="권고" value={`${final.finalMonths}개월`} highlight />
      </div>
      {final.guardrail.clamped && (
        <p className="mt-3 text-[11px] text-amber-600">
          원본 합계 {final.breakdown.sum}개월 → 가드레일({final.guardrail.minMonths}~{final.guardrail.maxMonths}개월) 적용 → {final.finalMonths}개월
        </p>
      )}
    </div>
  )
}

function formatSigned(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

// ─────────────────────────────────────────────────────────────────
// 소형 보조 컴포넌트
// ─────────────────────────────────────────────────────────────────

function MetricBox({
  label,
  value,
  unit,
  primary,
  textValue,
  muted,
}: {
  label: string
  value: string
  unit: string
  primary?: boolean
  textValue?: boolean
  muted?: boolean
}) {
  return (
    <div className={`px-3 py-2.5 rounded-lg border ${
      primary ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'
    }`}>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`flex items-baseline gap-0.5 ${muted ? 'text-slate-400' : ''}`}>
        <span className={`${
          textValue ? 'text-xs font-semibold' : 'text-xl font-bold'
        } ${primary ? 'text-blue-700' : 'text-slate-700'} ${muted ? 'text-slate-400 font-medium' : ''}`}>
          {value}
        </span>
        {unit && <span className="text-[10px] text-slate-400 font-medium">{unit}</span>}
      </div>
    </div>
  )
}

function DataPair({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${positive ? 'text-slate-700' : 'text-slate-400'}`}>
        {value}
      </span>
    </div>
  )
}

function CalcChip({
  label,
  value,
  primary,
  tone = 'slate',
}: {
  label: string
  value: string
  primary?: boolean
  tone?: 'slate' | 'rose' | 'emerald'
}) {
  const cls = primary
    ? 'bg-blue-600 text-white border-blue-600'
    : tone === 'rose'
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-700 border-slate-200'
  return (
    <div className={`inline-flex flex-col items-center px-3 py-1.5 border rounded-lg ${cls}`}>
      <span className="text-[9px] uppercase tracking-wide opacity-70 leading-none mb-0.5">{label}</span>
      <span className="text-sm font-bold leading-none">{value}</span>
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  subtitle,
  muted,
}: {
  icon: 'decision' | 'evidence' | 'ai'
  title: string
  subtitle?: string
  muted?: boolean
}) {
  const iconPath =
    icon === 'decision' ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' :
    icon === 'evidence' ? 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' :
    'M13 10V3L4 14h7v7l9-11h-7z'
  const colorClass =
    muted ? 'text-slate-400' :
    icon === 'decision' ? 'text-blue-600' :
    icon === 'evidence' ? 'text-slate-700' :
    'text-purple-600'

  return (
    <div className="flex items-center gap-2 mb-3">
      <svg className={`w-5 h-5 ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
      </svg>
      <div>
        <h3 className={`text-sm font-bold ${muted ? 'text-slate-500' : 'text-slate-800'}`}>{title}</h3>
        {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

/**
 * 결정 영역 상단에 표시될 한 줄 자연어 요약 메시지 생성
 * (AI 호출 전, 규칙 기반 — 결과를 즉시 사용자에게 전달)
 */
function buildSummaryMessage(analysis: CycleAnalysisResult): string {
  const final = analysis.step5.data
  const baseSrc = analysis.step1.data.sourceLabel
  const baseMonths = analysis.step1.data.baseMonths
  const finalMonths = final.finalMonths
  const conf = final.confidence

  // 기본 권고
  let msg = ''
  if (final.direction === 'maintain') {
    msg = `${baseSrc} ${baseMonths}개월을 그대로 따릅니다.`
  } else if (final.direction === 'shorten') {
    msg = `${baseSrc} ${baseMonths}개월에서 ${baseMonths - finalMonths}개월 단축한 ${finalMonths}개월을 권고합니다.`
  } else {
    msg = `${baseSrc} ${baseMonths}개월에서 ${finalMonths - baseMonths}개월 연장한 ${finalMonths}개월을 검토할 수 있습니다.`
  }

  // 신뢰도 보강
  if (conf === 'low') {
    msg += ' 다만 데이터가 부족해 추가 검증이 필요합니다.'
  } else if (conf === 'medium' && analysis.step1.warnings.length > 0) {
    msg += ' 사양서 정보가 보완되면 정밀도가 높아집니다.'
  }

  return msg
}

function BreakdownBox({ label, value, highlight, primary }: { label: string; value: string; highlight?: boolean; primary?: boolean }) {
  const cls = highlight
    ? 'bg-blue-600 text-white border-blue-600'
    : primary
    ? 'bg-slate-100 text-slate-700 border-slate-200'
    : 'bg-white text-slate-600 border-slate-200'
  return (
    <div className={`inline-flex flex-col items-center px-2.5 py-1 border rounded ${cls}`}>
      <span className="text-[9px] uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-xs font-bold">{value}</span>
    </div>
  )
}

function SummaryCell({
  label,
  value,
  unit,
  tone = 'slate',
  highlight,
}: {
  label: string
  value: string
  unit: string
  tone?: 'slate' | 'rose' | 'emerald' | 'blue'
  highlight?: boolean
}) {
  const toneClass =
    tone === 'rose' ? 'text-rose-600' :
    tone === 'emerald' ? 'text-emerald-600' :
    tone === 'blue' ? 'text-blue-700' :
    'text-slate-700'
  const containerClass = highlight
    ? 'bg-blue-50 border border-blue-200 rounded-lg px-2 py-2'
    : 'px-2 py-2'
  return (
    <div className={`text-center ${containerClass}`}>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-base font-bold ${toneClass}`}>
        {value}<span className="text-xs font-medium ml-0.5 opacity-70">{unit}</span>
      </div>
    </div>
  )
}
