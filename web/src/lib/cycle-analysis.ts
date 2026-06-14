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
import type { TrendSeries, TrendPoint } from './equipment-health'
// Peer Benchmark / Interim 더미 데이터 타입·생성기 (발표용 — 별도 파일에 격리)
import type { PeerBenchmarkData } from './cycle-analysis-dummy'
import {
  buildInterimSimulation,
  mergeInterimIntoSeries,
  buildErrorForecast,
  type InterimSimulationResult,
} from './cycle-analysis-dummy'

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

/**
 * Guard Band 누적 분포 (전체 이력 합계)
 * - conformant: 완전 합격 (|오차| + |불확도| ≤ |허용오차|)
 * - conditional-pass: 경계 (|오차| ≤ |허용오차|, 불확도 감안 시 초과 가능)
 * - conditional-fail: 실질 위험 (|오차| > |허용오차|, 불확도 감안 시 합격 가능)
 * - non-conformant: 명백 부적합
 */
export interface GuardBandStats {
  conformant: number
  conditionalPass: number
  conditionalFail: number
  nonConformant: number
  unknown: number              // Guard Band 데이터 없음
  total: number                // 전체 측정 카운트 (모든 포인트 × 모든 교정)
}

export interface PointUncertaintyAnalysis {
  label: string
  guardBandStats: GuardBandStats           // 이 포인트 누적 분포
  latestGuardBand: 'conformant' | 'conditional-pass' | 'conditional-fail' | 'non-conformant' | null
  latestUtRatio: number | null              // 최신 U/T %
  maxUtRatio: number | null                 // 이력 중 최대 U/T %
  hasRecentDanger: boolean                  // 최근 conditional-fail 또는 non-conformant
  // ── 가드밴드 개념도 차트용 (최신 교정 기준) ──
  latestError: number | null                // 최신 오차 (%, 부호 포함) — 점 위치
  latestUAbs: number | null                 // 최신 확장불확도 U (%, 절대값) — ±막대 길이
  tolerance: number | null                  // 허용오차 ± (%) — 한계선
}

export interface UncertaintyRiskData {
  points: PointUncertaintyAnalysis[]
  overall: GuardBandStats                   // 전 포인트 합계
  summary: {
    pointsWithRecentDanger: number          // conditional-fail/non-conformant 최근 발생 포인트 수
    pointsWithHighUtRatio: number           // 최신 U/T > 33% 포인트 수
    maxUtRatioOverall: number | null        // 최신 U/T 최댓값
    conditionalPassRatio: number            // 전체 중 conditional-pass 비율 (%)
    hasGuardBandData: boolean               // Guard Band 데이터가 1건이라도 있는지
  }
  dataQuality: {
    enoughHistory: boolean                  // 2회 이상 이력
    historyLength: number
  }
}

/**
 * 3단계: 측정 불확도 위험
 *
 * 핵심 신호:
 *   - Guard Band 누적 분포 (conditional-pass/fail/non-conformant 비율)
 *   - 최근 위험 판정 발생 여부 (latest = conditional-fail/non-conformant)
 *   - U/T 비율 (불확도가 허용오차 대비 차지하는 비중)
 *
 * 결정 로직:
 *   A. Guard Band 평가:
 *     - 최근 non-conformant 발생 → -6 (강력 단축)
 *     - 최근 conditional-fail 발생 → -3
 *     - conditional-pass 누적 ≥ 30% → -3
 *     - conditional-pass 1~2건 → 0 (관찰)
 *     - 전부 conformant → 0 (안정)
 *   B. U/T 비율 평가:
 *     - 최신 U/T > 50% → -3 (측정 시스템 점검 필요)
 *     - 최신 U/T > 33% → -1
 *     - 최신 U/T ≤ 25% + 누적 안정 → 0
 *   최종: A와 B 중 더 강한 단축값 채택 (step2와의 중복 가산 방지)
 */
export function step3_uncertaintyRisk(
  series: TrendSeries[],
): StepResult<UncertaintyRiskData> {
  const reasons: string[] = []
  const warnings: string[] = []

  // 각 포인트별 분석
  const points: PointUncertaintyAnalysis[] = []
  const overall: GuardBandStats = {
    conformant: 0,
    conditionalPass: 0,
    conditionalFail: 0,
    nonConformant: 0,
    unknown: 0,
    total: 0,
  }
  let maxHistory = 0
  let maxUtRatioOverall: number | null = null

  for (const s of series) {
    const stats: GuardBandStats = {
      conformant: 0,
      conditionalPass: 0,
      conditionalFail: 0,
      nonConformant: 0,
      unknown: 0,
      total: 0,
    }
    let latestGuardBand: PointUncertaintyAnalysis['latestGuardBand'] = null
    let latestUtRatio: number | null = null
    let maxUtRatio: number | null = null
    let hasRecentDanger = false
    // 가드밴드 개념도 차트용: 최신 교정의 오차/U/허용오차
    let latestError: number | null = null
    let latestUAbs: number | null = null
    let tolerance: number | null = null

    for (const p of s.points) {
      // null 측정값은 카운트에서 제외 (해당 시점에 측정 안 됨)
      if (p.오차 == null && p.guardBand == null) continue
      stats.total++

      if (p.guardBand === 'conformant') stats.conformant++
      else if (p.guardBand === 'conditional-pass') stats.conditionalPass++
      else if (p.guardBand === 'conditional-fail') stats.conditionalFail++
      else if (p.guardBand === 'non-conformant') stats.nonConformant++
      else stats.unknown++
    }

    // 최신 값 추출 (역순 스캔)
    for (let i = s.points.length - 1; i >= 0; i--) {
      const p = s.points[i]
      if (p.guardBand != null && latestGuardBand === null) {
        latestGuardBand = p.guardBand
      }
      if (p.utRatio != null) {
        if (latestUtRatio === null) latestUtRatio = p.utRatio
        if (maxUtRatio === null || p.utRatio > maxUtRatio) maxUtRatio = p.utRatio
      }
      // 차트용: 오차/U/허용오차가 모두 있는 가장 최근 교정점 1건
      if (latestError === null && p.오차 != null && p.불확도 != null && p.허용오차 != null) {
        latestError = p.오차
        latestUAbs = Math.abs(p.불확도)
        tolerance = Math.abs(p.허용오차)
      }
      if (latestGuardBand !== null && latestUtRatio !== null && latestError !== null) break
    }
    // maxUtRatio 별도 전체 스캔 (위 loop는 break 되므로 부정확)
    for (const p of s.points) {
      if (p.utRatio != null && (maxUtRatio === null || p.utRatio > maxUtRatio)) {
        maxUtRatio = p.utRatio
      }
    }

    hasRecentDanger = latestGuardBand === 'conditional-fail' || latestGuardBand === 'non-conformant'

    // 전체 합산
    overall.conformant += stats.conformant
    overall.conditionalPass += stats.conditionalPass
    overall.conditionalFail += stats.conditionalFail
    overall.nonConformant += stats.nonConformant
    overall.unknown += stats.unknown
    overall.total += stats.total

    maxHistory = Math.max(maxHistory, stats.total)
    if (latestUtRatio != null && (maxUtRatioOverall == null || latestUtRatio > maxUtRatioOverall)) {
      maxUtRatioOverall = latestUtRatio
    }

    points.push({
      label: s.label,
      guardBandStats: stats,
      latestGuardBand,
      latestUtRatio,
      maxUtRatio,
      hasRecentDanger,
      latestError,
      latestUAbs,
      tolerance,
    })
  }

  const pointsWithRecentDanger = points.filter(p => p.hasRecentDanger).length
  const pointsWithHighUtRatio = points.filter(p => p.latestUtRatio != null && p.latestUtRatio > 33).length
  const conditionalPassRatio = overall.total > 0
    ? Math.round((overall.conditionalPass / overall.total) * 1000) / 10
    : 0
  const hasGuardBandData = overall.total > 0 && overall.unknown < overall.total

  const summary = {
    pointsWithRecentDanger,
    pointsWithHighUtRatio,
    maxUtRatioOverall,
    conditionalPassRatio,
    hasGuardBandData,
  }

  const dataQuality = {
    enoughHistory: maxHistory >= 2,
    historyLength: maxHistory,
  }

  // ── 결정 로직 ──
  let adjustment = 0
  let confidence: ConfidenceLevel = 'low'

  // 데이터 부족
  if (!dataQuality.enoughHistory) {
    reasons.push(`교정 이력 ${maxHistory}회 — 불확도 위험 분석에 최소 2회 필요`)
    return {
      adjustment: 0,
      reasons,
      warnings: ['데이터 부족으로 불확도 위험 평가 보류'],
      confidence: 'low',
      data: { points, overall, summary, dataQuality },
    }
  }

  // Guard Band 데이터 자체가 없음 (모든 포인트 unknown)
  if (!hasGuardBandData) {
    reasons.push('Guard Band 판정 데이터 없음 — 성적서에 불확도 정보 미기재로 추정')
    return {
      adjustment: 0,
      reasons,
      warnings: ['Guard Band(불확도 감안 판정) 데이터가 없어 정량 평가 보류'],
      confidence: 'low',
      data: { points, overall, summary, dataQuality },
    }
  }

  // 신뢰도 결정
  confidence = maxHistory >= 4 ? 'high' : maxHistory >= 2 ? 'medium' : 'low'

  // A. Guard Band 평가
  let gbAdjustment = 0
  const recentNonConformantCount = points.filter(p => p.latestGuardBand === 'non-conformant').length
  const recentConditionalFailCount = points.filter(p => p.latestGuardBand === 'conditional-fail').length

  if (recentNonConformantCount > 0) {
    gbAdjustment = -6
    reasons.push(`최근 명백 부적합(non-conformant) 발생 ${recentNonConformantCount}개 포인트`)
  } else if (recentConditionalFailCount > 0) {
    gbAdjustment = -3
    reasons.push(`최근 실질 위험(conditional-fail) 발생 ${recentConditionalFailCount}개 포인트`)
  } else if (conditionalPassRatio >= 30) {
    gbAdjustment = -3
    reasons.push(`불확도 감안 경계(conditional-pass) 누적 비율 ${conditionalPassRatio.toFixed(1)}%`)
  } else if (overall.conditionalPass > 0) {
    gbAdjustment = 0
    reasons.push(`불확도 감안 경계 ${overall.conditionalPass}건 — 관찰 권고`)
  } else {
    gbAdjustment = 0
    reasons.push(`전체 ${overall.total}회 측정 모두 완전 합격(conformant)`)
  }

  // B. U/T 비율 평가
  let utAdjustment = 0
  if (maxUtRatioOverall != null) {
    if (maxUtRatioOverall > 50) {
      utAdjustment = -3
      reasons.push(`최신 U/T 비율 ${maxUtRatioOverall.toFixed(1)}% — 측정 시스템 점검 권장`)
      warnings.push(`U/T 비율이 50%를 초과해 측정 불확도가 허용오차의 절반 이상을 차지합니다`)
    } else if (maxUtRatioOverall > 33) {
      utAdjustment = -1
      reasons.push(`최신 U/T 비율 ${maxUtRatioOverall.toFixed(1)}% — 다소 높음`)
    } else if (maxUtRatioOverall > 25) {
      reasons.push(`최신 U/T 비율 ${maxUtRatioOverall.toFixed(1)}% — 일반적 수준`)
    } else {
      reasons.push(`최신 U/T 비율 ${maxUtRatioOverall.toFixed(1)}% — 양호`)
    }
  }

  // 최종: 더 강한 단축값 채택 (중복 가산 방지)
  adjustment = Math.min(gbAdjustment, utAdjustment)

  // 위험 포인트 상위 3개 warnings
  const dangerPoints = points
    .filter(p => p.hasRecentDanger || (p.latestUtRatio != null && p.latestUtRatio > 33))
    .slice(0, 3)
  for (const dp of dangerPoints) {
    const parts: string[] = [dp.label]
    if (dp.latestGuardBand) parts.push(`최신: ${guardBandLabel(dp.latestGuardBand)}`)
    if (dp.latestUtRatio != null) parts.push(`U/T ${dp.latestUtRatio.toFixed(1)}%`)
    warnings.push(parts.join(' · '))
  }

  return {
    adjustment,
    reasons,
    warnings,
    confidence,
    data: { points, overall, summary, dataQuality },
  }
}

function guardBandLabel(v: 'conformant' | 'conditional-pass' | 'conditional-fail' | 'non-conformant'): string {
  switch (v) {
    case 'conformant': return '완전 합격'
    case 'conditional-pass': return '경계 합격'
    case 'conditional-fail': return '실질 위험'
    case 'non-conformant': return '명백 부적합'
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
// Step 4: Peer Benchmark (유사장비 빅데이터 비교)
//
// "이 장비의 개성"만 보던 step2·3에 더해, 동종 장비군 집단지성을 반영한다.
// 개별 장비는 교정 이력이 적어 통계가 빈약하지만, 같은 모델 수백 대를 합치면
// "이 장비군은 보통 N개월에 한계 도달"이라는 강력한 사전지식이 생긴다.
//
// 결정 로직 (보수적 — step2·3과 중복 가산 방지):
//   - 이 장비가 장비군 상위 10%(백분위 ≥ 90)로 빨리 닳음 → -3 (단축)
//   - 상위 30%(백분위 ≥ 70) → -1
//   - 하위 30%(백분위 < 30) + 장비군 평균주기가 현 기준보다 김 → +2 (연장 검토)
//   - 그 외 (장비군 평균 수준) → 0
// ─────────────────────────────────────────────────────────────────

export interface PeerBenchmarkStepData {
  available: boolean
  groupKey: string
  totalPeerCount: number
  totalCertCount: number
  avgPercentile: number | null
  peerMeanCycleMonths: number
  riskPointCount: number
  position: 'faster' | 'average' | 'slower'   // 장비군 대비 마모 속도 위치
  // UI 시각화용 포인트별 비교 (이 장비 vs 장비군)
  points: Array<{
    label: string
    thisUsage: number | null
    peerMeanUsage: number
    peerP90Usage: number
    thisPercentile: number | null
    peerMeanMonthsToLimit: number | null
  }>
}

export function step4_peerBenchmark(
  peer: PeerBenchmarkData,
  baseMonths: number,
): StepResult<PeerBenchmarkStepData> {
  const reasons: string[] = []
  const warnings: string[] = []

  const avgPct = peer.summary.avgPercentile
  const position: PeerBenchmarkStepData['position'] =
    peer.summary.fasterThanPeers ? 'faster' :
    peer.summary.slowerThanPeers ? 'slower' :
    'average'

  // ── 결정 로직 ──
  let adjustment = 0
  let confidence: ConfidenceLevel = 'medium'

  // 장비군 규모가 크면 신뢰도 높음
  if (peer.totalPeerCount >= 300) confidence = 'high'
  else if (peer.totalPeerCount < 100) confidence = 'low'

  reasons.push(`동종 장비 ${peer.totalPeerCount}대 · 누적 성적서 ${peer.totalCertCount.toLocaleString()}건 분석`)

  if (avgPct != null) {
    if (avgPct >= 90) {
      adjustment = -3
      reasons.push(`이 장비는 동종 장비군 상위 ${(100 - avgPct).toFixed(0)}% — 평균보다 빠르게 마모`)
      warnings.push(`장비군 대비 마모가 빠른 편(백분위 ${avgPct.toFixed(0)}%)입니다. 주기 단축을 권고합니다`)
    } else if (avgPct >= 70) {
      adjustment = -1
      reasons.push(`이 장비는 동종 장비군 상위 ${(100 - avgPct).toFixed(0)}% 수준 — 다소 빠른 마모`)
    } else if (avgPct < 30 && peer.summary.peerMeanCycleMonths > baseMonths) {
      adjustment = 2
      reasons.push(`이 장비는 동종 장비군 하위 ${avgPct.toFixed(0)}% — 평균보다 안정적`)
      reasons.push(`장비군 평균 실사용 주기 ${peer.summary.peerMeanCycleMonths}개월 (현 기준 ${baseMonths}개월보다 김)`)
    } else {
      adjustment = 0
      reasons.push(`동종 장비군 평균 수준 (백분위 ${avgPct.toFixed(0)}%)`)
    }
  }

  if (peer.summary.riskPointCount > 0) {
    reasons.push(`장비군 상위 20%에 드는 포인트 ${peer.summary.riskPointCount}개`)
  }
  reasons.push(`장비군 평균 실사용 교정주기: ${peer.summary.peerMeanCycleMonths}개월`)

  return {
    adjustment,
    reasons,
    warnings,
    confidence,
    data: {
      available: peer.available,
      groupKey: peer.groupKey,
      totalPeerCount: peer.totalPeerCount,
      totalCertCount: peer.totalCertCount,
      avgPercentile: avgPct,
      peerMeanCycleMonths: peer.summary.peerMeanCycleMonths,
      riskPointCount: peer.summary.riskPointCount,
      position,
      points: peer.points.map(p => ({
        label: p.label,
        thisUsage: p.thisUsage,
        peerMeanUsage: p.peerMeanUsage,
        peerP90Usage: p.peerP90Usage,
        thisPercentile: p.thisPercentile,
        peerMeanMonthsToLimit: p.peerMeanMonthsToLimit,
      })),
    },
  }
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
  // crossing 기반 권고: 가장 빠른 tolerance 초과 시점을 근거로 한 주기.
  //   finalMonths의 단일 진실 — 차트(ErrorForecastChart)·처방(buildPrescription)과 일치.
  crossingBased: {
    drivenBy: string | null       // 가장 빨리 초과하는 측정점 라벨
    earliestCrossMonths: number | null  // 그 포인트의 초과 시점(개월, 직전 교정일 기준)
    safetyMarginMonths: number    // 적용한 안전마진
  }
}

export function step5_finalize(
  step1: StepResult<BaselineData>,
  step2: StepResult<TrendDriftData>,
  step3: StepResult<UncertaintyRiskData>,
  step4: StepResult<unknown> | undefined,    // 1차에서는 undefined
  series: TrendSeries[] = [],                 // crossing 기반 권고용 (없으면 합산 로직만)
): StepResult<FinalDecisionData> {
  const base = step1.data.baseMonths
  const trendAdj = step2.adjustment
  const riskAdj = step3.adjustment
  const contextAdj = step4?.adjustment ?? 0

  const sum = base + trendAdj + riskAdj + contextAdj

  const MIN = 3
  const MAX = 60

  // ── crossing 기반 권고 (단일 진실) ──
  // 각 측정점의 (|오차|+U)가 tolerance 한계에 닿는 시점(crossing)을 구하고,
  // 가장 빠른 것 − 안전마진을 권고 주기로 삼는다. 차트·처방과 항상 일치.
  //   crossing 이 없으면(전부 안전) 기존 합산 로직(sum)을 따른다.
  let drivenBy: string | null = null
  let earliestCrossMonths: number | null = null
  for (const s of series) {
    const f = buildErrorForecast(s, Math.max(base + 12, 24), base)
    const m = f.crossing.bestMonths
    if (m != null && (earliestCrossMonths == null || m < earliestCrossMonths)) {
      earliestCrossMonths = m
      drivenBy = s.label
    }
  }
  // 안전마진: 한계 닿기 전에 교정하도록 crossing 의 ~15% (최소 1개월)
  const safetyMargin = earliestCrossMonths != null
    ? Math.max(1, Math.round(earliestCrossMonths * 0.15))
    : 0

  let finalMonths: number
  if (earliestCrossMonths != null && earliestCrossMonths <= base) {
    // crossing 이 spec 주기 안 → 그 전에 교정해야. crossing − 마진.
    finalMonths = Math.max(MIN, Math.min(base, earliestCrossMonths - safetyMargin))
  } else {
    // crossing 이 없거나 spec 밖 → 기존 합산 로직.
    finalMonths = Math.max(MIN, Math.min(MAX, sum))
  }
  const clamped = (earliestCrossMonths == null && (sum < MIN || sum > MAX))

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
      crossingBased: { drivenBy, earliestCrossMonths, safetyMarginMonths: safetyMargin },
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
  step4: StepResult<PeerBenchmarkStepData> | null  // Peer Benchmark (유사장비). 비활성 시 null
  step5: StepResult<FinalDecisionData>
  // AI 종합 평가는 별도 atom 호출 결과를 UI에서 합침 (분석 결과에는 포함 안 함)
}

export interface CycleAnalysisInput {
  profile: ProfileLike | null
  ktoolsAffcCyclCd: string | null | undefined
  series: TrendSeries[]
  calDates: string[]
  // Peer Benchmark (유사장비) 데이터. 있으면 step4로 통합. 없으면 step4=null.
  peer?: PeerBenchmarkData | null
}

/**
 * 5단계 분석 전체 실행 (AI 호출은 별도)
 * 동기 함수 — 외부 API 호출 없음 (순수 데이터 기반)
 *
 * Peer Benchmark(유사장비)는 "참고용"이다 — 최종 결정(주기)에는 영향을 주지 않는다.
 *   이유: 교정주기는 "이 장비 자신의 드리프트·불확도"가 결정해야 한다(개체차가 크므로).
 *         유사장비 빅데이터는 "이 장비가 동종 대비 어떤 오차 특성을 보이는가"를
 *         보여주는 맥락(context)일 뿐, 주기를 깎는 근거로 쓰면 학문적으로 약하다.
 *   따라서 step4는 계산·표시하되 step5_finalize에는 넘기지 않는다(adjustment 무시).
 * 기존 step1·2·3·5 로직은 그대로.
 */
export function runCycleAnalysis(input: CycleAnalysisInput): CycleAnalysisResult {
  const step1 = step1_baseline(input.profile, input.ktoolsAffcCyclCd)
  const step2 = step2_trendDrift(input.series, input.calDates)
  const step3 = step3_uncertaintyRisk(input.series)
  // 결정은 step1·2·3 + crossing(외삽) — 유사장비 제외
  const step5 = step5_finalize(step1, step2, step3, undefined, input.series)
  // Peer Benchmark는 참고용 — adjustment를 0으로 덮어 "결정 미반영"을 명확히 함
  const peerStep = input.peer
    ? step4_peerBenchmark(input.peer, step1.data.baseMonths)
    : null
  const step4 = peerStep ? { ...peerStep, adjustment: 0 } : null

  return { step1, step2, step3, step4, step5 }
}

// ─────────────────────────────────────────────────────────────────
// AI 종합 평가 입력 빌더
// /api/ai/cycle-analysis 호출용 — 분석 결과를 LLM 입력 스키마로 변환
// ─────────────────────────────────────────────────────────────────

export interface CycleAnalysisLlmInput {
  equipment: {
    name: string
    manufacturer: string
    model: string
  }
  step1: {
    baseMonths: number
    source: string
    profileCategory: string | null
    profileStandards: string[]
  }
  step2: {
    adjustment: number
    confidence: ConfidenceLevel
    urgentPointCount: number
    watchPointCount: number
    safePointCount: number
    acceleratingCount: number
    maxLatestRatio: number | null
    dangerPoints: Array<{
      label: string
      latestRatio: number | null
      nearLimitCount: number
      totalCount: number
      accelerating: boolean
      accelerationRatio: number | null
      trend: 'rising' | 'falling' | 'stable' | 'volatile'
    }>
  }
  step3: {
    adjustment: number
    confidence: ConfidenceLevel
    pointsWithRecentDanger: number
    pointsWithHighUtRatio: number
    maxUtRatioOverall: number | null
    conditionalPassRatio: number
    hasGuardBandData: boolean
    overallDistribution: {
      conformant: number
      conditionalPass: number
      conditionalFail: number
      nonConformant: number
      unknown: number
      total: number
    }
  }
  step5: {
    finalMonths: number
    direction: AdjustmentDirection
    confidence: ConfidenceLevel
    breakdown: { base: number; trendAdj: number; riskAdj: number; sum: number }
    clamped: boolean
  }
}

export interface CycleAnalysisLlmResult {
  verdict: string
  concerns: string[]
  recommendations: string[]
  agreesWithRule: boolean
  contraryReason: string | null
}

export function buildCycleAnalysisLlmInput(
  analysis: CycleAnalysisResult,
  meta: { name: string; manufacturer: string; model: string },
): CycleAnalysisLlmInput {
  const s1 = analysis.step1.data
  const s2 = analysis.step2.data
  const s3 = analysis.step3.data
  const s5 = analysis.step5.data

  // step2에서 위험·주의 포인트 상위 5개만 전송 (토큰 절약)
  const dangerPoints = s2.points
    .filter(p => p.riskLevel === 'urgent' || p.riskLevel === 'watch' || p.accelerating)
    .slice(0, 5)
    .map(p => ({
      label: p.label,
      latestRatio: p.latestRatio,
      nearLimitCount: p.nearLimitCount,
      totalCount: p.totalCount,
      accelerating: p.accelerating,
      accelerationRatio: p.accelerationRatio,
      trend: p.trend,
    }))

  return {
    equipment: meta,
    step1: {
      baseMonths: s1.baseMonths,
      source: s1.sourceLabel,
      profileCategory: s1.profileCategory,
      profileStandards: s1.profileStandards,
    },
    step2: {
      adjustment: analysis.step2.adjustment,
      confidence: analysis.step2.confidence,
      urgentPointCount: s2.summary.urgentPointCount,
      watchPointCount: s2.summary.watchPointCount,
      safePointCount: s2.summary.safePointCount,
      acceleratingCount: s2.summary.acceleratingCount,
      maxLatestRatio: s2.summary.maxLatestRatio,
      dangerPoints,
    },
    step3: {
      adjustment: analysis.step3.adjustment,
      confidence: analysis.step3.confidence,
      pointsWithRecentDanger: s3.summary.pointsWithRecentDanger,
      pointsWithHighUtRatio: s3.summary.pointsWithHighUtRatio,
      maxUtRatioOverall: s3.summary.maxUtRatioOverall,
      conditionalPassRatio: s3.summary.conditionalPassRatio,
      hasGuardBandData: s3.summary.hasGuardBandData,
      overallDistribution: s3.overall,
    },
    step5: {
      finalMonths: s5.finalMonths,
      direction: s5.direction,
      confidence: s5.confidence,
      breakdown: {
        base: s5.breakdown.base,
        trendAdj: s5.breakdown.trendAdj,
        riskAdj: s5.breakdown.riskAdj,
        sum: s5.breakdown.sum,
      },
      clamped: s5.guardrail.clamped,
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Interim Check 시뮬레이션 오케스트레이터 (Future Work — 키오스크)
//
// "중간점검 데이터가 들어오면 분석이 어떻게 달라지는가"를 Before/After로 보여준다.
//   Before = 정식 교정 이력만으로 분석 (현재)
//   After  = 정식 + 키오스크 중간점검 병합 후 재분석 (미래 시나리오)
//
// 핵심: 같은 runCycleAnalysis를 두 번 돌린다. 로직은 동일, 입력 series만 다름.
//       → 중간점검점이 드리프트 추세를 촘촘히 메워 step2(드리프트) 신뢰도/민감도가 오른다.
// ─────────────────────────────────────────────────────────────────

export interface InterimSimComparison {
  available: boolean
  before: CycleAnalysisResult     // 정식 교정만
  after: CycleAnalysisResult      // 정식 + 중간점검
  simulation: InterimSimulationResult  // 키오스크 효과 메타데이터
  // 핵심 비교 지표
  delta: {
    finalMonthsBefore: number
    finalMonthsAfter: number
    confidenceBefore: ConfidenceLevel
    confidenceAfter: ConfidenceLevel
    // step2 드리프트 민감도 변화
    urgentBefore: number
    urgentAfter: number
    watchBefore: number
    watchAfter: number
  }
}

/**
 * 중간점검 시뮬레이션 실행.
 * @param input  원본 분석 입력 (정식 교정 데이터)
 * @param baseAnalysis 이미 계산된 "정식만" 분석 결과 (재사용 — 중복 계산 방지)
 */
export function runInterimSimulation(
  input: CycleAnalysisInput,
  baseAnalysis: CycleAnalysisResult,
): InterimSimComparison {
  const baseMonths = baseAnalysis.step1.data.baseMonths

  // 1. 키오스크 중간점검 데이터 생성 (더미)
  const simulation = buildInterimSimulation(
    input.series,
    baseMonths,
    { manufacturer: undefined, model: undefined },
  )

  // 2. 중간점검을 정식 series에 병합
  const mergedSeries = mergeInterimIntoSeries(input.series, simulation.interimSeries)

  // 3. 병합된 series로 재분석 (Peer는 동일하게 유지)
  const after = runCycleAnalysis({ ...input, series: mergedSeries })

  return {
    available: simulation.available,
    before: baseAnalysis,
    after,
    simulation,
    delta: {
      finalMonthsBefore: baseAnalysis.step5.data.finalMonths,
      finalMonthsAfter: after.step5.data.finalMonths,
      confidenceBefore: baseAnalysis.step2.confidence,
      confidenceAfter: after.step2.confidence,
      urgentBefore: baseAnalysis.step2.data.summary.urgentPointCount,
      urgentAfter: after.step2.data.summary.urgentPointCount,
      watchBefore: baseAnalysis.step2.data.summary.watchPointCount,
      watchAfter: after.step2.data.summary.watchPointCount,
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Prescription — "분석"을 "처방"으로 (언제까지 · 왜 · 어디를)
//
// ISO 10012 §7.1.2(확인주기 조정) + §7.3.1(불확도) + ILAC-G8(guard band) 근거.
// "언제까지 교정하라 + 안 그러면 guard-band 한계 침범 + 그때 이 포인트 집중"을 산출.
//
// 핵심 계산:
//   1. recalibrateBy = 마지막 교정일 + 권고주기(finalMonths)
//   2. 각 위험 포인트의 "guard-band 한계 침범 예측 시점":
//      현재 (|오차| + U)가 허용오차에 도달하는 시점을 드리프트 속도로 외삽
//   3. 집중 포인트 = step2 urgent/watch
//   4. 추천 교정 포인트 = 위험 구간 세분화 + 정상 포인트 기본
// ─────────────────────────────────────────────────────────────────

export interface FocusPoint {
  label: string
  level: 'critical' | 'watch' | 'nominal'
  latestUsage: number | null          // 최신 한계 사용률 %
  utRatio: number | null              // 최신 U/T %
  monthsToGuardBandLimit: number | null  // (|오차|+U)가 허용한계 도달까지 개월 (드리프트 외삽)
  note: string                        // 영어 한 줄 (예: "96% of tolerance, ~3 mo to guard-band limit")
}

export interface Prescription {
  // 언제까지
  recalibrateByMonths: number         // 권고 주기 (= step5 finalMonths)
  recalibrateByDate: string | null    // 마지막 교정일 + 권고주기 (YYYY-MM-DD)
  lastCalDate: string | null
  monthsEarlierThanSpec: number       // 기준(base) 대비 몇 개월 당겨졌나 (>0이면 단축)
  // 왜 (가장 위험한 포인트 기준)
  driver: {
    label: string                     // 단축을 이끄는 핵심 포인트 (예: "62.2 N·m")
    monthsToGuardBandLimit: number | null
    latestUsage: number | null
    utRatio: number | null
  } | null
  // 어디를
  focusPoints: FocusPoint[]           // critical → watch → (nominal 요약)
  criticalCount: number
  watchCount: number
  nominalCount: number
  // 추천 교정 포인트 (위험 구간 세분화)
  recommendedPoints: string[]
}

/**
 * "YYYY-MM-DD" + N개월 (월 단위, 일자 유지). 실패 시 null.
 */
function addMonthsToDate(dateStr: string | null, months: number): string | null {
  if (!dateStr) return null
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  const total = (mo - 1) + months
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * 한 series의 "guard-band 한계 침범까지 개월" 외삽.
 * (|오차| + U) 가 허용오차(tol)에 도달하는 시점.
 *   - 최근 2개 유효점으로 (|오차|+U) 증가 속도(월당)를 추정
 *   - 이미 도달했으면 0, 증가 안 하면 null
 */
function monthsToGuardBandLimit(s: TrendSeries): number | null {
  const valid = s.points.filter(p => p.오차 != null && p.허용오차 != null && p.교정일)
  if (valid.length < 2) return null
  const tol = Math.abs(valid[valid.length - 1].허용오차 as number)
  if (tol <= 0) return null

  // (|오차| + U) 시계열
  const margin = (p: TrendPoint): number => {
    const err = Math.abs(p.오차 as number)
    const u = p.불확도 != null ? Math.abs(p.불확도) : 0
    return err + u
  }
  const last = valid[valid.length - 1]
  const prev = valid[valid.length - 2]
  const curMargin = margin(last)
  if (curMargin >= tol) return 0  // 이미 침범

  const months = monthsBetween(prev.교정일, last.교정일)
  if (months <= 0) return null
  const rate = (curMargin - margin(prev)) / months  // 월당 증가
  if (rate <= 0.001) return null  // 증가 안 함 → 도달 안 함
  return Math.round((tol - curMargin) / rate)
}

function monthsBetween(a: string, b: string): number {
  const ma = a.match(/^(\d{4})-(\d{2})/)
  const mb = b.match(/^(\d{4})-(\d{2})/)
  if (!ma || !mb) return 0
  return (parseInt(mb[1]) - parseInt(ma[1])) * 12 + (parseInt(mb[2]) - parseInt(ma[2]))
}

function latestUsageOf(s: TrendSeries): number | null {
  for (let i = s.points.length - 1; i >= 0; i--) {
    if (s.points[i].비율 != null) return s.points[i].비율
  }
  return null
}
function latestUtOf(s: TrendSeries): number | null {
  for (let i = s.points.length - 1; i >= 0; i--) {
    if (s.points[i].utRatio != null) return s.points[i].utRatio
  }
  return null
}
function latestCalDateOf(series: TrendSeries[]): string | null {
  let latest: string | null = null
  for (const s of series) {
    for (const p of s.points) {
      if (p.교정일 && (latest == null || p.교정일 > latest)) latest = p.교정일
    }
  }
  return latest
}

/**
 * 처방 생성: 분석 결과 + series → "언제까지·왜·어디를".
 * 순수 함수 (외부 호출 없음).
 */
export function buildPrescription(
  analysis: CycleAnalysisResult,
  series: TrendSeries[],
): Prescription {
  const finalMonths = analysis.step5.data.finalMonths
  const baseMonths = analysis.step1.data.baseMonths
  const lastCalDate = latestCalDateOf(series)
  const recalibrateByDate = addMonthsToDate(lastCalDate, finalMonths)
  const monthsEarlierThanSpec = baseMonths - finalMonths

  // step2 위험도 맵 (label → riskLevel)
  const riskByLabel = new Map(analysis.step2.data.points.map(p => [p.label, p.riskLevel]))

  // 각 포인트 처방 정보
  const focusPoints: FocusPoint[] = series.map(s => {
    const risk = riskByLabel.get(s.label) ?? 'safe'
    const level: FocusPoint['level'] =
      risk === 'urgent' ? 'critical' : risk === 'watch' ? 'watch' : 'nominal'
    const latestUsage = latestUsageOf(s)
    const utRatio = latestUtOf(s)
    const m2limit = monthsToGuardBandLimit(s)

    let note = ''
    if (level === 'critical') {
      note = `${latestUsage?.toFixed(0) ?? '?'}% of tolerance` +
        (m2limit != null ? ` · ~${m2limit} mo to guard-band limit` : '')
    } else if (level === 'watch') {
      note = `${latestUsage?.toFixed(0) ?? '?'}% of tolerance · rising`
    } else {
      note = `${latestUsage?.toFixed(0) ?? '?'}% · nominal`
    }

    return { label: s.label, level, latestUsage, utRatio, monthsToGuardBandLimit: m2limit, note }
  })

  // 위험도 순 정렬 (critical → watch → nominal), 같은 등급은 사용률 높은 순
  const order = { critical: 0, watch: 1, nominal: 2 }
  focusPoints.sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level]
    return (b.latestUsage ?? 0) - (a.latestUsage ?? 0)
  })

  const criticalCount = focusPoints.filter(p => p.level === 'critical').length
  const watchCount = focusPoints.filter(p => p.level === 'watch').length
  const nominalCount = focusPoints.filter(p => p.level === 'nominal').length

  // driver = 가장 위험한 포인트 (한계 침범 가장 빠른 critical, 없으면 사용률 최고)
  const criticals = focusPoints.filter(p => p.level === 'critical')
  const driverPoint =
    criticals.length > 0
      ? criticals.reduce((best, p) =>
          (p.monthsToGuardBandLimit ?? Infinity) < (best.monthsToGuardBandLimit ?? Infinity) ? p : best,
        )
      : focusPoints[0] ?? null

  const driver = driverPoint
    ? {
        label: driverPoint.label,
        monthsToGuardBandLimit: driverPoint.monthsToGuardBandLimit,
        latestUsage: driverPoint.latestUsage,
        utRatio: driverPoint.utRatio,
      }
    : null

  // 추천 교정 포인트: critical/watch는 그 주변을 세분화, 나머지는 그대로
  const recommendedPoints = buildRecommendedPoints(focusPoints)

  return {
    recalibrateByMonths: finalMonths,
    recalibrateByDate,
    lastCalDate,
    monthsEarlierThanSpec,
    driver,
    focusPoints,
    criticalCount,
    watchCount,
    nominalCount,
    recommendedPoints,
  }
}

/**
 * 추천 교정 포인트 생성.
 * - critical 포인트: 그 값 + 인접 중간값(세분화)
 * - watch 포인트: 그 값 포함
 * - nominal: 대표 몇 개만
 * 라벨에서 숫자를 파싱해 정렬·세분화. 파싱 실패 시 라벨 그대로.
 */
function buildRecommendedPoints(focus: FocusPoint[]): string[] {
  const parseVal = (label: string): number | null => {
    const m = label.match(/([\d.]+)/)
    return m ? parseFloat(m[1]) : null
  }
  const unit = (() => {
    const m = focus[0]?.label.match(/[\d.]+\s*(.+)$/)
    return m ? m[1].trim() : ''
  })()

  const vals = focus
    .map(f => ({ v: parseVal(f.label), level: f.level }))
    .filter((x): x is { v: number; level: FocusPoint['level'] } => x.v != null)
    .sort((a, b) => a.v - b.v)

  if (vals.length === 0) return focus.map(f => f.label)

  const out = new Set<number>()
  for (let i = 0; i < vals.length; i++) {
    const { v, level } = vals[i]
    out.add(v)
    // critical: 직전 포인트와의 중간값 추가 (위험 구간 세분화)
    if (level === 'critical' && i > 0) {
      const mid = Math.round(((vals[i - 1].v + v) / 2) * 10) / 10
      out.add(mid)
    }
    if (level === 'critical' && i < vals.length - 1) {
      const mid = Math.round(((v + vals[i + 1].v) / 2) * 10) / 10
      out.add(mid)
    }
  }
  return [...out].sort((a, b) => a - b).map(v => `${v} ${unit}`.trim())
}
