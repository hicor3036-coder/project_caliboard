// 측정신뢰성 모델 (RP-1 / AFMETCAL 정면 구현) — ICMPM2026 발표용
//
// ════════════════════════════════════════════════════════════════════
// 무엇을 하는가
// ════════════════════════════════════════════════════════════════════
//
// "이 장비, 몇 개월 지나면 못 믿게 되나?"를 RP-1(NCSLI Recommended Practice-1,
// 미 공군 AFMETCAL이 실제 구현한 방식)의 측정신뢰성 모델로 답한다.
//
//   측정신뢰성 R(t) = "교정 후 t개월 시점에 모집단이 규격 안(in-tolerance)일 확률"
//   시간↑ → 불확도 성장 → R(t)↓.  R(t)가 신뢰성 목표(85%)에 닿는 시점 = 최적 교정주기.
//
// ════════════════════════════════════════════════════════════════════
// 왜 fleet(모집단)인가 — 선형회귀(이 장비 1대 외삽)와 근본적으로 다르다
// ════════════════════════════════════════════════════════════════════
//
//   선형회귀(기존 cycle-analysis):  이 장비 1대의 "오차값"을 시간순 직선 외삽.
//   신뢰성 모델(이 파일):           같은 모델 수백 대의 "합격/불합격"을 모아 확률곡선.
//
//   RP-1 §2.7.1: "단일 시리얼로는 충분한 데이터가 현실적으로 거의 안 모인다."
//   → 모델/클래스 단위 모집단(20~40건+)이 있어야 신뢰성 곡선을 복원할 수 있다.
//   → 대규모 교정 모집단을 가진 KTL만 가능 = 데이터 해자.
//
// ════════════════════════════════════════════════════════════════════
// "모두 1년 주기인데 경과시간별 데이터를 어떻게 아나?" — RP-1의 트릭
// ════════════════════════════════════════════════════════════════════
//
//   현실: 모든 장비가 정확히 12.0개월이 아니다. 실제 교정 간격은 바쁜 일정·라인 정지·
//         수리 후 재교정 등으로 8~16개월로 자연스럽게 흩어진다.
//   → 일부러 3·6·9개월 추가 교정(비용 폭발) 안 해도, 흩어진 기존 데이터가
//     여러 시간대의 합격/불합격 표본을 만들어준다.
//   → 각 장비의 (경과개월, 합격/불합격) 한 줄씩이면 MLE가 곡선을 역산한다(binomial, RP-1 S2).
//
//   부족분은? → 중간점검(키오스크) Future Work가 정식 교정 사이를 메워 곡선을 강화한다.
//
// ════════════════════════════════════════════════════════════════════
// 설계 원칙
// ════════════════════════════════════════════════════════════════════
//   1. 기존 cycle-analysis.ts(5단계)·cycle-analysis-dummy.ts는 절대 안 건드림. 완전 독립.
//   2. 더미데이터 — RP-1 교과서급 이상적 모집단을 결정적(시드 기반)으로 합성.
//      실데이터 전환 시 buildFleetObservations만 교체.
//   3. 발표 문구 안전성: target=85%는 "AFMETCAL 참조값"으로 라벨. "우리 기준 85%" ❌.

import type { TrendSeries } from './equipment-health'
// Reactive(tier-4) 주기는 기존 검증된 드리프트 외삽 로직을 그대로 재사용.
//   (cycle-analysis-dummy의 buildErrorForecast — 기존 탭과 동일 엔진, 무영향)
import { buildErrorForecast } from './cycle-analysis-dummy'

// ─────────────────────────────────────────────────────────────────
// 결정적 의사난수 (cycle-analysis-dummy와 동일 계열 — 발표 중 안정성)
// ─────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function gaussian(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * sd
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function round1(v: number): number {
  return Math.round(v * 10) / 10
}

// 신뢰성 목표 — AFMETCAL이 채택한 값. 보편상수가 아니라 "참조값".
export const RELIABILITY_TARGET = 0.85

// ─────────────────────────────────────────────────────────────────
// 1) Fleet 관측 데이터 — 모집단 합성 (binomial: 각 장비 합격/불합격)
//
//   같은 모델 N대의 "이번 교정 시점 경과개월 + in-tolerance 여부".
//   RP-1의 입력 형식 그 자체. 더미라 이상적 모집단을 합성하되,
//   ① 경과시간을 8~16개월로 흩뿌리고 ② 시간↑일수록 합격률↓이 되도록 만든다.
// ─────────────────────────────────────────────────────────────────

export interface FleetObservation {
  months: number       // 직전 교정으로부터 경과 개월 (교정 시점)
  inTolerance: boolean // 그 교정에서 규격 안이었나 (합격=true)
}

export interface FleetData {
  available: boolean
  groupKey: string          // 장비군 식별 (예: "Torque Wrench (SNAP-ON)")
  unitCount: number         // 모집단 장비 대수
  observationCount: number  // 총 관측(교정) 건수
  observations: FleetObservation[]
  // 이 장비(시리얼) 자신의 위치 — 모집단 대비 빠른가/느린가
  thisUnitTrueLambda: number | null   // 이 장비의 실제 감쇠율 (합성/추정)
  // 모집단을 만든 "진짜" 파라미터 (검증·발표 설명용)
  trueLambdaPerMonth: number
}

/**
 * 이 장비의 실제 series에서 "이 개체가 빠른 마모인지" 힌트를 뽑는다.
 * 최신 한계 사용률이 높을수록 → 이 장비의 감쇠율(λ)을 모집단보다 크게(빨리 닳게).
 */
function estimateThisUnitDecay(series: TrendSeries[]): number | null {
  let maxUsage: number | null = null
  for (const s of series) {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].비율 != null) {
        const v = s.points[i].비율 as number
        if (maxUsage == null || v > maxUsage) maxUsage = v
        break
      }
    }
  }
  return maxUsage
}

// ─────────────────────────────────────────────────────────────────
// 이 장비(시리얼) 자신의 이력 — 모집단 곡선 위에 "내 위치"를 찍기 위한 추출
//
//   모집단 곡선은 "이 모델은 보통 어떻다"를 그린다. 하지만 RP-1은 거기서 멈추지
//   않는다 — "이 개체가 모집단의 어디쯤인가"로 개별 보정한다.
//   각 정식 교정 시점마다 (직전 교정으로부터 경과개월, 그 시점 신뢰성)을 뽑는다.
//
//   ★ 사용률 → 신뢰성 환산 (핵심):
//     한계 사용률 u%(=|오차|/허용오차)는 "한계에 얼마나 가까운가"다. 신뢰성은
//     "규격 안에 있을 확률"이다. 둘은 1:1이 아니다. 여유(margin = 1 − u/100)가
//     클수록 합격이 확실 → 신뢰성↑. 정규근사로:  R = Φ(margin / σ_n), σ_n은
//     측정 산포(허용오차 대비 ~20% 가정). u가 작으면(여유 큼) R→~1, u→100%면 R→0.5,
//     u>100%면 R<0.5. → 모집단 곡선(같은 Y축 0~1)에 자연스럽게 얹힌다.
// ─────────────────────────────────────────────────────────────────

export interface ThisUnitPoint {
  months: number          // 직전 교정으로부터 경과 개월
  reliability: number      // 0~1 (가드밴드 유효 사용률 → 정규근사)
  date: string             // 교정일 (툴팁용)
  maxUsage: number         // 그 시점 최대 한계 사용률 (오차만, %)
  guardedUsage: number     // 불확도 포함 유효 사용률 (|오차|+U)/허용오차 (%)
}

export interface ThisUnitTrace {
  available: boolean
  points: ThisUnitPoint[]
  // 모집단 대비 위치 (이 개체의 실측 신뢰성이 모집단 곡선보다 낮으면 "빠른 마모")
  position: 'faster' | 'average' | 'slower' | null
  // 이 개체 점들이 모집단 곡선 대비 평균적으로 얼마나 벗어났나 (%p, 음수=빨리 닳음)
  meanDeviationPct: number | null
  // ── 개체 자신의 신뢰성 곡선 (모집단과 별개) ──
  unitLambda: number | null         // 이 개체 감쇠율 (로그선형 회귀)
  unitOptimalMonths: number | null  // 이 개체 곡선이 85% 닿는 시점 = 개체 권장주기
  unitCurveFitted: boolean          // 곡선 피팅 성공 여부 (점 부족/추세 없으면 false)
}

function monthsBetween(a: string, b: string): number {
  const ma = a.match(/^(\d{4})-(\d{2})/)
  const mb = b.match(/^(\d{4})-(\d{2})/)
  if (!ma || !mb) return 0
  return (parseInt(mb[1]) - parseInt(ma[1])) * 12 + (parseInt(mb[2]) - parseInt(ma[2]))
}

/** 표준정규 CDF Φ(x) (Abramowitz-Stegun 26.2.17 근사) */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x >= 0 ? 1 - tail : tail
}

/**
 * ★ 가드밴드(불확도 포함) 유효 사용률 → 그 시점 측정신뢰성.
 *
 *   오차만 보는 게 아니라 불확도 U까지 합친 "유효 사용률"을 쓴다 (ILAC-G8 가드밴드).
 *     guardedUsage = (|오차| + U) / 허용오차 × 100   ← 불확도가 직접 들어감
 *   이 값이 100%(한계)에 가까울수록 "불확도까지 감안하면 한계 침범 임박" = 신뢰성↓.
 *
 *   여유 margin = 1 − guardedUsage/100. 측정 재현성 산포 σ_n로 정규근사:
 *     R = Φ(margin / σ_n).  여유 충분 → R≈1, 한계 도달 → R=0.5, 한계 초과 → R<0.5.
 *
 *   → 같은 오차라도 U가 크면 신뢰성이 더 낮게 나온다 = 불확도 반영. (RP-18 FAR 정신)
 */
function guardedUsageToReliability(guardedUsagePct: number): number {
  const SIGMA_N = 0.3          // 측정 재현성 산포 (허용오차 대비). 가드밴드를 이미 더했으므로
                               // 사용률만 볼 때(0.4)보다 작게 — 이중 가산 방지.
  const margin = 1 - guardedUsagePct / 100
  return clamp(normalCdf(margin / SIGMA_N), 0, 1)
}

/**
 * 이 장비 series에서 교정 시점별 (경과개월, 신뢰성) 추출 — 불확도 포함.
 * 각 교정일마다 모든 측정 포인트 중 "가드밴드 유효 사용률(|오차|+U)/허용오차"이
 * 가장 큰(=가장 위험한) 포인트를 그 시점의 대표로 삼는다.
 *   (장비 합격여부는 가장 나쁜 포인트가 결정하므로.)
 */
const EMPTY_TRACE: ThisUnitTrace = {
  available: false, points: [], position: null, meanDeviationPct: null,
  unitLambda: null, unitOptimalMonths: null, unitCurveFitted: false,
}

export function extractThisUnitTrace(series: TrendSeries[]): ThisUnitTrace {
  if (series.length === 0) return { ...EMPTY_TRACE }

  // 교정일별로 "그 날 모든 포인트 중 최대 가드밴드 유효 사용률"을 모은다.
  //   guardedUsage = (|오차| + U) / 허용오차 × 100.
  //   불확도가 없으면 오차만으로 (|오차|/허용오차) — 정직하게 fallback.
  const byDate = new Map<string, { guarded: number; rawUsage: number }>()
  for (const s of series) {
    for (const p of s.points) {
      if (p.판정 === 'interim') continue          // 키오스크 중간점검점 제외 (정식만)
      if (p.교정일 == null) continue
      if (p.오차 == null || p.허용오차 == null) continue
      const tol = Math.abs(p.허용오차 as number)
      if (tol <= 0) continue
      const err = Math.abs(p.오차 as number)
      const u = p.불확도 != null ? Math.abs(p.불확도 as number) : 0
      const guarded = ((err + u) / tol) * 100         // 불확도 포함 유효 사용률
      const rawUsage = (err / tol) * 100               // 오차만 (참고/툴팁용)
      const cur = byDate.get(p.교정일)
      if (cur == null || guarded > cur.guarded) byDate.set(p.교정일, { guarded, rawUsage })
    }
  }

  const dates = [...byDate.keys()].sort()
  if (dates.length < 2) return { ...EMPTY_TRACE }

  // 첫 교정을 t=0 기준으로 경과개월 산출
  const base = dates[0]
  const points: ThisUnitPoint[] = dates.map(d => {
    const { guarded, rawUsage } = byDate.get(d) as { guarded: number; rawUsage: number }
    return {
      months: monthsBetween(base, d),
      reliability: guardedUsageToReliability(guarded),
      date: d,
      maxUsage: round1(rawUsage),       // 표시는 오차 사용률 (직관적)
      guardedUsage: round1(guarded),    // 불확도 포함 — 툴팁/배지용
    }
  })

  // ── 개체 자신의 신뢰성 곡선 피팅 (로그선형: ln R = −λ·t) ──
  const unit = fitUnitReliabilityCurve(points)

  return {
    available: true,
    points,
    position: null,
    meanDeviationPct: null,
    unitLambda: unit.lambda,
    unitOptimalMonths: unit.optimalMonths,
    unitCurveFitted: unit.fitted,
  }
}

/**
 * 이 개체 실측점 (months, reliability)에 지수 신뢰성곡선 R=e^(−λt) 피팅.
 *   ln R = −λ·t 의 로그선형 회귀로 λ 추정 (원점 통과 강제 X — 절편 허용 후 보정).
 *   R=1(완전 합격)은 ln 발산하므로 0.999로 클램프. 점 부족·추세 미약하면 fitted=false.
 */
function fitUnitReliabilityCurve(points: ThisUnitPoint[]): {
  lambda: number | null; optimalMonths: number | null; fitted: boolean
} {
  const pts = points.filter(p => p.months >= 0)
  if (pts.length < 3) return { lambda: null, optimalMonths: null, fitted: false }

  // ln R 회귀 (t를 X, lnR을 Y). 절편 b, 기울기 m → R(t)=e^(b+m·t), λ=−m.
  const xs = pts.map(p => p.months)
  const ys = pts.map(p => Math.log(clamp(p.reliability, 1e-4, 0.999)))
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my) }
  if (sxx <= 1e-9) return { lambda: null, optimalMonths: null, fitted: false }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const lambda = -slope

  // 감쇠 추세가 거의 없으면(λ≈0 또는 양의 절편으로 발산) 곡선 권고 보류
  if (lambda <= 0.0005) return { lambda: round4(lambda), optimalMonths: null, fitted: false }

  // R(t)=e^(intercept−λt)=0.85 → t = (intercept − ln0.85)/λ
  const t85 = (intercept - Math.log(RELIABILITY_TARGET)) / lambda
  const optimalMonths = t85 > 0 ? round1(t85) : null
  return { lambda: round4(lambda), optimalMonths, fitted: optimalMonths != null }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

/**
 * 이 개체 실측점을 모집단 곡선과 비교 → 위치(빠름/평균/느림) 판정.
 *   각 실측점에서 (이 장비 신뢰성 − 모집단 곡선 신뢰성)의 평균을 본다.
 *   음수(곡선보다 아래) = 같은 경과시간에 더 많이 닳음 = faster.
 */
function compareTraceToFleet(trace: ThisUnitPoint[], lambda: number): {
  position: 'faster' | 'average' | 'slower'; meanDeviationPct: number
} {
  let sum = 0
  for (const p of trace) {
    const fleetR = Math.exp(-lambda * p.months)
    sum += (p.reliability - fleetR)
  }
  const meanDev = (sum / trace.length) * 100   // %p
  const position = meanDev < -3 ? 'faster' : meanDev > 3 ? 'slower' : 'average'
  return { position, meanDeviationPct: round1(meanDev) }
}

/**
 * Fleet 모집단 합성.
 *
 * @param series 이 장비 시계열 (이 개체 위치 추정 + 시드용)
 * @param meta   장비 식별 (시드 + 그룹명)
 */
export function buildFleetData(
  series: TrendSeries[],
  meta: { manufacturer?: string; model?: string; category?: string | null },
): FleetData {
  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|fleet`)
  const rng = makeRng(seed)

  const groupKey = inferGroupName(meta)

  // 모집단 규모 — RP-1 MLE 요건(클래스 ~40건)을 넉넉히 넘는 수백 대 (발표용 해자 강조)
  const unitCount = 220 + Math.floor(rng() * 260)            // 220~480대

  // 모집단의 "진짜" 감쇠율 λ (월당). 12개월 부근에서 신뢰성 ~85% 되도록 역산.
  //   R(12) ≈ 0.85  →  e^(−12λ) = 0.85  →  λ = −ln(0.85)/12 ≈ 0.0135.
  //   장비군마다 시드로 약간 변주 (8~16개월에서 85% 닿도록).
  const targetMonthsAt85 = clamp(gaussian(rng, 12.5, 1.8), 8, 17)
  const trueLambdaPerMonth = -Math.log(RELIABILITY_TARGET) / targetMonthsAt85

  // 각 장비의 1회 교정 관측 생성: 경과개월을 8~16개월로 흩뿌리고,
  //   그 시점 신뢰성 R(months)=e^(−λ·months)을 합격 확률로 베르누이 시행.
  const observations: FleetObservation[] = []
  for (let i = 0; i < unitCount; i++) {
    const uRng = makeRng(seed + i * 6151)
    // 장비마다 1~3회 이력 (관측 수 늘려 곡선 안정화)
    const records = 1 + Math.floor(uRng() * 3)
    // 개체차: 일부 장비는 모집단 평균보다 빨리/느리게 닳음 (λ를 개체별 변주)
    const unitLambda = clamp(trueLambdaPerMonth * gaussian(uRng, 1, 0.18), trueLambdaPerMonth * 0.5, trueLambdaPerMonth * 1.8)
    for (let r = 0; r < records; r++) {
      // 경과개월: 평균 12, 표준편차 ~2.2 → 8~16개월 자연 분산
      const months = clamp(gaussian(uRng, 12, 2.2), 5, 20)
      const reliabilityAtT = Math.exp(-unitLambda * months)
      const inTolerance = uRng() < reliabilityAtT
      observations.push({ months: round1(months), inTolerance })
    }
  }

  return {
    available: true,
    groupKey,
    unitCount,
    observationCount: observations.length,
    observations,
    thisUnitTrueLambda: null,        // 아래 fitReliabilityModel에서 이 장비 위치로 계산
    trueLambdaPerMonth,
  }
  // 주: 이 장비 위치(thisUnitTrueLambda)는 estimateThisUnitDecay로 별도 산출 가능.
  //     모델 피팅과 분리해두어 "모집단 곡선 vs 이 장비"를 UI에서 겹쳐 그린다.
}

// ─────────────────────────────────────────────────────────────────
// 1-b) 측정포인트별 모집단 — RP-1 정석 (포인트마다 신뢰성 다름)
//
//   토크렌치는 저토크(50 N·m)에서 마모가 빠르고 고토크에서 안정적이다.
//   "장비 전체"로 합치면 위험 포인트가 안정 포인트에 희석된다 →
//   각 측정포인트마다 모집단 신뢰성 곡선을 따로 만든다. (Tier-4 Drift처럼 포인트별)
//   최종 권장주기 = 가장 빨리 85% 닿는 포인트가 결정 (RP-1 worst-point 원칙).
//
//   각 포인트의 모집단 λ는 "이 장비에서 그 포인트가 얼마나 빨리 닳는지"를 반영해
//   합성한다 → 이 장비가 50 N·m에서 위험하면 모집단 50 N·m 곡선도 빨리 떨어진다.
// ─────────────────────────────────────────────────────────────────

export interface PointFleet {
  label: string                  // 측정포인트 (예: "50 N·m")
  fleet: FleetData               // 그 포인트의 동질그룹 모집단 관측
  thisUnitUsage: number | null   // 이 장비 그 포인트 최신 한계 사용률 (그룹 배정 힌트)
}

/** 이 장비의 한 측정포인트 시계열에서 "최신 가드밴드 유효 사용률" 추출 */
function pointLatestGuardedUsage(s: TrendSeries): number | null {
  for (let i = s.points.length - 1; i >= 0; i--) {
    const p = s.points[i]
    if (p.판정 === 'interim') continue
    if (p.오차 == null || p.허용오차 == null) continue
    const tol = Math.abs(p.허용오차 as number)
    if (tol <= 0) continue
    const u = p.불확도 != null ? Math.abs(p.불확도 as number) : 0
    return ((Math.abs(p.오차 as number) + u) / tol) * 100
  }
  return null
}

// ─────────────────────────────────────────────────────────────────
// 동질 하위그룹 (Homogeneous Subgroup) — RP-1 §2.7.1
//
//   MLE 모집단은 "모델 전체"가 아니라 "불확도 성장이 비슷한 동질 그룹"이다.
//   사용빈도·환경이 다르면 drift가 다르므로 같은 모델이라도 하위그룹으로 나눈다.
//   이 장비의 마모 속도(드리프트)로 이 장비가 속한 사용조건 그룹을 추정한다.
//     → 빠른 마모 = "high-usage / harsh" 그룹, 평균 = "typical", 느림 = "light"
// ─────────────────────────────────────────────────────────────────

export type UsageSubgroup = 'harsh' | 'typical' | 'light'

export interface SubgroupInfo {
  subgroup: UsageSubgroup
  label: string              // 발표용 (예: "high-usage / harsh")
  driftFactor: number        // typical=1.0, harsh>1(빨리닳음), light<1
}

/** 이 장비의 평균 드리프트 속도로 사용조건 하위그룹 추정 */
function inferSubgroup(series: TrendSeries[]): SubgroupInfo {
  // 전 포인트 최신 사용률의 최댓값으로 마모 정도 판단
  let maxUsage = 0
  for (const s of series) {
    const u = pointLatestGuardedUsage(s)
    if (u != null && u > maxUsage) maxUsage = u
  }
  if (maxUsage >= 75) return { subgroup: 'harsh', label: 'high-usage / harsh', driftFactor: 1.0 }
  if (maxUsage >= 45) return { subgroup: 'typical', label: 'typical-usage', driftFactor: 1.0 }
  return { subgroup: 'light', label: 'light-usage', driftFactor: 1.0 }
}

/**
 * 측정포인트별 동질그룹 모집단 합성.
 *   각 포인트의 모집단 "진짜 λ"를 이 장비 그 포인트 사용률로 기울인다.
 *   (같은 사용조건 그룹이므로 이 장비와 drift 특성이 닮은 모집단)
 */
export function buildPointFleets(
  series: TrendSeries[],
  meta: { manufacturer?: string; model?: string; category?: string | null },
  subgroupLabel: string,
): PointFleet[] {
  const out: PointFleet[] = []
  for (let idx = 0; idx < series.length; idx++) {
    const s = series[idx]
    const usage = pointLatestGuardedUsage(s)
    const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|${s.label}|pfleet`)
    const rng = makeRng(seed)

    // 이 포인트의 모집단 "85% 도달 개월" 결정:
    //   사용률 60% → ~12mo, 사용률 90% → ~7mo, 사용률 30% → ~20mo (선형 보간 + 시드 변주)
    const u = usage ?? 55
    const baseMonthsAt85 = clamp(24 - (u - 30) * (24 - 7) / (90 - 30), 6, 30)
    const monthsAt85 = clamp(gaussian(rng, baseMonthsAt85, 1.2), 5, 32)
    const trueLambda = -Math.log(RELIABILITY_TARGET) / monthsAt85

    // 동질그룹 규모 (모델 전체보다 작음 — 조건으로 좁혔으니)
    const unitCount = 120 + Math.floor(rng() * 160)
    const observations: FleetObservation[] = []
    for (let i = 0; i < unitCount; i++) {
      const uRng = makeRng(seed + i * 7177)
      const recs = 1 + Math.floor(uRng() * 3)
      const unitLambda = clamp(trueLambda * gaussian(uRng, 1, 0.18), trueLambda * 0.5, trueLambda * 1.8)
      for (let r = 0; r < recs; r++) {
        const months = clamp(gaussian(uRng, 12, 2.4), 4, 22)
        const inTolerance = uRng() < Math.exp(-unitLambda * months)
        observations.push({ months: round1(months), inTolerance })
      }
    }

    out.push({
      label: s.label,
      thisUnitUsage: usage != null ? round1(usage) : null,
      fleet: {
        available: true,
        groupKey: `${inferGroupName(meta)} · ${subgroupLabel}`,
        unitCount,
        observationCount: observations.length,
        observations,
        thisUnitTrueLambda: null,
        trueLambdaPerMonth: trueLambda,
      },
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────
// 2) MLE 피팅 — 지수형 신뢰성 모델 R(t) = e^(−λt)
//
//   binomial(합격=1/불합격=0) 관측에 대한 최대우도추정(RP-1 Method S2).
//   우도:  L(λ) = Π R(tᵢ)^(yᵢ) · (1−R(tᵢ))^(1−yᵢ),  R(tᵢ)=e^(−λtᵢ)
//   로그우도를 λ에 대해 최대화. 1차원이라 황금분할/격자탐색으로 충분.
//
//   ★ "곡선 모양(지수형)은 우리가 정하고, 얼마나 가파른지(λ)는 데이터가 정한다."
//      그 λ를 데이터에서 역산하는 계산이 MLE.
// ─────────────────────────────────────────────────────────────────

/** 로그우도 (수치 안정화: R을 (eps, 1−eps)로 클램프) */
function logLikelihood(lambda: number, obs: FleetObservation[]): number {
  if (lambda <= 0) return -Infinity
  const eps = 1e-9
  let ll = 0
  for (const o of obs) {
    const R = clamp(Math.exp(-lambda * o.months), eps, 1 - eps)
    ll += o.inTolerance ? Math.log(R) : Math.log(1 - R)
  }
  return ll
}

/** 1차원 로그우도 최대화 (격자 + 황금분할 정밀화). λ 범위 월당 0.0005~0.2 */
function maximizeLambda(obs: FleetObservation[]): number {
  if (obs.length === 0) return -Math.log(RELIABILITY_TARGET) / 12
  // 1차: 거친 격자 탐색
  let bestLambda = 0.01
  let bestLL = -Infinity
  const LO = 0.0005, HI = 0.2
  const STEPS = 200
  for (let i = 0; i <= STEPS; i++) {
    const lambda = LO + ((HI - LO) * i) / STEPS
    const ll = logLikelihood(lambda, obs)
    if (ll > bestLL) { bestLL = ll; bestLambda = lambda }
  }
  // 2차: 최적 근방 황금분할 정밀화
  let a = Math.max(LO, bestLambda - (HI - LO) / STEPS)
  let b = Math.min(HI, bestLambda + (HI - LO) / STEPS)
  const gr = (Math.sqrt(5) - 1) / 2
  for (let iter = 0; iter < 60; iter++) {
    const c = b - gr * (b - a)
    const d = a + gr * (b - a)
    if (logLikelihood(c, obs) > logLikelihood(d, obs)) b = d
    else a = c
  }
  return (a + b) / 2
}

export interface ReliabilityCurvePoint {
  months: number
  reliability: number   // 0~1
}

export interface ReliabilityFit {
  available: boolean
  lambdaPerMonth: number          // MLE 추정 감쇠율
  // 곡선 (0 ~ horizon개월, 촘촘히)
  curve: ReliabilityCurvePoint[]
  // 신뢰성이 target(85%)에 닿는 시점 = 최적 주기
  optimalMonths: number | null
  reliabilityAtSpec: number | null // 현 spec 주기(base)에서의 신뢰성
  target: number                   // 0.85
  // 모델 적합도 / 데이터 규모 (발표 신뢰도 표기)
  observationCount: number
  // 데이터를 구간 집계한 "관측 신뢰성 점들" (곡선 위에 산점도로 겹쳐 그림)
  empirical: Array<{ months: number; reliability: number; n: number }>
}

/**
 * 모집단 관측 → 지수형 신뢰성 모델 MLE 피팅.
 *
 * @param fleet       모집단 관측
 * @param specMonths  현 spec 주기 (reliabilityAtSpec 산출용)
 * @param horizonMonths 곡선을 그릴 최대 개월 (기본 36)
 */
export function fitReliabilityModel(
  fleet: FleetData,
  specMonths: number,
  horizonMonths = 36,
): ReliabilityFit {
  const obs = fleet.observations
  if (obs.length < 8) {
    return {
      available: false,
      lambdaPerMonth: 0,
      curve: [],
      optimalMonths: null,
      reliabilityAtSpec: null,
      target: RELIABILITY_TARGET,
      observationCount: obs.length,
      empirical: [],
    }
  }

  const lambda = maximizeLambda(obs)

  // 곡선 생성 (0.5개월 간격)
  const curve: ReliabilityCurvePoint[] = []
  for (let m = 0; m <= horizonMonths; m += 0.5) {
    curve.push({ months: m, reliability: Math.exp(-lambda * m) })
  }

  // target(85%) 닿는 시점: e^(−λt)=0.85 → t = −ln(0.85)/λ
  const optimalMonths = lambda > 0 ? round1(-Math.log(RELIABILITY_TARGET) / lambda) : null
  const reliabilityAtSpec = round3(Math.exp(-lambda * specMonths))

  // 관측 신뢰성 점들 (구간 집계 — 곡선 위 산점도). 2개월 빈으로 묶어 합격률 계산.
  const empirical = binEmpirical(obs, horizonMonths)

  return {
    available: true,
    lambdaPerMonth: lambda,
    curve,
    optimalMonths,
    reliabilityAtSpec,
    target: RELIABILITY_TARGET,
    observationCount: obs.length,
    empirical,
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** 관측을 경과개월 2개월 빈으로 묶어 합격률(관측 신뢰성) 산출 — 곡선 위 산점도용 */
function binEmpirical(
  obs: FleetObservation[],
  horizonMonths: number,
): Array<{ months: number; reliability: number; n: number }> {
  const BIN = 2
  const bins = new Map<number, { pass: number; total: number }>()
  for (const o of obs) {
    if (o.months > horizonMonths) continue
    const key = Math.floor(o.months / BIN)
    const b = bins.get(key) ?? { pass: 0, total: 0 }
    b.total++
    if (o.inTolerance) b.pass++
    bins.set(key, b)
  }
  const out: Array<{ months: number; reliability: number; n: number }> = []
  for (const [key, b] of [...bins.entries()].sort((a, c) => a[0] - c[0])) {
    if (b.total < 3) continue   // 표본 3건 미만 빈은 노이즈 — 제외
    out.push({
      months: key * BIN + BIN / 2,
      reliability: round3(b.pass / b.total),
      n: b.total,
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────
// 2-b) 포인트별 MLE — 각 측정포인트 모집단을 따로 피팅
// ─────────────────────────────────────────────────────────────────

export interface PointFit {
  label: string
  thisUnitUsage: number | null
  fit: ReliabilityFit
}

export interface PointReliabilityResult {
  available: boolean
  points: PointFit[]
  subgroupLabel: string              // 동질그룹 라벨 (예: "high-usage / harsh")
  groupSize: number                  // 그룹 모집단 대수 (대표값)
  // 권장주기 = 가장 빨리 85% 닿는 포인트가 결정 (RP-1 worst-point)
  drivingLabel: string | null        // 그 결정 포인트 라벨
  recommendedMonths: number | null   // = min(포인트별 optimalMonths)
}

/**
 * 측정포인트별 동질그룹 모집단 → 포인트별 MLE 피팅 → 권장주기(min) 결정.
 */
export function fitPointReliability(
  pointFleets: PointFleet[],
  specMonths: number,
  subgroupLabel: string,
  horizonMonths = 30,   // spec(12mo) 전후를 충분히 보이게.
): PointReliabilityResult {
  const points: PointFit[] = pointFleets.map(pf => ({
    label: pf.label,
    thisUnitUsage: pf.thisUnitUsage,
    fit: fitReliabilityModel(pf.fleet, specMonths, horizonMonths),
  }))

  // 가장 빨리 85% 닿는 포인트 = 가장 작은 optimalMonths
  let drivingLabel: string | null = null
  let recommendedMonths: number | null = null
  for (const p of points) {
    const m = p.fit.optimalMonths
    if (m != null && (recommendedMonths == null || m < recommendedMonths)) {
      recommendedMonths = m
      drivingLabel = p.label
    }
  }

  const groupSize = pointFleets[0]?.fleet.unitCount ?? 0

  return {
    available: points.some(p => p.fit.available),
    points,
    subgroupLabel,
    groupSize,
    drivingLabel,
    recommendedMonths,
  }
}

// ─────────────────────────────────────────────────────────────────
// 3) RP-1 방법 사다리 — 5계층 (데이터량↑ = 정확도↑)
//
//   대부분 기관은 1~2계층(고정주기/제조사권장)에 정체. 데이터가 쌓일수록
//   위로 올라가고, 정점이 MLE. CaliBoard는 모집단으로 정점에 도달한다.
// ─────────────────────────────────────────────────────────────────

export type Rp1MethodTier = 'general' | 'borrowed' | 'engineering' | 'reactive' | 'trend' | 'mle'

export interface Rp1LadderStep {
  tier: Rp1MethodTier
  rank: number              // 1(최하) ~ 5(정점)
  name: string              // 영문 (발표/차트)
  nameKo: string
  dataRequirement: string   // 데이터 요구
  accuracy: 'lowest' | 'low' | 'medium' | 'high' | 'highest'
  isMle: boolean
}

export const RP1_LADDER: Rp1LadderStep[] = [
  { tier: 'general',     rank: 1, name: 'General Interval',    nameKo: '일반 주기',        dataRequirement: 'none',          accuracy: 'lowest',  isMle: false },
  { tier: 'borrowed',    rank: 2, name: 'Borrowed Intervals',  nameKo: '차용 주기',        dataRequirement: 'external',      accuracy: 'low',     isMle: false },
  { tier: 'engineering', rank: 3, name: 'Engineering Analysis',nameKo: '공학적 분석',      dataRequirement: 'design',        accuracy: 'medium',  isMle: false },
  // Tier 4 = RP-1 정석 Reactive (Method A1/A3): 합격↑/불합격↓로 주기 조정. 예측 안 함 → 약점.
  { tier: 'reactive',    rank: 4, name: 'Reactive',            nameKo: '반응형 조정',      dataRequirement: 'pass/fail',     accuracy: 'medium',  isMle: false },
  // Tier 5 = 우리 추세 예측 (단순 선형회귀로 drift 외삽). 정석 Reactive의 "예측 부재" 약점을 보완.
  { tier: 'trend',       rank: 5, name: 'Trend Forecast',      nameKo: '추세 예측',        dataRequirement: 'this unit\'s history', accuracy: 'high', isMle: false },
  { tier: 'mle',         rank: 6, name: 'MLE (S2)',            nameKo: '최대우도추정',     dataRequirement: '20–40+ per model/class', accuracy: 'highest', isMle: true },
]

export interface LadderPosition {
  achievedTier: Rp1MethodTier        // 이 장비/모집단으로 현재 도달 가능한 최고 계층
  achievedRank: number
  reason: string
  // 각 계층이 산출할 법한 주기(개월) — 비교용
  estimates: Partial<Record<Rp1MethodTier, number>>
}

/**
 * 이 장비/모집단이 RP-1 사다리에서 어느 계층까지 올라갔는지 판정.
 *
 * @param fleet        모집단 (MLE 도달 가능 여부)
 * @param fit          MLE 피팅 결과
 * @param baseMonths   spec/제조사 권장 주기 (general/borrowed 추정)
 */
export function assessLadderPosition(
  fleet: FleetData,
  fit: ReliabilityFit,
  baseMonths: number,
): LadderPosition {
  const estimates: Partial<Record<Rp1MethodTier, number>> = {
    general: baseMonths,                   // 관행 고정주기 (= spec/KOLAS 권장)
    borrowed: baseMonths,                  // 제조사/타기관 권장
  }

  // MLE 도달 조건: 모집단 관측 20건 이상 + 피팅 성공
  const mleReady = fit.available && fleet.observationCount >= 20
  if (mleReady && fit.optimalMonths != null) {
    estimates.mle = fit.optimalMonths
    return {
      achievedTier: 'mle',
      achievedRank: 6,
      reason: `Fleet of ${fleet.unitCount} units · ${fleet.observationCount} calibration observations → MLE reliability model fitted`,
      estimates,
    }
  }

  // 모집단은 있으나 부족 → trend(추세 예측) 수준
  if (fleet.observationCount >= 6) {
    return {
      achievedTier: 'trend',
      achievedRank: 5,
      reason: `Limited observations (${fleet.observationCount}) — trend forecast only; MLE needs 20+`,
      estimates,
    }
  }

  // 데이터 없음 → borrowed (제조사 권장)
  return {
    achievedTier: 'borrowed',
    achievedRank: 2,
    reason: 'No fleet data — manufacturer-recommended interval (borrowed)',
    estimates,
  }
}

// ─────────────────────────────────────────────────────────────────
// 3-b) 단계적 내러티브 — "RP-1 사다리를 한 칸씩 올라가며 주기가 어떻게 바뀌나"
//
//   같은 장비를 각 티어 방법으로 분석하면 권장주기가 다르게 나온다.
//   아래로 갈수록(데이터↑) 근거가 단단해지고, 마지막에 "왜 이 주기가 합리적인가"가
//   통계로 증명된다. 발표 서사의 척추.
//
//   각 티어 카드: 방법 설명 + 쓰는 데이터 + 이 장비 주기 + 근거 + 적용 가능 여부.
// ─────────────────────────────────────────────────────────────────

export interface TierRung {
  tier: Rp1MethodTier
  rank: number              // 내부 정렬/도달판정용 (1~6 연속)
  displayRank: string       // 화면 표시 번호 ("4", "4+α", "5" — MLE는 5 유지, Trend는 4+α)
  name: string
  nameKo: string
  // 이 방법으로 이 장비를 분석하면?
  intervalMonths: number | null     // 산출 주기 (null=적용 불가/데이터 부족)
  applicable: boolean               // 이 장비/데이터로 적용 가능한가
  basis: string                     // 한 줄 근거 (영문, 발표)
  dataUsed: string                  // 어떤 데이터를 쓰나
  // 이 티어가 끼워넣는 "우리 자산" (있으면 UI가 특별 렌더)
  embed: 'staircase' | 'drift-chart' | 'reliability-curve' | null
  // Reactive(tier-4) 정석 = 합격↑/불합격↓ 계단 데이터 (embed='staircase'일 때만)
  staircase?: StaircaseStep[]
}

// ── RP-1 정석 Reactive (Method A1) 계단 데이터 ──
//   합격(in-tolerance)이면 주기 × (1+a), 불합격이면 × (1−b).  RP-1 §B.2.
//   a는 합격 증가율(예시 0.1), b는 목표 신뢰성 Rt로 결정되는 감소율:
//     b = 1 − (1−a)^(Rt/(1−Rt))      ← RP-1 §B.2 일반식 [MK09]
//   우리 목표 Rt=0.85 → a=0.10, b≈0.45 (즉 합격 +10% / 불합격 −45%).
//   "한 번의 결과에 반응 → 들쭉날쭉, 결론 없음" 약점을 한눈에 보여주는 계단 그림용.
export interface StaircaseStep {
  index: number          // 교정 회차 (1, 2, 3, …)
  interval: number       // 그 회차에 배정된 주기 (개월)
  pass: boolean          // 그 교정 결과 (합격=true)
}

// RP-1 §B.2 파라미터 — 발표/화면에서 출처와 함께 노출
export const REACTIVE_A = 0.10                                   // 합격 증가율 a (RP-1 §B.2 예시)
export const REACTIVE_B = 1 - Math.pow(1 - REACTIVE_A, RELIABILITY_TARGET / (1 - RELIABILITY_TARGET))  // ≈0.45 @85%

/**
 * RP-1 정석 Reactive(A1) 계단 시뮬레이션 — 발표용 직관 그림.
 *   spec 주기에서 시작해, 합격하면 ×(1+a), 불합격하면 ×(1−b)로 주기를 조정.
 *   합격/불합격 패턴은 시드로 결정적 생성 (발표 중 안정).
 */
export function buildReactiveStaircase(
  meta: { manufacturer?: string; model?: string },
  startMonths: number,
  steps = 8,
): StaircaseStep[] {
  const a = REACTIVE_A, b = REACTIVE_B
  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|reactive-stair`)
  const rng = makeRng(seed)
  const out: StaircaseStep[] = []
  let interval = startMonths
  for (let i = 1; i <= steps; i++) {
    // 합격 확률 ~78% (대체로 합격해서 야금야금 오르다 가끔 뚝 떨어지는 패턴)
    const pass = rng() < 0.78
    out.push({ index: i, interval: round1(interval), pass })
    interval = pass ? interval * (1 + a) : interval * (1 - b)
    interval = clamp(interval, 1, 36)
  }
  return out
}

export interface TierLadderNarrative {
  rungs: TierRung[]
  achievedRank: number              // 이 장비가 도달한 최고 티어
  // 결론: 정점(MLE) 주기 vs 출발점(spec) 비교
  specMonths: number
  mleMonths: number | null
  verdict: 'extend' | 'confirm' | 'shorten' | null  // MLE가 spec 대비
}

/**
 * 5티어 내러티브 생성.
 *   - General/Borrowed: spec/제조사 주기 (근거 약함)
 *   - Engineering: 설계 기반 (간략 — 여기선 borrowed와 동급 취급, 표시만)
 *   - Reactive: 이 장비 드리프트 외삽 (buildErrorForecast의 가장 빠른 crossing)
 *   - MLE: 모집단 신뢰성 곡선 85% 시점
 */
export function buildTierLadder(
  series: TrendSeries[],
  fleet: FleetData,
  pointResult: PointReliabilityResult,
  ladder: LadderPosition,
  specMonths: number,
  meta: { manufacturer?: string; model?: string },
): TierLadderNarrative {
  // Trend(추세 예측) 주기 = 모든 측정점 중 가장 빨리 한계(가드밴드) 닿는 crossing.
  //   (단순 선형회귀로 이 장비 drift를 외삽 — 정석 Reactive의 "예측 부재"를 보완)
  let trendMonths: number | null = null
  for (const s of series) {
    const f = buildErrorForecast(s, Math.max(specMonths + 12, 24), specMonths)
    const m = f.crossing.bestMonths
    if (m != null && m > 0 && (trendMonths == null || m < trendMonths)) {
      trendMonths = m
    }
  }

  // RP-1 정석 Reactive(A1) 계단 — 합격↑/불합격↓ (예측 없음). 발표용 직관 그림.
  const staircase = buildReactiveStaircase(meta, specMonths)

  // MLE 주기 = 포인트별 신뢰성 중 가장 빨리 85% 닿는 포인트가 결정 (RP-1 worst-point)
  const mleMonths = pointResult.available ? pointResult.recommendedMonths : null
  const driver = pointResult.drivingLabel

  const rungs: TierRung[] = [
    {
      tier: 'general', rank: 1, displayRank: '1', name: 'General Interval', nameKo: '일반 주기',
      intervalMonths: specMonths, applicable: true,
      basis: 'One interval for all instruments — the default before any data.',
      dataUsed: 'none', embed: null,
    },
    {
      tier: 'borrowed', rank: 2, displayRank: '2', name: 'Borrowed Interval', nameKo: '차용 주기',
      intervalMonths: specMonths, applicable: true,
      basis: 'Manufacturer / other-lab recommendation. Safe, but not evidence-based.',
      dataUsed: 'external recommendation', embed: null,
    },
    {
      tier: 'engineering', rank: 3, displayRank: '3', name: 'Engineering Analysis', nameKo: '공학적 분석',
      intervalMonths: specMonths, applicable: true,
      basis: 'Design knowledge / circuit analysis. Refines the borrowed value.',
      dataUsed: 'design specs', embed: null,
    },
    {
      // RP-1 정석 Reactive (Method A1) — 합격이면 주기↑, 불합격이면 주기↓. 예측 없음.
      //   고정된 권장값이 없으므로 intervalMonths=null ("—"). 약점을 보여주는 징검다리.
      tier: 'reactive', rank: 4, displayRank: '4', name: 'Reactive', nameKo: '반응형 조정',
      intervalMonths: null, applicable: true,
      basis: 'The textbook RP-1 method: just react to each result — pass, lengthen the interval; fail, shorten it. Simple, but it never looks ahead, so it drifts and reacts to one-off results. RP-1 itself marks it "not recommended."',
      dataUsed: 'pass / fail of each calibration', embed: 'staircase', staircase,
    },
    {
      // 우리 추세 예측 — 단순 선형회귀로 이 장비 drift를 외삽해 미래 한계 초과 시점 예측.
      tier: 'trend', rank: 5, displayRank: '4+α', name: 'Trend Forecast', nameKo: '추세 예측',
      intervalMonths: trendMonths, applicable: trendMonths != null,
      basis: trendMonths != null
        ? `Instead of just reacting, we look ahead: a simple straight-line fit on this unit's error reaches the safe limit at about ${trendMonths} months.`
        : 'Needs this unit\'s calibration history with a clear drift trend.',
      dataUsed: 'this unit\'s calibration history', embed: 'drift-chart',
    },
    {
      tier: 'mle', rank: 6, displayRank: '5', name: 'MLE (S2)', nameKo: '최대우도추정',
      intervalMonths: mleMonths, applicable: mleMonths != null,
      basis: mleMonths != null
        ? `Per-point reliability curves on the fleet. The ${driver ?? 'worst'} point hits ${(RELIABILITY_TARGET * 100).toFixed(0)}% first — at ${mleMonths} mo — so it drives the interval.`
        : 'Needs a model/class population (20–40+ records) to fit a reliability curve.',
      dataUsed: `fleet population, per measurement point`, embed: 'reliability-curve',
    },
  ]

  // verdict: MLE가 spec 대비 늘릴 수 있나/확인인가/줄여야 하나
  let verdict: TierLadderNarrative['verdict'] = null
  if (mleMonths != null) {
    verdict = mleMonths > specMonths + 0.5 ? 'extend'
      : mleMonths < specMonths - 0.5 ? 'shorten'
      : 'confirm'
  }

  return { rungs, achievedRank: ladder.achievedRank, specMonths, mleMonths, verdict }
}

// ─────────────────────────────────────────────────────────────────
// 4) 중간점검(키오스크) 효과 시뮬레이션 — Future Work
//
//   ISO/IEC 17025 §6.4.10(중간점검 명문) + RP-1 §3(SPC 보충) + RP-18(FAR 저감).
//
//   "정식 교정만으론 모집단 관측이 부족 → 신뢰성 곡선이 헐겁다.
//    키오스크 중간점검이 정식 교정 사이를 메워 ① MLE 곡선의 정밀도↑(신뢰구간↓)
//    ② 교정 사이 공백의 적합성을 상시 모니터링(FAR 저감)."
//
//   시뮬레이션: 관측 수를 늘린(중간점검 추가) 모집단으로 재피팅 → 곡선의
//   불확실성(부트스트랩 표준오차)이 줄어듦을 Before/After로 보여준다.
// ─────────────────────────────────────────────────────────────────

export interface ReliabilityInterimComparison {
  available: boolean
  before: {
    optimalMonths: number | null
    observationCount: number
    lambdaStdErr: number          // λ 추정 표준오차 (곡선 불확실성)
  }
  after: {
    optimalMonths: number | null
    observationCount: number
    lambdaStdErr: number
  }
  // 핵심 메시지 지표
  observationGain: number          // 추가된 관측 수 (중간점검)
  precisionGainPct: number         // 표준오차 감소율 (%) — "곡선이 N% 더 또렷해짐"
  standards: string[]              // 근거 표준 (발표 배지)
}

/**
 * λ 추정 표준오차 — Fisher information 근사.
 *   binomial 지수모델의 로그우도 2차도함수 기반. 관측 많을수록 작아짐.
 *   여기선 발표용 직관 지표라 "관측수에 반비례" 근사로 충분히 안정적으로 계산.
 */
function lambdaStdError(lambda: number, obs: FleetObservation[]): number {
  // I(λ) = Σ tᵢ² · R(1−R) / [R(1−R)]  근사 → 관측수·시간² 가중
  let info = 0
  for (const o of obs) {
    const R = clamp(Math.exp(-lambda * o.months), 1e-6, 1 - 1e-6)
    info += (o.months * o.months) * (R / (1 - R))
  }
  return info > 0 ? 1 / Math.sqrt(info) : Infinity
}

/**
 * 중간점검(키오스크) 도입 효과 시뮬레이션.
 *
 * @param fleet        정식 교정만의 모집단
 * @param specMonths   spec 주기
 * @param meta         시드용
 */
export function simulateInterimReliability(
  fleet: FleetData,
  specMonths: number,
  meta: { manufacturer?: string; model?: string },
): ReliabilityInterimComparison {
  if (!fleet.available || fleet.observationCount < 8) {
    return {
      available: false,
      before: { optimalMonths: null, observationCount: fleet.observationCount, lambdaStdErr: Infinity },
      after: { optimalMonths: null, observationCount: fleet.observationCount, lambdaStdErr: Infinity },
      observationGain: 0,
      precisionGainPct: 0,
      standards: [],
    }
  }

  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|interim-rel`)
  const rng = makeRng(seed)

  // Before — 정식 교정만
  const beforeFit = fitReliabilityModel(fleet, specMonths)
  const beforeSe = lambdaStdError(beforeFit.lambdaPerMonth, fleet.observations)

  // After — 키오스크 중간점검 관측 추가.
  //   같은 모집단에 "정식 교정 사이의 경과시간(3·6·9개월)" 관측을 대량 추가.
  //   진짜 곡선(trueLambda)을 따르되, 중간 시간대를 촘촘히 채운다.
  const lambdaForSim = beforeFit.lambdaPerMonth
  const interimObs: FleetObservation[] = [...fleet.observations]
  const interimChecksPerUnitTime = Math.round(fleet.unitCount * 0.6)
  // 3~10개월 사이를 촘촘히 (정식 교정이 비워둔 구간)
  for (let k = 0; k < interimChecksPerUnitTime; k++) {
    const months = clamp(gaussian(rng, 6.5, 2.5), 1.5, 11)
    const R = Math.exp(-lambdaForSim * months)
    interimObs.push({ months: round1(months), inTolerance: rng() < R })
  }

  const afterFleet: FleetData = { ...fleet, observations: interimObs, observationCount: interimObs.length }
  const afterFit = fitReliabilityModel(afterFleet, specMonths)
  const afterSe = lambdaStdError(afterFit.lambdaPerMonth, interimObs)

  const precisionGainPct = beforeSe > 0 && Number.isFinite(beforeSe)
    ? Math.round((1 - afterSe / beforeSe) * 100)
    : 0

  return {
    available: true,
    before: { optimalMonths: beforeFit.optimalMonths, observationCount: fleet.observationCount, lambdaStdErr: beforeSe },
    after: { optimalMonths: afterFit.optimalMonths, observationCount: interimObs.length, lambdaStdErr: afterSe },
    observationGain: interimObs.length - fleet.observationCount,
    precisionGainPct: Math.max(0, precisionGainPct),
    standards: ['ISO/IEC 17025 §6.4.10', 'NCSLI RP-1 (SPC)', 'NCSLI RP-18 (FAR reduction)'],
  }
}

// ─────────────────────────────────────────────────────────────────
// 5) 오케스트레이터 — 한 번에 전체 신뢰성 분석
// ─────────────────────────────────────────────────────────────────

export interface ReliabilityAnalysis {
  available: boolean
  fleet: FleetData
  fit: ReliabilityFit                  // 통합 곡선 (호환·보조용)
  pointReliability: PointReliabilityResult  // ★ 포인트별 동질그룹 MLE (RP-1 정석, 새 탭 메인)
  subgroup: SubgroupInfo            // 이 장비가 속한 사용조건 동질그룹
  ladder: LadderPosition
  tierLadder: TierLadderNarrative   // ★ 5티어 단계적 내러티브 (새 탭 척추)
  specMonths: number
}

export interface ReliabilityAnalysisInput {
  series: TrendSeries[]
  specMonths: number       // base/제조사 권장 주기
  manufacturer?: string
  model?: string
  category?: string | null
}

export function runReliabilityAnalysis(input: ReliabilityAnalysisInput): ReliabilityAnalysis {
  const meta = { manufacturer: input.manufacturer, model: input.model, category: input.category }
  const fleet = buildFleetData(input.series, meta)
  const fit = fitReliabilityModel(fleet, input.specMonths)
  // ★ 동질 하위그룹 판정 (RP-1 §2.7.1) — 이 장비의 사용조건 그룹
  const subgroup = inferSubgroup(input.series)
  // ★ 포인트별 동질그룹 MLE (RP-1 정석) — 각 측정포인트 모집단 따로 피팅 → min이 주기 결정
  const pointFleets = buildPointFleets(input.series, meta, subgroup.label)
  const pointReliability = fitPointReliability(pointFleets, input.specMonths, subgroup.label)
  const ladder = assessLadderPosition(fleet, fit, input.specMonths)
  const tierLadder = buildTierLadder(input.series, fleet, pointReliability, ladder, input.specMonths, meta)

  return {
    available: fit.available,
    fleet,
    fit,
    pointReliability,
    subgroup,
    ladder,
    tierLadder,
    specMonths: input.specMonths,
  }
}

// ─────────────────────────────────────────────────────────────────
// 보조
// ─────────────────────────────────────────────────────────────────

function inferGroupName(meta: { manufacturer?: string; model?: string; category?: string | null }): string {
  if (meta.category) {
    return meta.manufacturer ? `${meta.category} (${meta.manufacturer})` : meta.category
  }
  if (meta.manufacturer) return `Torque Wrench (${meta.manufacturer})`
  return 'Instrument Class'
}
