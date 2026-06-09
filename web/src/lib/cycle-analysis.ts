// 교정주기 분석 (Phase G — 실무 적용형)
//
// 설계 원칙:
// 1. 기존 equipment-health.ts와 완전 독립 — 절대 import 안 함, 영향 0
// 2. 5단계 추론 구조 (현재 1차: 1·2·3·5 구현, 4단계는 스키마만)
// 3. 각 단계가 ±N개월 조정값을 내고 마지막에 합산
// 4. 모든 결정에 "근거" 필드를 구조화 데이터로 함께 반환 → UI가 카드로 표시
// 5. "이 장비의 개성"을 우선 — 그룹 평균/유사 장비 데이터 의존 안 함
//
// 단계 구조:
//   step1_baseline(profile, ktoolsCycleMonths)        → 기준 주기
//   step2_trendDrift(series, calDates)                → 드리프트 추세 + 가속 감지
//   step3_uncertaintyRisk(series)                     → Guard Band / U/T 불확도
//   step4_userContext(userInput)                      → (1차 제외 — 스키마만)
//   step5_finalize(step1~4 + AI?)                     → 최종 결정 + 신뢰도

// equipment-health.ts에서 타입만 import (런타임 의존성 0, 컴파일 후 사라짐)
import type { TrendSeries } from './equipment-health'

// ─────────────────────────────────────────────────────────────────
// 공통 타입
// ─────────────────────────────────────────────────────────────────

export type AdjustmentDirection = 'shorten' | 'extend' | 'maintain'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * 각 단계가 반환하는 공통 형태:
 * - months: 기준 주기 또는 조정 후 주기 (1단계는 절대값, 2~4는 조정량)
 * - adjustment: 1단계는 0, 2~4는 +/-N (개월)
 * - reasons: 사람이 읽는 짧은 근거 문장들 (UI 카드에 그대로 표시)
 * - data: 그 단계가 산출한 구조화 데이터 (UI에서 펼침 시 그래프/표용)
 */
export interface StepResult<TData> {
  adjustment: number              // 이 단계가 권고하는 조정 (개월). 1단계는 0.
  reasons: string[]               // 짧은 한 줄 근거 (배지/카드용)
  warnings: string[]              // 주의/경고 (있을 수도 없을 수도)
  confidence: ConfidenceLevel     // 이 단계 결론의 신뢰도
  data: TData                     // 단계별 상세 데이터 (펼침용)
}

// ─────────────────────────────────────────────────────────────────
// Step 1: 기준 주기 (Baseline)
// ─────────────────────────────────────────────────────────────────

export type BaselineSource =
  | 'profile_recommended'   // equipment_profiles의 calibration.recommended_cycle
  | 'ktools_registered'     // k-tools에 등록된 affcCyclCd
  | 'default_fallback'      // 둘 다 없을 때 12개월 가정

export interface BaselineData {
  baseMonths: number              // 기준 주기 (개월)
  source: BaselineSource           // 어디서 가져온 값인지
  sourceLabel: string              // UI 표시용 (예: "제조사 권장")
  profileCategory: string | null   // 장비군 (있으면)
  profileStandards: string[]       // 적용 표준 (있으면, 예: ["ISO 16063"])
  rawProfileValue: string | null   // 원본 값 (예: "12개월")
  rawKtoolsValue: string | null    // 원본 값 (예: "12")
}

/**
 * equipment_profiles의 일부 (단계 분석에 쓰는 필드만)
 * Supabase에서 가져온 profile_json을 그대로 받음
 */
export interface ProfileLike {
  category?: string | null
  calibration?: {
    recommended_cycle?: string | null
    standards?: string[] | null
    self_calibration?: string | null
    stability_spec?: string | null
    drift_spec?: string | null
  } | null
  cautions?: string[] | null
  meta?: {
    discontinued?: boolean | null
    successor_model?: string | null
  } | null
}

/**
 * "12개월" / "1년" / "6 month" 같은 표현을 개월 수로 파싱
 * 실패 시 null
 */
function parseCycleString(s: string | null | undefined): number | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null

  // 년 단위 먼저 체크 (있으면 + 개월도 합산)
  const yearMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:년|year|years|yr)/i)
  const monthMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:개월|month|months|mo)/i)

  if (yearMatch) {
    const years = parseFloat(yearMatch[1])
    const extraMonths = monthMatch ? parseFloat(monthMatch[1]) : 0
    const total = years * 12 + extraMonths
    if (Number.isFinite(total) && total > 0) return Math.round(total)
  }

  if (monthMatch) {
    const v = parseFloat(monthMatch[1])
    if (Number.isFinite(v) && v > 0) return Math.round(v)
  }

  // 그냥 숫자만 ("12")
  const plain = parseFloat(trimmed)
  if (Number.isFinite(plain) && plain > 0 && plain <= 120) return Math.round(plain)

  return null
}

/**
 * 1단계: 기준 주기 결정
 * 우선순위: profile.calibration.recommended_cycle → ktoolsAffcCyclCd → 12개월
 *
 * @param profile equipment_profiles의 profile_json (없으면 null)
 * @param ktoolsAffcCyclCd k-tools의 affcCyclCd 값 (예: "12", "")
 */
export function step1_baseline(
  profile: ProfileLike | null,
  ktoolsAffcCyclCd: string | null | undefined,
): StepResult<BaselineData> {
  const reasons: string[] = []
  const warnings: string[] = []

  // 1순위: profile.calibration.recommended_cycle
  const rawProfile = profile?.calibration?.recommended_cycle ?? null
  const profileMonths = parseCycleString(rawProfile)

  // 2순위: k-tools affcCyclCd
  const rawKtools = ktoolsAffcCyclCd?.trim() || null
  const ktoolsMonths = parseCycleString(rawKtools)

  const profileCategory = profile?.category ?? null
  const profileStandards = profile?.calibration?.standards ?? []

  let baseMonths: number
  let source: BaselineSource
  let sourceLabel: string
  let confidence: ConfidenceLevel

  if (profileMonths != null) {
    baseMonths = profileMonths
    source = 'profile_recommended'
    sourceLabel = '제조사 권장 주기'
    confidence = 'high'
    if (profileCategory) {
      reasons.push(`장비군: ${profileCategory}`)
    }
    reasons.push(`제조사 권장: ${rawProfile}`)
    if (profileStandards.length > 0) {
      reasons.push(`적용 표준: ${profileStandards.join(', ')}`)
    }
    // ktools 값이 profile과 다르면 경고
    if (ktoolsMonths != null && ktoolsMonths !== profileMonths) {
      warnings.push(`k-tools 등록 주기(${ktoolsMonths}개월)와 제조사 권장(${profileMonths}개월)이 다릅니다`)
    }
  } else if (ktoolsMonths != null) {
    baseMonths = ktoolsMonths
    source = 'ktools_registered'
    sourceLabel = 'k-tools 등록 주기'
    confidence = 'medium'
    reasons.push(`k-tools 등록: ${ktoolsMonths}개월`)
    warnings.push('제조사 권장 주기 정보가 사양서에 없어 등록 주기를 기준으로 사용합니다')
  } else {
    baseMonths = 12
    source = 'default_fallback'
    sourceLabel = '기본 가정'
    confidence = 'low'
    reasons.push('기준 주기 정보 없음 — 일반 가정치 12개월 적용')
    warnings.push('제조사 권장과 k-tools 등록 주기 모두 없습니다. 장비 사양서 확인을 권장합니다')
  }

  // 단종 장비 경고 (주기와는 별개지만 분석 결과에 표시 가치 있음)
  if (profile?.meta?.discontinued === true) {
    warnings.push('단종된 장비입니다 — 교체 검토 권장')
  }

  return {
    adjustment: 0,                 // 1단계는 기준값이라 조정량 없음
    reasons,
    warnings,
    confidence,
    data: {
      baseMonths,
      source,
      sourceLabel,
      profileCategory,
      profileStandards,
      rawProfileValue: rawProfile,
      rawKtoolsValue: rawKtools,
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Step 2~5: 다음 작업에서 구현
// 일단 스켈레톤만 export 해두고 NotImplementedError로 둠
// ─────────────────────────────────────────────────────────────────

/**
 * 측정 포인트별 드리프트 분석 결과
 */
export interface PointDriftAnalysis {
  label: string                      // 측정 포인트 라벨 (예: "81.36 N·m")
  usageRatios: (number | null)[]     // 시계열 한계 사용률 (각 교정)
  latestRatio: number | null         // 최신 한계 사용률
  ratioHistory: number[]             // null 제외한 깔끔한 시계열 (시각화용)
  nearLimitCount: number             // 80% 이상 도달한 횟수 (전체 중)
  totalCount: number                 // 전체 측정 횟수
  accelerating: boolean              // 직전 변화량이 평균의 2배 이상
  accelerationRatio: number | null   // 최근 변화 / 평균 변화 (있으면)
  trend: 'rising' | 'falling' | 'stable' | 'volatile'  // 시각적 추세
  riskLevel: 'safe' | 'watch' | 'urgent'  // 종합 위험도
}

export interface TrendDriftData {
  points: PointDriftAnalysis[]
  summary: {
    urgentPointCount: number        // riskLevel='urgent' 포인트 개수
    watchPointCount: number          // riskLevel='watch' 포인트 개수
    safePointCount: number           // riskLevel='safe' 포인트 개수
    acceleratingCount: number        // 가속 중인 포인트 개수
    maxLatestRatio: number | null    // 모든 포인트 최신 한계 사용률 중 최댓값
  }
  dataQuality: {
    enoughHistory: boolean           // 3회 이상 이력 있는 포인트가 1개라도 있는지
    historyLength: number            // 가장 긴 시계열 길이
  }
}

/**
 * 가속 감지: 최근 N-1→N 변화량이 이전 평균 변화량의 2배 이상이면 true
 * 이력이 4회 미만이면 false (감지 불가)
 */
function detectAcceleration(history: number[]): { accelerating: boolean; ratio: number | null } {
  if (history.length < 4) return { accelerating: false, ratio: null }

  // 직전 변화량
  const recentChange = Math.abs(history[history.length - 1] - history[history.length - 2])
  // 이전 변화량들의 평균 (마지막 변화 제외)
  const prevChanges: number[] = []
  for (let i = 1; i < history.length - 1; i++) {
    prevChanges.push(Math.abs(history[i] - history[i - 1]))
  }
  if (prevChanges.length === 0) return { accelerating: false, ratio: null }
  const avgPrev = prevChanges.reduce((s, v) => s + v, 0) / prevChanges.length

  // 평균 변화가 너무 작으면 (1% 미만) 가속 판단 무의미
  if (avgPrev < 1) return { accelerating: false, ratio: null }

  const ratio = recentChange / avgPrev
  return { accelerating: ratio >= 2, ratio: Math.round(ratio * 10) / 10 }
}

/**
 * 추세 분류: 시계열의 전반적 방향
 */
function classifyTrend(history: number[]): 'rising' | 'falling' | 'stable' | 'volatile' {
  if (history.length < 2) return 'stable'

  const overall = history[history.length - 1] - history[0]
  const meanAbs = history.reduce((s, v) => s + Math.abs(v), 0) / history.length || 1

  // 변화량 시계열
  const changes: number[] = []
  for (let i = 1; i < history.length; i++) {
    changes.push(history[i] - history[i - 1])
  }
  // 부호 변화 횟수
  let signChanges = 0
  for (let i = 1; i < changes.length; i++) {
    if (changes[i - 1] * changes[i] < 0) signChanges++
  }
  // 평균 변화 크기 (절댓값)
  const avgChangeMagnitude = changes.reduce((s, v) => s + Math.abs(v), 0) / changes.length

  // volatile 판단 (먼저 검사):
  //   - 부호 변화가 시계열 길이의 절반 이상
  //   - 평균 변화 크기가 충분히 큼 (평균 절댓값의 20% 이상) — 작은 노이즈 제외
  //   - 데이터 4회 이상
  if (
    history.length >= 4 &&
    signChanges >= Math.floor((history.length - 1) / 2) &&
    avgChangeMagnitude >= meanAbs * 0.2
  ) {
    return 'volatile'
  }

  // 평균 절댓값 대비 전체 변화량이 작으면 stable
  if (Math.abs(overall) < meanAbs * 0.15) return 'stable'

  return overall > 0 ? 'rising' : 'falling'
}

/**
 * 포인트별 위험도 분류
 */
function classifyRiskLevel(p: Omit<PointDriftAnalysis, 'riskLevel'>): 'safe' | 'watch' | 'urgent' {
  const latest = p.latestRatio
  // urgent: 최신 95% 이상 OR (가속 + 최신 80% 이상) OR 한계 근접 3회 이상
  if (latest != null && latest >= 95) return 'urgent'
  if (p.accelerating && latest != null && latest >= 80) return 'urgent'
  if (p.nearLimitCount >= 3) return 'urgent'

  // watch: 최신 80% 이상 OR 한계 근접 2회 이상 OR 가속
  if (latest != null && latest >= 80) return 'watch'
  if (p.nearLimitCount >= 2) return 'watch'
  if (p.accelerating) return 'watch'

  return 'safe'
}

/**
 * 2단계: 측정 드리프트 분석
 *
 * 핵심 신호 (학문적 통계 의존 X, 실무 직관 신호 중심):
 *   - 한계 사용률 시계열 (|오차|/허용오차)
 *   - 가속 감지 (직전 변화량 vs 평균)
 *   - 한계 근접 횟수 (80% 이상 도달 횟수)
 *   - 추세 분류 (rising/falling/stable/volatile)
 *
 * 결정 로직:
 *   - urgent ≥ 1개 + 가속 → -6 (강력 단축)
 *   - urgent ≥ 1개 (가속 없음) → -3 (단축)
 *   - watch ≥ 2개 또는 watch + 가속 → -3
 *   - watch 1개 → 0 (관찰)
 *   - 모두 safe + falling 추세 우세 → +2 (연장 검토)
 *   - 모두 safe + stable → 0 (현행 유지)
 *   - 데이터 부족 → 0 (low confidence)
 */
export function step2_trendDrift(
  series: TrendSeries[],
  calDates: string[],
): StepResult<TrendDriftData> {
  const reasons: string[] = []
  const warnings: string[] = []

  // 각 포인트별 분석
  const points: PointDriftAnalysis[] = []
  let maxLatestRatio: number | null = null
  let longestHistory = 0

  for (const s of series) {
    const usageRatios = s.points.map(p => p.비율)  // 각 교정 시점의 |오차|/허용오차 %
    const ratioHistory = usageRatios.filter((v): v is number => v != null)

    if (ratioHistory.length === 0) continue
    longestHistory = Math.max(longestHistory, ratioHistory.length)

    const latestRatio = ratioHistory[ratioHistory.length - 1] ?? null
    if (latestRatio != null && (maxLatestRatio == null || latestRatio > maxLatestRatio)) {
      maxLatestRatio = latestRatio
    }

    const nearLimitCount = ratioHistory.filter(v => v >= 80).length
    const { accelerating, ratio: accelerationRatio } = detectAcceleration(ratioHistory)
    const trend = classifyTrend(ratioHistory)

    const partial: Omit<PointDriftAnalysis, 'riskLevel'> = {
      label: s.label,
      usageRatios,
      latestRatio,
      ratioHistory,
      nearLimitCount,
      totalCount: ratioHistory.length,
      accelerating,
      accelerationRatio,
      trend,
    }
    const riskLevel = classifyRiskLevel(partial)
    points.push({ ...partial, riskLevel })
  }

  const summary = {
    urgentPointCount: points.filter(p => p.riskLevel === 'urgent').length,
    watchPointCount: points.filter(p => p.riskLevel === 'watch').length,
    safePointCount: points.filter(p => p.riskLevel === 'safe').length,
    acceleratingCount: points.filter(p => p.accelerating).length,
    maxLatestRatio,
  }

  const dataQuality = {
    enoughHistory: longestHistory >= 3,
    historyLength: longestHistory,
  }

  // ── 결정 로직 ──
  let adjustment = 0
  let confidence: ConfidenceLevel = 'low'

  if (!dataQuality.enoughHistory) {
    reasons.push(`교정 이력 ${calDates.length}회 — 추세 분석에 최소 3회 이력 필요`)
    return {
      adjustment: 0,
      reasons,
      warnings: ['데이터 부족으로 드리프트 분석 보류 — 다음 교정 후 재평가 권장'],
      confidence: 'low',
      data: { points, summary, dataQuality },
    }
  }

  // 데이터 충분 — 신뢰도 보통 이상
  confidence = longestHistory >= 5 ? 'high' : 'medium'

  if (summary.urgentPointCount > 0 && summary.acceleratingCount > 0) {
    adjustment = -6
    reasons.push(`긴급 관리 필요 포인트 ${summary.urgentPointCount}개 + 가속 진행 중 ${summary.acceleratingCount}개`)
  } else if (summary.urgentPointCount > 0) {
    adjustment = -3
    reasons.push(`긴급 관리 필요 포인트 ${summary.urgentPointCount}개`)
  } else if (summary.watchPointCount >= 2 || (summary.watchPointCount >= 1 && summary.acceleratingCount > 0)) {
    adjustment = -3
    reasons.push(`주의 포인트 ${summary.watchPointCount}개${summary.acceleratingCount > 0 ? ` + 가속 ${summary.acceleratingCount}개` : ''}`)
  } else if (summary.watchPointCount === 1) {
    adjustment = 0
    reasons.push('주의 포인트 1개 — 추세 관찰 권장 (조정 보류)')
  } else {
    // 모두 safe
    const fallingCount = points.filter(p => p.trend === 'falling').length
    const stableCount = points.filter(p => p.trend === 'stable').length
    if (fallingCount >= points.length / 2 && summary.maxLatestRatio != null && summary.maxLatestRatio < 50) {
      adjustment = 2
      reasons.push(`모든 포인트 안정 + 사용률 감소 추세 (최대 ${summary.maxLatestRatio.toFixed(1)}%)`)
    } else {
      adjustment = 0
      reasons.push(`모든 포인트 안정 (안정 ${stableCount}/${points.length}, 감소 ${fallingCount}/${points.length})`)
    }
  }

  // 보충 메시지
  if (summary.maxLatestRatio != null) {
    reasons.push(`최신 한계 사용률 최댓값: ${summary.maxLatestRatio.toFixed(1)}%`)
  }
  const urgentPoints = points.filter(p => p.riskLevel === 'urgent').slice(0, 3)
  for (const up of urgentPoints) {
    const parts: string[] = [`${up.label}: 최신 ${up.latestRatio?.toFixed(1) ?? '?'}%`]
    if (up.nearLimitCount > 1) parts.push(`한계 근접 ${up.nearLimitCount}/${up.totalCount}회`)
    if (up.accelerating) parts.push(`가속 ${up.accelerationRatio?.toFixed(1) ?? '?'}배`)
    warnings.push(parts.join(' · '))
  }

  return {
    adjustment,
    reasons,
    warnings,
    confidence,
    data: { points, summary, dataQuality },
  }
}

export interface UncertaintyRiskData {
  _placeholder: true
}

export function step3_uncertaintyRisk(
  _series: TrendSeries[],
): StepResult<UncertaintyRiskData> {
  // TODO: 다음 작업에서 구현
  return {
    adjustment: 0,
    reasons: ['(3단계 미구현 — 다음 단계에서 추가)'],
    warnings: [],
    confidence: 'low',
    data: { _placeholder: true },
  }
}

// Step 4 (사용자 컨텍스트)는 1차 작업에서 제외 — 스키마만 정의
export interface UserContextInput {
  usageFrequency?: 'low' | 'medium' | 'high' | null
  environmentSeverity?: 'normal' | 'harsh' | null
  safetyLevel?: 'normal' | 'critical' | null
  customNote?: string | null
}

// ─────────────────────────────────────────────────────────────────
// Step 5: 최종 결정 (스켈레톤)
// ─────────────────────────────────────────────────────────────────

export interface FinalDecisionData {
  finalMonths: number
  direction: AdjustmentDirection
  confidence: ConfidenceLevel
  guardrail: {
    minMonths: number
    maxMonths: number
    clamped: boolean              // 가드레일에 걸렸는지
  }
  breakdown: {
    base: number
    trendAdj: number
    riskAdj: number
    contextAdj: number
    sum: number                   // base + 각 조정량의 합
  }
}

export function step5_finalize(
  step1: StepResult<BaselineData>,
  step2: StepResult<TrendDriftData>,
  step3: StepResult<UncertaintyRiskData>,
  step4?: StepResult<unknown>,    // 1차에서는 undefined
): StepResult<FinalDecisionData> {
  const base = step1.data.baseMonths
  const trendAdj = step2.adjustment
  const riskAdj = step3.adjustment
  const contextAdj = step4?.adjustment ?? 0

  const sum = base + trendAdj + riskAdj + contextAdj

  // 가드레일: 최소 3개월, 최대 60개월
  const MIN = 3
  const MAX = 60
  const clamped = sum < MIN || sum > MAX
  const finalMonths = Math.max(MIN, Math.min(MAX, sum))

  let direction: AdjustmentDirection
  if (finalMonths < base - 1) direction = 'shorten'
  else if (finalMonths > base + 1) direction = 'extend'
  else direction = 'maintain'

  // 신뢰도: 각 단계 신뢰도 종합 (가장 낮은 값 또는 평균)
  const levels: ConfidenceLevel[] = [step1.confidence, step2.confidence, step3.confidence]
  if (step4) levels.push(step4.confidence)
  const confidence: ConfidenceLevel =
    levels.includes('low') ? 'low' :
    levels.includes('medium') ? 'medium' :
    'high'

  const reasons: string[] = []
  if (direction === 'shorten') {
    reasons.push(`${base}개월 → ${finalMonths}개월 단축 권고 (조정 ${finalMonths - base}개월)`)
  } else if (direction === 'extend') {
    reasons.push(`${base}개월 → ${finalMonths}개월 연장 검토 가능 (조정 +${finalMonths - base}개월)`)
  } else {
    reasons.push(`${base}개월 유지 권고`)
  }

  const warnings: string[] = []
  if (clamped) {
    warnings.push(`조정 합계(${sum}개월)가 가드레일을 초과하여 ${finalMonths}개월로 제한되었습니다`)
  }

  return {
    adjustment: finalMonths - base,
    reasons,
    warnings,
    confidence,
    data: {
      finalMonths,
      direction,
      confidence,
      guardrail: { minMonths: MIN, maxMonths: MAX, clamped },
      breakdown: { base, trendAdj, riskAdj, contextAdj, sum },
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// 전체 분석 묶음 함수 (오케스트레이터)
// ─────────────────────────────────────────────────────────────────

export interface CycleAnalysisResult {
  step1: StepResult<BaselineData>
  step2: StepResult<TrendDriftData>
  step3: StepResult<UncertaintyRiskData>
  step5: StepResult<FinalDecisionData>
  // AI 종합 평가는 별도 atom 호출 결과를 UI에서 합침 (분석 결과에는 포함 안 함)
}

export interface CycleAnalysisInput {
  profile: ProfileLike | null
  ktoolsAffcCyclCd: string | null | undefined
  series: TrendSeries[]
  calDates: string[]
}

/**
 * 5단계 분석 전체 실행 (AI 호출은 별도)
 * 동기 함수 — 외부 API 호출 없음 (순수 데이터 기반)
 */
export function runCycleAnalysis(input: CycleAnalysisInput): CycleAnalysisResult {
  const step1 = step1_baseline(input.profile, input.ktoolsAffcCyclCd)
  const step2 = step2_trendDrift(input.series, input.calDates)
  const step3 = step3_uncertaintyRisk(input.series)
  const step5 = step5_finalize(step1, step2, step3)

  return { step1, step2, step3, step5 }
}
