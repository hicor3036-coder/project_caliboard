// 교정주기 분석 — 더미데이터 생성기 (Phase G+ / ICMPM2026 발표용)
//
// 목적:
//   1. Peer Benchmark (유사장비 빅데이터) — "이미 수집/분석하고 있다"는 전제로 발표.
//      실제로는 아직 수집 안 했을 뿐, 수집 가능한 데이터. 발표 시 실데이터처럼 제시.
//   2. Interim Check (키오스크 중간점검) — Future Work. "데이터가 들어오면 이렇게 된다"
//      는 시뮬레이션용. 정식 교정점 사이를 메우는 저정밀·고빈도 시계열.
//
// 설계 원칙:
//   - cycle-analysis.ts의 검증된 로직(step1·2·3·5)은 절대 안 건드림.
//   - 더미는 전부 이 파일에 격리. 실데이터 전환 시 이 파일만 교체하면 됨.
//   - 생성 함수는 결정적(deterministic) — 같은 입력이면 같은 출력 (시드 기반).
//     발표 중 새로고침해도 그래프가 안 흔들리게.
//   - 기준 장비: 토크렌치 / 토크센서 (NORBAR 토크 트랜스듀서군 가정).

import type { TrendSeries, TrendPoint } from './equipment-health'
import type { GuardBandVerdict } from '@/components/equipment-detail/shared-utils'

// ─────────────────────────────────────────────────────────────────
// 결정적 의사난수 (시드 기반) — Math.random 안 씀 (발표 중 안정성)
// ─────────────────────────────────────────────────────────────────

/** mulberry32 — 가벼운 시드 PRNG. 같은 시드면 같은 수열. */
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

/** 문자열 → 안정 시드 (장비 라벨로 시드 고정 → 장비마다 다르되 일관된 더미) */
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 정규분포 근사 (Box-Muller) */
function gaussian(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * sd
}

// ─────────────────────────────────────────────────────────────────
// 1) Peer Benchmark — 유사장비 빅데이터 집계
// ─────────────────────────────────────────────────────────────────

/**
 * 한 측정 포인트에 대한 동종 장비군 집계 통계.
 * "같은 모델 N대를 모아보니 이 포인트는 보통 이렇더라"
 */
export interface PeerPointStat {
  label: string                 // 측정 포인트 (이 장비의 series.label과 매칭)
  peerCount: number             // 이 포인트 데이터를 가진 동종 장비 수
  // 한계 사용률(|오차|/허용오차 %) 분포 — 동종 장비군의 "최신 교정" 기준
  peerMeanUsage: number         // 장비군 평균 한계 사용률 (%)
  peerStdUsage: number          // 표준편차
  peerP50Usage: number          // 중앙값
  peerP90Usage: number          // 상위 10% (빨리 닳는 장비)
  // 연간 드리프트 속도 (%p/년) — 장비군 평균
  peerMeanDriftRate: number     // 평균 연간 한계사용률 증가폭
  // 이 장비의 위치
  thisUsage: number | null      // 이 장비의 최신 한계 사용률
  thisPercentile: number | null // 이 장비가 장비군에서 차지하는 백분위 (0~100, 높을수록 위험)
  // 장비군 평균 한계도달 시점 (개월)
  peerMeanMonthsToLimit: number | null
}

export interface PeerBenchmarkData {
  available: boolean            // 동종 장비군 데이터 매칭 성공 여부
  groupKey: string              // 장비군 식별 (예: "Torque Transducer (NORBAR)")
  totalPeerCount: number        // 매칭된 동종 장비 총 대수
  totalCertCount: number        // 동종 장비군 누적 교정 성적서 건수
  points: PeerPointStat[]
  summary: {
    // 이 장비가 장비군 대비 빠른 마모인지 (백분위 평균)
    avgPercentile: number | null      // 이 장비 포인트들의 평균 백분위
    fasterThanPeers: boolean          // 평균 백분위 > 70 → 장비군보다 빨리 닳음
    slowerThanPeers: boolean          // 평균 백분위 < 30 → 장비군보다 안정적
    peerMeanCycleMonths: number       // 장비군 실사용 평균 교정주기
    riskPointCount: number            // 이 장비가 장비군 상위 20%에 드는 포인트 수
  }
}

/**
 * 유사장비 빅데이터 생성.
 *
 * 핵심 로직:
 *   - 이 장비의 실제 series(있으면)에서 측정 포인트와 최신 사용률을 읽는다.
 *   - 각 포인트마다 "동종 장비군 분포"를 시드 기반으로 합성한다.
 *   - 이 장비의 사용률을 그 분포에 대입해 백분위를 계산한다.
 *   → 즉, 이 장비가 실제로 위험하면 백분위도 높게 나오도록 데이터를 정합시킨다.
 *
 * @param series 이 장비의 실제 측정 시계열 (없으면 토크 기본 포인트로 합성)
 * @param meta   장비 식별 (시드 + 그룹명 표기용)
 *   - demoSlightlyFast: 발표용. 이 장비가 fleet 대비 "약간 빠른 마모(상위권)"로
 *     일관되게 보이도록 fleet 평균을 이 장비 사용률보다 살짝 낮게 잡는다.
 */
export function buildPeerBenchmark(
  series: TrendSeries[],
  meta: { manufacturer?: string; model?: string; category?: string | null; demoSlightlyFast?: boolean },
): PeerBenchmarkData {
  const groupName = inferTorqueGroupName(meta)
  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|peer`)
  const rng = makeRng(seed)

  // 동종 장비 대수 — 시드 기반 안정값 (180~420대 사이)
  const totalPeerCount = 180 + Math.floor(rng() * 240)
  // 누적 성적서 (대당 평균 4~7건)
  const totalCertCount = Math.floor(totalPeerCount * (4 + rng() * 3))

  // 분석 대상 포인트 결정: 실제 series가 있으면 그것, 없으면 토크 기본 포인트
  const sourcePoints = series.length > 0
    ? series.map(s => ({ label: s.label, thisUsage: latestUsage(s) }))
    : defaultTorquePoints().map(label => ({ label, thisUsage: null as number | null }))

  const points: PeerPointStat[] = sourcePoints.map((sp, idx) => {
    // 포인트마다 다른 분포 (인덱스로 시드 변주)
    const pRng = makeRng(seed + idx * 7919)

    // 장비군 표준편차 (공통)
    const peerStdUsage = clamp(gaussian(pRng, 16, 4), 6, 28)

    // 장비군 평균 사용률 결정
    let peerMeanUsage: number
    if (meta.demoSlightlyFast && sp.thisUsage != null) {
      // 발표용: fleet 평균을 이 장비 사용률보다 약 1.05σ 낮게 → 일관되게 상위권(~73%ile, "faster").
      // 단, 안정 포인트(사용률 낮음)에서 평균이 비현실적으로 낮아지지 않게 하한 적용.
      peerMeanUsage = clamp(sp.thisUsage - 1.05 * peerStdUsage, 10, 85)
    } else {
      // 일반: 장비군 평균 사용률 30~55%
      peerMeanUsage = clamp(gaussian(pRng, 42, 12), 8, 88)
    }

    // 정규분포 기반 분위수
    const peerP50Usage = clamp(peerMeanUsage + gaussian(pRng, 0, 2), 5, 92)
    const peerP90Usage = clamp(peerMeanUsage + 1.28 * peerStdUsage, peerP50Usage, 99)
    // 연간 드리프트 속도: 2~9 %p/년
    const peerMeanDriftRate = clamp(gaussian(pRng, 5, 2), 1.5, 11)

    // 이 장비의 사용률 — 실제 값 있으면 사용, 없으면 장비군 분포에서 샘플
    const thisUsage = sp.thisUsage != null
      ? sp.thisUsage
      : clamp(gaussian(pRng, peerMeanUsage, peerStdUsage), 3, 99)

    // 백분위: 이 장비 사용률이 정규분포(mean,std)에서 차지하는 위치
    const thisPercentile = normalCdf(thisUsage, peerMeanUsage, peerStdUsage) * 100

    // 장비군 평균 한계도달 시점 (개월): (100 - 평균사용률) / 월간드리프트
    const monthlyDrift = peerMeanDriftRate / 12
    const peerMeanMonthsToLimit = monthlyDrift > 0.05
      ? Math.round(((100 - peerMeanUsage) / monthlyDrift))
      : null

    return {
      label: sp.label,
      peerCount: Math.floor(totalPeerCount * (0.6 + pRng() * 0.4)),
      peerMeanUsage: round1(peerMeanUsage),
      peerStdUsage: round1(peerStdUsage),
      peerP50Usage: round1(peerP50Usage),
      peerP90Usage: round1(peerP90Usage),
      peerMeanDriftRate: round1(peerMeanDriftRate),
      thisUsage: thisUsage != null ? round1(thisUsage) : null,
      thisPercentile: round1(thisPercentile),
      peerMeanMonthsToLimit,
    }
  })

  // 요약 통계
  const percentiles = points.map(p => p.thisPercentile).filter((v): v is number => v != null)
  const avgPercentile = percentiles.length > 0
    ? round1(percentiles.reduce((s, v) => s + v, 0) / percentiles.length)
    : null
  const riskPointCount = points.filter(p => p.thisPercentile != null && p.thisPercentile >= 80).length
  // 장비군 실사용 평균 교정주기 (대부분 12개월 전후, 시드 변주)
  const peerMeanCycleMonths = Math.round(clamp(gaussian(rng, 12.5, 1.5), 9, 18))

  return {
    available: true,
    groupKey: groupName,
    totalPeerCount,
    totalCertCount,
    points,
    summary: {
      avgPercentile,
      fasterThanPeers: avgPercentile != null && avgPercentile >= 70,
      slowerThanPeers: avgPercentile != null && avgPercentile < 30,
      peerMeanCycleMonths,
      riskPointCount,
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Peer error bands — 측정점별 "fleet 오차 범위 vs 이 장비 오차" (차트용)
//
// 사용자 관심사: "같은 모델 다른 장비들은 각 측정점에서 보통 어떤 오차를 내는데,
//                내 장비는 어떻게 다른가" — 측정점별 오차 특성 비교.
//
// 방법:
//   1. 이 장비의 각 측정점(토크값, 최신 오차, 허용오차)을 읽는다.
//   2. 각 점에서 동종 장비군의 오차 분포를 합성한다.
//   3. IQR(Tukey 1.5×IQR) 기준으로 이상치를 제거한 뒤 min/max를 잡는다.
//      → "정상 장비들이 실제로 보이는 오차 범위" (고장난 개체 제외)
//   4. X축 = 토크, Y축 = 오차%. fleet 범위(띠) + 이 장비 점.
// ─────────────────────────────────────────────────────────────────

export interface PeerErrorBandPoint {
  torque: number               // 측정점 토크값 (X축)
  label: string                // 원본 라벨 (예: "62.2 N·m")
  tolerance: number            // 허용오차 ± (%) — 한계선
  // fleet 분포 (이상치 IQR 제거 후)
  fleetMin: number             // 정상 장비군 최소 오차 (%)
  fleetMax: number             // 정상 장비군 최대 오차 (%)
  fleetMedian: number          // 중앙값 (%)
  peerSampleCount: number      // 이 점에 기여한 정상 장비 수 (이상치 제거 후)
  outlierCount: number         // 제거된 이상치 수
  scatter: number[]            // 산점도용 정상 표본 오차값 일부 (차트에 점으로 뿌림)
  // 이 장비
  thisError: number | null     // 이 장비의 최신 오차 (%)
  outOfRange: 'above' | 'below' | 'within' | null  // fleet 범위 대비 위치
}

export interface PeerErrorBandData {
  available: boolean
  unit: string                 // 토크 단위 (예: "N·m")
  groupKey: string
  totalPeerCount: number       // 동종 장비 총 대수
  totalCertCount: number       // 누적 교정 성적서 건수
  totalMeasurements: number    // 누적 개별 측정 수 (IQR 정제 후 fleet 표본 합)
  yearSpan: number             // 데이터가 걸쳐 있는 햇수
  points: PeerErrorBandPoint[]
}

/** IQR(Tukey 1.5×IQR)로 이상치 제거 후 {min, max, median, kept, removed, inliers} 반환 */
function iqrTrim(values: number[]): {
  min: number; max: number; median: number; kept: number; removed: number; inliers: number[]
} {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const q = (p: number): number => {
    const idx = p * (n - 1)
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  const q1 = q(0.25), q3 = q(0.75)
  const iqr = q3 - q1
  const lower = q1 - 1.5 * iqr
  const upper = q3 + 1.5 * iqr
  const inliers = sorted.filter(v => v >= lower && v <= upper)
  const kept = inliers.length > 0 ? inliers : sorted
  return {
    min: kept[0],
    max: kept[kept.length - 1],
    median: q(0.5),
    kept: kept.length,
    removed: n - kept.length,
    inliers: kept,
  }
}

/** 라벨에서 토크 숫자 파싱 */
function parseTorque(label: string): number | null {
  const m = label.match(/([\d.]+)/)
  return m ? parseFloat(m[1]) : null
}

/**
 * 측정점별 fleet 오차 범위 + 이 장비 오차 생성.
 * @param series 이 장비 시계열 (각 series.label = 측정점, 최신 오차 사용)
 * @param meta   시드 + 그룹명
 */
export function buildPeerErrorBands(
  series: TrendSeries[],
  meta: { manufacturer?: string; model?: string; category?: string | null },
): PeerErrorBandData {
  const groupName = inferTorqueGroupName(meta)
  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|bands`)
  // peer 대수는 buildPeerBenchmark와 같은 시드(|peer)로 산출 → 한 카드 안 숫자 일치.
  const peerSeed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|peer`)
  const peerRng = makeRng(peerSeed)
  const totalPeerCount = 180 + Math.floor(peerRng() * 240)
  const totalCertCount = Math.floor(totalPeerCount * (4 + peerRng() * 3))
  const unit = (() => {
    const m = series[0]?.label.match(/[\d.]+\s*(.+)$/)
    return m ? m[1].trim() : 'N·m'
  })()

  const points: PeerErrorBandPoint[] = series.map((s, idx) => {
    const torque = parseTorque(s.label) ?? (idx + 1) * 50
    // 이 장비 최신 오차/허용오차
    let thisError: number | null = null
    let tol = 4
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].오차 != null) { thisError = s.points[i].오차; break }
    }
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].허용오차 != null) { tol = Math.abs(s.points[i].허용오차 as number); break }
    }

    // fleet 오차 분포 합성: 저토크일수록 산포 큼(토크렌치 특성), 중심은 0 근처
    const pRng = makeRng(seed + idx * 4513)
    const fsRatio = torque / (parseTorque(series[series.length - 1].label) ?? torque)  // 0~1 (풀스케일 비)
    // 저토크(fsRatio 작음)에서 표준편차 큼: 0.6~1.6%
    //   (정상 장비군 산포 — 이 장비가 저토크에서 fleet 범위를 벗어나도록 의도적으로 좁힘)
    const sd = 1.6 - 1.0 * fsRatio
    const center = gaussian(pRng, 0, 0.25)  // fleet 중심은 0 근처(약간 치우침)

    // 50개 샘플 + 의도적 이상치 2~3개 섞기 (IQR이 걸러냄을 보여줌)
    const sample: number[] = []
    const m = Math.min(60, Math.max(30, Math.floor(totalPeerCount * 0.2)))
    for (let k = 0; k < m; k++) sample.push(clamp(gaussian(pRng, center, sd), -tol * 1.1, tol * 1.1))
    // 이상치 주입 (고장 장비 모사)
    const outN = 2 + Math.floor(pRng() * 2)
    for (let k = 0; k < outN; k++) sample.push((pRng() > 0.5 ? 1 : -1) * (tol * (1.3 + pRng() * 0.8)))

    const { min, max, median, kept, removed, inliers } = iqrTrim(sample)

    const outOfRange: PeerErrorBandPoint['outOfRange'] =
      thisError == null ? null :
      thisError > max ? 'above' :
      thisError < min ? 'below' :
      'within'

    // 산점도용: 정상 표본에서 균등 간격으로 ~14개 추출 (차트에 점으로 뿌림)
    const SCATTER_N = 14
    const step = Math.max(1, Math.floor(inliers.length / SCATTER_N))
    const scatter: number[] = []
    for (let k = 0; k < inliers.length && scatter.length < SCATTER_N; k += step) {
      scatter.push(round1(inliers[k]))
    }

    return {
      torque,
      label: s.label,
      tolerance: tol,
      fleetMin: round1(min),
      fleetMax: round1(max),
      fleetMedian: round1(median),
      peerSampleCount: kept,
      outlierCount: removed,
      scatter,
      thisError: thisError != null ? round1(thisError) : null,
      outOfRange,
    }
  })

  // 토크 오름차순 정렬 (X축)
  points.sort((a, b) => a.torque - b.torque)

  // 데이터 햇수: 대당 평균 성적서 ÷ 연 1회 가정 → 3~7년으로 안정화
  const yearSpan = clamp(Math.round(totalCertCount / Math.max(1, totalPeerCount)), 3, 7)
  // 누적 개별 측정 수: 동종 장비 × 측정점 수 × 성적서 건수 규모
  //   (성적서 1건당 모든 측정점을 1회씩 측정 → cert × 측정점 수)
  const totalMeasurements = totalCertCount * Math.max(1, points.length)

  return { available: true, unit, groupKey: groupName, totalPeerCount, totalCertCount, totalMeasurements, yearSpan, points }
}

// ─────────────────────────────────────────────────────────────────
// 2) Interim Check — 키오스크 중간점검 시뮬레이션 (Future Work)
// ─────────────────────────────────────────────────────────────────

/**
 * 키오스크 중간점검 1회 측정.
 * 정식 교정과 달리: 저정밀(불확도 큼), 고빈도(월 단위), 트렌드 추정 목적.
 */
export interface InterimCheckPoint {
  label: string                 // 측정 포인트
  date: string                  // 점검일 (YYYY-MM-DD)
  usageRatio: number            // 추정 한계 사용률 (%) — 저정밀
  isInterim: true               // 정식 교정과 구분 플래그
}

export interface InterimCheckSeries {
  label: string
  unit: string
  checks: InterimCheckPoint[]   // 시간순 중간점검 측정들
}

/**
 * 시뮬레이션 비교 결과 — "중간점검 데이터가 들어오면 이렇게 달라진다"
 */
export interface InterimSimulationResult {
  available: boolean
  interimSeries: InterimCheckSeries[]
  // 키오스크 도입 효과 (Before = 정식 교정만, After = 정식 + 중간점검)
  effects: {
    label: string
    // 한계도달(95%) 예상 시점 — 정식만 vs 중간점검 추가
    monthsToLimitBefore: number | null
    monthsToLimitAfter: number | null
    earlyDetectionMonths: number | null   // 며칠/몇 달 일찍 감지하는가
    // 추세 가시성: 데이터 포인트 수
    pointsBefore: number
    pointsAfter: number
  }[]
  summary: {
    avgEarlyDetectionMonths: number | null  // 평균 조기 감지 개월
    totalInterimChecks: number               // 추가된 총 중간점검 수
    monthsSpan: number                        // 중간점검이 커버하는 기간(개월)
    confidenceGain: 'low→medium' | 'medium→high' | 'low→high' | 'maintained'
  }
}

/**
 * 키오스크 중간점검 시뮬레이션 생성.
 *
 * 시나리오:
 *   - 마지막 정식 교정 이후 ~10개월간, 매월 1회 키오스크 점검이 있었다고 가정.
 *   - 각 포인트의 실제 드리프트 추세를 이어받아, 그 사이를 촘촘히 메우는
 *     저정밀(노이즈 큰) 측정점을 생성한다.
 *   - "정식 교정만으로는 다음 교정 때나 알았을 드리프트를, 중간점검으로 N개월 일찍 본다"
 *
 * @param series  이 장비의 정식 교정 시계열
 * @param baseMonths 현재 교정주기 (개월) — 중간점검 커버 범위 결정
 * @param meta    시드용
 */
export function buildInterimSimulation(
  series: TrendSeries[],
  baseMonths: number,
  meta: { manufacturer?: string; model?: string },
): InterimSimulationResult {
  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|interim`)

  // 정식 교정 데이터가 충분치 않으면 시뮬레이션 의미 약함 — 그래도 합성은 함
  const sourceSeries = series.length > 0 ? series : synthTorqueSeries(meta)

  // 중간점검 커버 기간: 교정주기의 약 80% (다음 교정 직전까지)
  const monthsSpan = Math.max(6, Math.round(baseMonths * 0.8))
  const checksPerSeries = monthsSpan // 매월 1회

  const interimSeries: InterimCheckSeries[] = []
  const effects: InterimSimulationResult['effects'] = []
  let totalInterimChecks = 0

  sourceSeries.forEach((s, idx) => {
    const sRng = makeRng(seed + idx * 6151)
    const cur = latestUsage(s) ?? clamp(gaussian(sRng, 45, 15), 10, 80)
    // 이 포인트의 연간 드리프트 속도 추정 (실제 시계열 기울기 or 합성)
    const driftPerYear = estimateDriftRate(s) ?? clamp(gaussian(sRng, 6, 3), 2, 14)
    const driftPerMonth = driftPerYear / 12

    // 마지막 정식 교정일 추정 (없으면 합성 기준일)
    const lastCalDate = latestCalDate(s) ?? '2025-06-01'

    // 매월 중간점검점 생성: 현재 사용률에서 월간 드리프트 + 저정밀 노이즈
    const checks: InterimCheckPoint[] = []
    for (let m = 1; m <= checksPerSeries; m++) {
      const trueVal = cur + driftPerMonth * m
      // 키오스크는 저정밀 → ±5%p 노이즈 (정식 교정보다 훨씬 큼)
      const noisy = clamp(trueVal + gaussian(sRng, 0, 5), 0, 130)
      checks.push({
        label: s.label,
        date: addMonths(lastCalDate, m),
        usageRatio: round1(noisy),
        isInterim: true,
      })
    }
    totalInterimChecks += checks.length
    interimSeries.push({ label: s.label, unit: s.unit, checks })

    // 효과 계산: 95% 한계 도달 시점
    // Before(정식만): 현재 추세로 외삽 — 듬성한 데이터라 늦게/부정확
    // After(중간점검): 촘촘한 데이터라 같은 추세를 더 일찍 확인
    const monthsToLimitTrue = driftPerMonth > 0.05
      ? Math.round((95 - cur) / driftPerMonth)
      : null
    // Before는 다음 정식 교정(baseMonths) 시점에야 확인 가능
    const monthsToLimitBefore = monthsToLimitTrue != null
      ? Math.max(monthsToLimitTrue, baseMonths)  // 정식 교정 전엔 모름
      : null
    // After는 실제 추세 시점에 확인 (중간점검이 잡아냄)
    const monthsToLimitAfter = monthsToLimitTrue
    const earlyDetectionMonths =
      monthsToLimitBefore != null && monthsToLimitAfter != null
        ? Math.max(0, monthsToLimitBefore - monthsToLimitAfter)
        : null

    effects.push({
      label: s.label,
      monthsToLimitBefore,
      monthsToLimitAfter,
      earlyDetectionMonths,
      pointsBefore: s.points.filter(p => p.비율 != null).length,
      pointsAfter: s.points.filter(p => p.비율 != null).length + checks.length,
    })
  })

  // 요약
  const earlyVals = effects.map(e => e.earlyDetectionMonths).filter((v): v is number => v != null && v > 0)
  const avgEarlyDetectionMonths = earlyVals.length > 0
    ? round1(earlyVals.reduce((s, v) => s + v, 0) / earlyVals.length)
    : null

  // 신뢰도 상승: 정식 교정 횟수에 따라
  const maxFormalPoints = Math.max(0, ...sourceSeries.map(s => s.points.filter(p => p.비율 != null).length))
  const confidenceGain: InterimSimulationResult['summary']['confidenceGain'] =
    maxFormalPoints < 3 ? 'low→high' :
    maxFormalPoints < 5 ? 'medium→high' :
    'maintained'

  return {
    available: true,
    interimSeries,
    effects,
    summary: {
      avgEarlyDetectionMonths,
      totalInterimChecks,
      monthsSpan,
      confidenceGain,
    },
  }
}

/**
 * 키오스크 중간점검 데이터를 정식 series에 병합한 "보강된 series" 생성.
 * → 이걸 runCycleAnalysis에 다시 넣으면 "중간점검 포함 재분석" 결과가 나온다.
 *   (시뮬레이션의 Before/After 중 After 분석용)
 *
 * 주의: 중간점검은 저정밀이라 불확도/Guard Band는 비워둠 (드리프트 추세에만 기여).
 */
export function mergeInterimIntoSeries(
  series: TrendSeries[],
  interim: InterimCheckSeries[],
): TrendSeries[] {
  const interimMap = new Map(interim.map(i => [i.label, i]))

  return series.map(s => {
    const matching = interimMap.get(s.label)
    if (!matching) return s

    // 중간점검점을 TrendPoint로 변환 (저정밀 — 불확도/GuardBand null)
    const interimPoints: TrendPoint[] = matching.checks.map(c => ({
      교정일: c.date,
      yearLabel: c.date.slice(0, 7),  // YYYY-MM (월 단위 구분)
      오차: null,                      // 키오스크는 추정 사용률만 (절대오차 미산출)
      허용오차: null,
      비율: c.usageRatio,              // 핵심: 한계 사용률만 기여
      판정: 'interim',
      불확도: null,
      utRatio: null,
      guardBand: null,
    }))

    // 시간순 병합 (정식 + 중간점검)
    const merged = [...s.points, ...interimPoints].sort((a, b) =>
      a.교정일.localeCompare(b.교정일),
    )
    return { ...s, points: merged }
  })
}

// ─────────────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────────────

function latestUsage(s: TrendSeries): number | null {
  for (let i = s.points.length - 1; i >= 0; i--) {
    if (s.points[i].비율 != null) return s.points[i].비율
  }
  return null
}

function latestCalDate(s: TrendSeries): string | null {
  for (let i = s.points.length - 1; i >= 0; i--) {
    if (s.points[i].교정일) return s.points[i].교정일
  }
  return null
}

/** 실제 시계열에서 연간 드리프트 속도(%p/년) 추정 — 단순 (마지막-처음)/연수 */
function estimateDriftRate(s: TrendSeries): number | null {
  const valid = s.points.filter(p => p.비율 != null && p.교정일)
  if (valid.length < 2) return null
  const first = valid[0]
  const last = valid[valid.length - 1]
  const deltaUsage = (last.비율 as number) - (first.비율 as number)
  const years = yearDiff(first.교정일, last.교정일)
  if (years < 0.3) return null
  return deltaUsage / years
}

function defaultTorquePoints(): string[] {
  // NORBAR 토크 트랜스듀서 0~25 N·m 가정 — 대표 측정 포인트
  return ['2.5 N·m', '5 N·m', '10 N·m', '12.5 N·m', '15 N·m', '20 N·m', '22.5 N·m', '25 N·m']
}

/** 정식 시계열 자체가 없을 때 합성 (토크 기준, 4개년) */
function synthTorqueSeries(meta: { manufacturer?: string; model?: string }): TrendSeries[] {
  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|synth`)
  const years = ['2022', '2023', '2024', '2025']
  return defaultTorquePoints().slice(0, 5).map((label, idx) => {
    const rng = makeRng(seed + idx * 3301)
    const start = clamp(gaussian(rng, 25, 8), 8, 50)
    const drift = clamp(gaussian(rng, 6, 2), 2, 12)
    const points: TrendPoint[] = years.map((y, yi) => {
      const usage = clamp(start + drift * yi + gaussian(rng, 0, 3), 3, 99)
      return {
        교정일: `${y}-06-01`,
        yearLabel: y,
        오차: null,
        허용오차: null,
        비율: round1(usage),
        판정: '적합',
        불확도: null,
        utRatio: round1(clamp(gaussian(rng, 12, 4), 4, 30)),
        guardBand: 'conformant' as GuardBandVerdict,
      }
    })
    return { key: label, label, unit: 'N·m', points }
  })
}

function inferTorqueGroupName(meta: { manufacturer?: string; model?: string; category?: string | null }): string {
  if (meta.category) return meta.category
  const mfr = meta.manufacturer?.trim()
  if (mfr) return `Torque Transducer (${mfr})`
  return 'Torque Transducer'
}

// ─── 수치 유틸 ───

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function round1(v: number): number {
  return Math.round(v * 10) / 10
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * 표준정규 CDF 근사 (Abramowitz-Stegun 26.2.17).
 * 반환값 = P(X ≤ x) (lower-tail). 즉 x가 클수록 1에 가까움.
 *   예) x=mean → 0.5,  x≫mean → ~1.0,  x≪mean → ~0.0
 */
function normalCdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return x >= mean ? 1 : 0
  const z = (x - mean) / sd
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  // tailProb = P(Z > |z|) — 표준정규 상측 꼬리 확률
  const tailProb =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  // z ≥ 0 이면 CDF = 1 - 상측꼬리, z < 0 이면 CDF = 상측꼬리(대칭)
  return z >= 0 ? 1 - tailProb : tailProb
}

/** "YYYY-MM-DD" + N개월 → "YYYY-MM-DD" */
function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m) return dateStr
  const total = (m - 1) + months
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12) + 1
  const dd = d || 1
  return `${ny}-${String(nm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

function yearDiff(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  if (!ay || !by) return 0
  return (by - ay) + ((bm || 1) - (am || 1)) / 12
}

// ─────────────────────────────────────────────────────────────────
// 3) Demo series — 발표용 실데이터 대체 (k-tools 변환 다운 시 임시)
//
// ⚠️ 이건 "성적서 파싱 결과(series)"를 통째로 대체하는 발표 전용 mock이다.
//    환경변수 NEXT_PUBLIC_CYCLE_DEMO_MODEL 로 특정 모델 1개에만 적용된다.
//    k-tools 복구되면 .env.local에서 그 줄만 지우면 실데이터로 자동 복귀.
//
// 설계 (단축 권고가 나오도록 의도적으로 구성):
//   - 250 N·m 클래스 토크렌치, ISO 6789 비율 교정점(20/40/60/80/100% FS) 6회 이력 모사
//   - 저토크 포인트(50 N·m)는 한계로 빠르게 상승 → urgent → 단축 유도
//   - 일부 포인트는 안정 → "위험 포인트만 콕 짚는다"는 대비 효과
//   - 오차/허용오차/불확도/Guard Band 모두 채움 → step2·3 정상 동작
// ─────────────────────────────────────────────────────────────────

// 발표용 demo 교정일 (실제 장비 이력과 유사한 6회, 약 12개월 주기로 2년치)
const DEMO_CAL_DATES = ['2024-06-12', '2024-12-09', '2025-01-09', '2025-07-28', '2026-01-15', '2026-06-11']

/**
 * 발표용 토크렌치 6회 교정 이력 (단축 권고 시나리오, 전문가 검증 가능 수준).
 *
 * 물리적 타당성:
 *   - 250 N·m 클래스 토크렌치. 교정점은 ISO 6789-2 권장 비율점(풀스케일의 20/40/60/80/100%)
 *     → 50/100/150/200/250 N·m. 정수점이라 청중 이해 쉽고 표준 근거도 있음(발표용).
 *   - 허용오차 ±4% (지시값 대비, ISO 6789 클릭식 토크렌치 일반값)
 *   - 저토크(50 N·m)에서 마모가 가장 빠름 — 클릭식 토크렌치 스프링은 저토크 세팅에서
 *     상대오차가 크게 나타나는 실제 현상 (ISO 6789 Part 2의 reproducibility 항목과 일치)
 *   - 오차열은 단조증가가 아니라 측정 노이즈(±0.1~0.2%p)를 포함 — 실측의 자연스러운 산포
 *   - U/T는 포인트마다 다르고 회차별로 미세 변동 (교정기/환경 차이 반영)
 *   - ⚠️ 전부 발표용 mock — 실제 교정성적서 데이터 아님 (k-tools 변환기 다운으로 임시 합성)
 */
export function buildDemoTorqueSeries(): TrendSeries[] {
  const dates = DEMO_CAL_DATES

  // 측정 포인트별 시나리오 (N·m). errSeq = 6회 상대오차(%), 부호 포함.
  // uSeq = 6회 U/T(%) — 약간 변동. tol = 허용오차(±%).
  const specs: Array<{
    label: string
    tol: number
    errSeq: number[]
    uSeq: number[]
  }> = [
    // 50 N·m (20% FS, 저토크): 명확한 악화 추세. 외삽 시 guard-band 한계 도달까지 약 8개월
    //   → 가장 빠른 crossing 중 하나. 권장 재교정일이 Spec due(12mo)와 직전 교정일 사이
    //   중간(~8mo)에 자연스럽게 떨어진다(라벨 안 겹침, 현실적). 클릭식 저토크 스프링 마모 전형.
    { label: '50 N·m', tol: 4, errSeq: [-0.9, -1.4, -1.9, -2.3, -2.6, -2.8], uSeq: [11, 12, 11, 12, 13, 12] },
    // 100 N·m (40% FS): 완만 상승. 외삽 시 약 8개월 후 한계 도달 → 50 N·m와 함께 권고 근거.
    { label: '100 N·m', tol: 4, errSeq: [0.6, 0.6, 1.1, 1.7, 2.4, 2.9], uSeq: [10, 11, 10, 11, 11, 10] },
    // 150 N·m (60% FS): 안정 (산포만)
    { label: '150 N·m', tol: 4, errSeq: [0.4, -0.2, 0.5, 0.0, -0.3, 0.3], uSeq: [9, 10, 9, 10, 9, 10] },
    // 200 N·m (80% FS): 안정 (산포만)
    { label: '200 N·m', tol: 4, errSeq: [-0.6, 0.3, -0.5, 0.6, -0.3, 0.5], uSeq: [9, 9, 10, 9, 10, 9] },
    // 250 N·m (100% FS, 만점): 완만 상승, 최신 2.5/4 = 62.5%
    { label: '250 N·m', tol: 4, errSeq: [0.7, 1.0, 0.9, 1.3, 1.9, 2.5], uSeq: [12, 13, 12, 13, 12, 13] },
  ]

  return specs.map((s) => {
    const points: TrendPoint[] = s.errSeq.map((err, i) => {
      const ratio = Math.min(100, (Math.abs(err) / s.tol) * 100)  // 한계 사용률 %
      const uPct = s.uSeq[i]
      const uAbs = (uPct / 100) * s.tol                            // U 절대값 (% 단위)
      // Guard Band (ILAC-G8): |err| + U vs tol
      const gb: GuardBandVerdict =
        Math.abs(err) + uAbs <= s.tol ? 'conformant' :
        Math.abs(err) <= s.tol ? 'conditional-pass' :
        Math.abs(err) - uAbs <= s.tol ? 'conditional-fail' :
        'non-conformant'
      return {
        교정일: dates[i],
        yearLabel: dates[i].slice(0, 4),
        오차: round1(err),
        허용오차: s.tol,
        비율: round1(ratio),
        판정: Math.abs(err) <= s.tol ? '적합' : '부적합',
        불확도: round1(uAbs),
        utRatio: uPct,
        guardBand: gb,
      }
    })
    return { key: s.label, label: s.label, unit: 'N·m', points }
  })
}

/** 발표용 demo 교정일 목록 (calDates 대체) */
export function buildDemoCalDates(): string[] {
  return [...DEMO_CAL_DATES]
}

/**
 * 발표용 demo profile — base 주기를 6개월로 만들기 위한 mock 사양서.
 * (KOLAS 토크렌치 권장 교정주기 = 6개월)
 * 데모 타깃 장비일 때만 사용. (실제 profile이 404라서)
 */
export function buildDemoProfile(): {
  category: string
  calibration: { recommended_cycle: string; standards: string[] }
} {
  return {
    category: 'Torque Wrench',
    calibration: {
      recommended_cycle: '6개월',
      standards: ['KOLAS-G-008', 'ISO 6789-1:2017', 'ISO 6789-2:2017'],
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// 4) Error forecast — 한 측정점의 과거 오차 추세를 미래로 외삽.
//    "이 추세를 유지하면 N개월 뒤 tolerance(가드밴드)를 넘는다"를 증명하는 차트용.
//
//    설계:
//      - 측정 오차(부호 포함 %)를 시간(년) 대비 선형회귀 → 기울기/절편.
//      - 잔차 표준편차로 예측 불확실성(CI) 밴드 생성. 미래로 갈수록 넓어짐.
//      - tolerance 침범 = |예측오차| + U(불확도) ≥ tolerance (ILAC-G8 가드밴드 기준).
//      - crossing 시점을 best/lower/upper(95% CI)로 산출.
//    결정적(실데이터 회귀) — 발표 중 새로고침해도 동일.
// ─────────────────────────────────────────────────────────────────

export interface ErrorForecastPoint {
  date: string                 // YYYY-MM-DD
  yearFrac: number             // 기준점 대비 경과 연수 (회귀 X축)
  measured: boolean            // true=실측 과거, false=예측 미래
  interim?: boolean            // true=키오스크 중간점검점(저정밀, 큰 U) — 차트 구분용
  error: number                // 오차(%) — 실측이면 측정값, 예측이면 회귀 중심선
  u: number | null             // 확장불확도(%) — 실측 점에만
  ciLow68: number              // 68% CI 하한 (예측 점)
  ciHigh68: number             // 68% CI 상한
  ciLow95: number              // 95% CI 하한
  ciHigh95: number             // 95% CI 상한
}

export interface ErrorForecast {
  available: boolean
  label: string                // 측정점 라벨 (예: "62.2 N·m")
  tolerance: number            // 적합성 상한 ± (%)
  guardBandU: number           // 가드밴드에 쓰는 대표 불확도(%) — 최신 U
  points: ErrorForecastPoint[] // 과거+미래 시계열 (시간순)
  nowDate: string              // 마지막 실측일 (NOW 기준선)
  crossing: {
    // |error| + U 가 tolerance 에 도달하는 시점
    best: string | null        // 중심 추정 crossing 날짜
    low: string | null         // 빠른 쪽 (95% CI 상한선이 먼저 닿음)
    high: string | null        // 늦은 쪽
    bestMonths: number | null  // 마지막 실측일로부터 best까지 개월
    crossesWithinSpec: boolean // base 주기(12개월) 안에 넘는가
  }
  direction: 'up' | 'down'     // 오차가 양/음 방향으로 커지는지
  fit: {
    slopePerYear: number       // 회귀 기울기 (%/year) — 연간 드리프트율
    intercept: number          // y절편 (회귀식 표기용, 기준일 t=0 기준)
    r2: number                 // 결정계수 (0~1)
    n: number                  // 회귀에 쓴 점 수
    significant: boolean       // 추세가 유의한가 (R² 임계 + 점수). false면 "안정"
  }
}

/** 단순 선형회귀 → {slope, intercept, residualSd, r2, n} */
function linReg(xs: number[], ys: number[]): { slope: number; intercept: number; residualSd: number; r2: number; n: number } {
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
    syy += (ys[i] - my) ** 2
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const intercept = my - slope * mx
  let ssr = 0
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i]
    ssr += (ys[i] - pred) ** 2
  }
  const residualSd = n > 2 ? Math.sqrt(ssr / (n - 2)) : Math.sqrt(ssr / Math.max(1, n))
  // R² = 1 − SSR/SST. SST(=syy)가 0이면(전부 동일값) 정의 불가 → 0.
  const r2 = syy > 1e-9 ? Math.max(0, 1 - ssr / syy) : 0
  return { slope, intercept, residualSd, r2, n }
}

/**
 * 한 측정점 시계열에서 오차 예측 차트 데이터 생성.
 * @param s          이 측정점의 TrendSeries (교정일·오차·불확도·허용오차)
 * @param horizonMonths 미래로 외삽할 개월 수 (base 주기 + 여유)
 * @param specMonths  base 권장주기 (crossesWithinSpec 판정용)
 */
export function buildErrorForecast(
  s: TrendSeries,
  horizonMonths: number,
  specMonths: number,
): ErrorForecast {
  const hist = s.points.filter(p => p.오차 != null && p.교정일)
  const tol = (() => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].허용오차 != null) return Math.abs(s.points[i].허용오차 as number)
    }
    return 4
  })()
  if (hist.length < 2) {
    return {
      available: false, label: s.label, tolerance: tol, guardBandU: 0,
      points: [], nowDate: hist[0]?.교정일 ?? '', direction: 'up',
      crossing: { best: null, low: null, high: null, bestMonths: null, crossesWithinSpec: false },
      fit: { slopePerYear: 0, intercept: 0, r2: 0, n: hist.length, significant: false },
    }
  }

  const base = hist[0].교정일
  const xs = hist.map(p => yearDiff(base, p.교정일))
  const ys = hist.map(p => p.오차 as number)
  const { slope, intercept, residualSd, r2, n } = linReg(xs, ys)
  const direction: 'up' | 'down' = slope >= 0 ? 'up' : 'down'
  // 추세 유의성: R²이 충분히 높고(>0.5) 기울기가 의미있게 큰 경우만 "추세 있음".
  //   안정 포인트(노이즈만)는 R²≈0 → "no significant trend"로 표기해 오해 방지.
  const significant = r2 >= 0.5 && Math.abs(slope) >= 0.15

  // 대표 불확도(가드밴드/crossing용): 최신 "정식" 측정 U.
  //   ★ 키오스크 중간점검점(판정='interim')은 개별 U가 크지만(차트 막대용),
  //   crossing 판정엔 정식 측정의 작은 U를 쓴다 — 추세는 다수 평균이 잡으므로
  //   개별 큰 U로 가드밴드를 터뜨리면 안 된다. 정식 U가 없을 때만 일반 U/잔차SD.
  const latestU = (() => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].판정 !== 'interim' && s.points[i].불확도 != null) return Math.abs(s.points[i].불확도 as number)
    }
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].불확도 != null) return Math.abs(s.points[i].불확도 as number)
    }
    return residualSd
  })()

  // 현재 기준일(NOW) = 마지막 "정식" 측정일. 키오스크 중간점검점은 NOW 이후의
  //   미래 데이터로 섞이므로, crossing 의 "N개월 후" 기준이 미래로 밀리지 않도록
  //   정식점 우선으로 잡는다. (정식점이 없으면 마지막 측정점.)
  const nowDate = (() => {
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].판정 !== 'interim') return hist[i].교정일
    }
    return hist[hist.length - 1].교정일
  })()
  const nowX = yearDiff(base, nowDate)
  // 순수 최소제곱 회귀선 — 화면의 직선·수식과 100% 일치(엑셀 추세선 방식).
  //   과거 적합선과 미래 예측선이 하나의 직선으로 매끄럽게 이어진다.
  const yAt = (x: number) => intercept + slope * x
  const sign = (intercept + slope * nowX) >= 0 ? 1 : -1

  // 과거 실측 점 (정식 교정 + 키오스크 중간점검 — 후자는 interim 플래그로 구분)
  const points: ErrorForecastPoint[] = hist.map(p => ({
    date: p.교정일,
    yearFrac: yearDiff(base, p.교정일),
    measured: true,
    interim: p.판정 === 'interim',
    error: p.오차 as number,
    u: p.불확도 != null ? Math.abs(p.불확도 as number) : null,
    ciLow68: p.오차 as number, ciHigh68: p.오차 as number,
    ciLow95: p.오차 as number, ciHigh95: p.오차 as number,
  }))

  // 미래 예측 점 (분기별로 촘촘히)
  const stepMonths = 3
  for (let m = stepMonths; m <= horizonMonths; m += stepMonths) {
    const date = addMonths(nowDate, m)
    const x = yearDiff(base, date)
    const yhat = yAt(x)
    const dx = Math.max(0, x - nowX)
    const predSd = forecastSd(dx, residualSd, slope, latestU)
    // 불확도 밴드 = 예측 ± U (고정폭). ci 필드는 모두 ±U 동일값으로 채운다(부채꼴 없음).
    points.push({
      date, yearFrac: x, measured: false, error: round1(yhat), u: round1(predSd),
      ciLow68: round1(yhat - predSd), ciHigh68: round1(yhat + predSd),
      ciLow95: round1(yhat - predSd), ciHigh95: round1(yhat + predSd),
    })
  }

  // tolerance 침범 시점 (추세 + 측정 불확도):
  //   권장 교정시점 = (|예측오차| + U) 가 tolerance 에 닿는 시점 (ILAC-G8 가드밴드).
  //     → "불확도까지 고려하면 이때 한계를 넘는다"는 객관적 기준.
  //   best=예측+U 상단, low/high=중심선/+2U 로 빠른·늦은 경계 표시(참고용).
  const solveCross = (k: number): string | null => {
    for (let m = 1; m <= horizonMonths + 36; m += 1) {
      const date = addMonths(nowDate, m)
      const x = yearDiff(base, date)
      const yhat = yAt(x)
      const bandEdge = yhat * sign + k * latestU   // 위험 방향 밴드 상단
      if (bandEdge >= tol) return date
    }
    return null
  }
  const best = solveCross(1)     // 권장일 = (예측 + U) 가 한계 닿는 시점
  const low = solveCross(2)      // 더 보수적(빠른): 예측 + 2U
  const high = solveCross(0)     // 중심선(예측값)이 닿는 시점 — 늦은 쪽
  const bestMonths = best ? Math.round(monthDiff(nowDate, best)) : null

  return {
    available: true, label: s.label, tolerance: tol, guardBandU: round1(latestU),
    points, nowDate, direction,
    crossing: {
      best, low, high, bestMonths,
      crossesWithinSpec: bestMonths != null && bestMonths <= specMonths,
    },
    fit: {
      slopePerYear: round2(slope),     // yearDiff가 연 단위라 slope = %/year
      intercept: round2(intercept),
      r2: Math.round(r2 * 100) / 100,
      n,
      significant,
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Interim forecast overlay (Future Work) — Step2 예측차트 위에
//   "정식 교정점 사이사이로 들어오는 키오스크 중간점검점"을 겹쳐 그린다.
//   키오스크는 저정밀(U 큼)이지만 고빈도라, 같은 추세를 더 일찍·더 확실히
//   드러낸다 → formal-only 회귀선보다 with-interim 회귀선이 한계에 빨리 닿음.
// ─────────────────────────────────────────────────────────────────

/**
 * 정식 series 에 "키오스크 중간점검점"을 측정점(오차+큰 U)으로 병합한 series 생성.
 *   → 이 series 를 buildErrorForecast 에 넣으면 회귀선·crossing·권고가 키오스크
 *     데이터까지 반영해 재계산된다(차트의 토글 ON 상태).
 *   - 키오스크점: 마지막 정식 교정 이후 월 1회, 정식 추세선 위 + 작은 노이즈,
 *     불확도(U)는 정식의 ~3.5배(저정밀). guardBand 는 비워둠(추세 기여만).
 * @param s 한 측정점의 정식 시계열
 * @param baseMonths 현재 주기 — 키오스크 커버 범위
 * @param meta 시드용
 */
export function buildInterimAugmentedSeries(
  s: TrendSeries,
  baseMonths: number,
  meta: { manufacturer?: string; model?: string },
): TrendSeries {
  const hist = s.points.filter(p => p.오차 != null && p.교정일)
  if (hist.length < 2) return s

  const tol = (() => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].허용오차 != null) return Math.abs(s.points[i].허용오차 as number)
    }
    return 4
  })()
  const baseDate = hist[0].교정일
  const nowDate = hist[hist.length - 1].교정일
  const yf = (d: string) => yearDiff(baseDate, d)
  const fxs = hist.map(p => yf(p.교정일))
  const fys = hist.map(p => p.오차 as number)
  const fReg = linReg(fxs, fys)
  const trend = (x: number) => fReg.intercept + fReg.slope * x

  const formalU = (() => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].불확도 != null) return Math.abs(s.points[i].불확도 as number)
    }
    return Math.max(0.3, fReg.residualSd)
  })()
  // 키오스크 U = 정식의 약 2배(저정밀이지만 과하지 않게). tol 대비 상한.
  const interimU = Math.min(tol * 0.4, round1(formalU * 2))

  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|${s.label}|aug`)
  const rng = makeRng(seed)
  const monthsSpan = Math.max(6, Math.round(baseMonths * 0.9))

  const interimPoints: TrendPoint[] = []
  for (let m = 1; m <= monthsSpan; m++) {
    const date = addMonths(nowDate, m)
    const x = yf(date)
    // 개별 키오스크는 저정밀(큰 U, 차트 막대로 표시)이나, 추세 자체는 충실히
    //   따르도록 노이즈 σ 를 작게(0.15·U) 둔다 — "다수가 모이면 추세는 안정"이
    //   데이터로 성립해야 회귀선이 정식 대비 흔들리지 않는다.
    const noisy = round1(trend(x) + gaussian(rng, 0, interimU * 0.15))
    const ratio = Math.min(100, (Math.abs(noisy) / tol) * 100)
    interimPoints.push({
      교정일: date,
      yearLabel: date.slice(0, 7),
      오차: noisy,
      허용오차: tol,
      비율: round1(ratio),
      판정: 'interim',
      불확도: interimU,          // 키오스크 = 큰 U (차트에 큰 막대로 표시)
      utRatio: round1((interimU / tol) * 100),
      guardBand: null,           // 저정밀 — 가드밴드 판정엔 미기여(추세에만)
    })
  }

  const merged = [...s.points, ...interimPoints].sort((a, b) => a.교정일.localeCompare(b.교정일))
  return { ...s, points: merged }
}

export interface InterimOverlayPoint {
  date: string
  yearFrac: number
  error: number                // 오차(%) — 부호 포함
  u: number                    // 확장불확도(%) — 키오스크는 크다
  kind: 'formal' | 'interim'   // 정식 교정 vs 키오스크 중간점검
}

export interface InterimForecastOverlay {
  available: boolean
  label: string
  tolerance: number
  nowDate: string              // 마지막 정식 교정일
  points: InterimOverlayPoint[]
  // 두 회귀 (formal-only vs formal+interim) — 차트의 두 추세선·crossing
  formal:  { slopePerYear: number; intercept: number; r2: number; n: number; crossDate: string | null; crossMonths: number | null }
  interim: { slopePerYear: number; intercept: number; r2: number; n: number; crossDate: string | null; crossMonths: number | null }
  baseDate: string             // 회귀 X축 t=0 (첫 정식 교정일)
  interimU: number             // 키오스크 대표 U (범례용)
  formalU: number              // 정식 대표 U (범례용)
  earlyDetectionMonths: number | null  // formal 대비 며 달 일찍 한계 도달 감지
  // ── 양방향 가치 판단 ──
  //   drifting: 드리프트가 base 주기 안/근처에 한계 도달 → 조기 교정 필요(위험↓)
  //   stable:   base 주기 내내 여유 → 교정 연장 가능(비용↓)
  baseMonths: number
  caseKind: 'drifting' | 'stable'
  // 드리프트 케이스: 키오스크가 추세 도달을 정식보다 며 달 일찍 잡나
  crossWithinBase: boolean
  // 안정 케이스: base 주기 끝에서 한계까지 남는 여유(%) — 연장 정당화
  marginAtBaseEnd: number | null
}

/**
 * 한 측정점에서 "정식만 vs 정식+키오스크" 오차 예측 오버레이 생성.
 *   - 정식점: 기존 series의 오차·U (작은 U).
 *   - 키오스크점: 마지막 정식 교정 이후 월 1회, 정식 추세선 위에 큰 노이즈 + 큰 U.
 *   - 두 회귀선의 |error|+U 가 ±tol 에 닿는 시점을 각각 구해 조기감지 개월 산출.
 * @param s 이 측정점 시계열
 * @param baseMonths 현재 주기 (키오스크 커버 범위·crossing 기준)
 * @param meta 시드용
 */
export function buildInterimForecastOverlay(
  s: TrendSeries,
  baseMonths: number,
  meta: { manufacturer?: string; model?: string },
): InterimForecastOverlay {
  const hist = s.points.filter(p => p.오차 != null && p.교정일)
  const tol = (() => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].허용오차 != null) return Math.abs(s.points[i].허용오차 as number)
    }
    return 4
  })()
  const empty: InterimForecastOverlay = {
    available: false, label: s.label, tolerance: tol, nowDate: '', points: [],
    formal:  { slopePerYear: 0, intercept: 0, r2: 0, n: 0, crossDate: null, crossMonths: null },
    interim: { slopePerYear: 0, intercept: 0, r2: 0, n: 0, crossDate: null, crossMonths: null },
    baseDate: '', interimU: 0, formalU: 0, earlyDetectionMonths: null,
    baseMonths, caseKind: 'stable', crossWithinBase: false, marginAtBaseEnd: null,
  }
  if (hist.length < 2) return empty

  const baseDate = hist[0].교정일
  const nowDate = hist[hist.length - 1].교정일
  const yf = (d: string) => yearDiff(baseDate, d)

  // 정식 회귀 (formal-only)
  const fxs = hist.map(p => yf(p.교정일))
  const fys = hist.map(p => p.오차 as number)
  const fReg = linReg(fxs, fys)

  // 정식 대표 U
  const formalU = (() => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].불확도 != null) return Math.abs(s.points[i].불확도 as number)
    }
    return Math.max(0.3, fReg.residualSd)
  })()
  // 키오스크 U = 정식의 약 3.5배 (저정밀). 단 tol 대비 과하지 않게 상한.
  // 키오스크 U = 정식의 약 2배(저정밀이지만 과하지 않게). tol 대비 상한.
  const interimU = Math.min(tol * 0.4, round1(formalU * 2))

  // 키오스크점 합성: 마지막 정식 이후 월 1회, 정식 추세선 위 + 큰 노이즈
  const seed = hashSeed(`${meta.manufacturer ?? ''}|${meta.model ?? ''}|${s.label}|overlay`)
  const rng = makeRng(seed)
  const trend = (x: number) => fReg.intercept + fReg.slope * x
  const monthsSpan = Math.max(6, Math.round(baseMonths * 0.9))
  const formalPts: InterimOverlayPoint[] = hist.map(p => ({
    date: p.교정일, yearFrac: yf(p.교정일), error: p.오차 as number,
    u: p.불확도 != null ? Math.abs(p.불확도 as number) : formalU, kind: 'formal',
  }))
  const interimPts: InterimOverlayPoint[] = []
  for (let m = 1; m <= monthsSpan; m++) {
    const date = addMonths(nowDate, m)
    const x = yf(date)
    // 저정밀 개별 측정: 추세선 위에 노이즈. 단 노이즈 σ는 표시 U보다 작게(0.35·U)
    //   둔다 — "개별 점은 흩어져도 다수가 모이면 추세(회귀선)는 안정적"이라는
    //   메시지를 데이터가 실제로 만족하도록(회귀가 노이즈에 휘둘리지 않도록).
    const noisy = trend(x) + gaussian(rng, 0, interimU * 0.35)
    interimPts.push({ date, yearFrac: x, error: round1(noisy), u: interimU, kind: 'interim' })
  }
  const points = [...formalPts, ...interimPts].sort((a, b) => a.yearFrac - b.yearFrac)

  // with-interim 회귀 (정식 + 키오스크 전부)
  const ixs = points.map(p => p.yearFrac)
  const iys = points.map(p => p.error)
  const iReg = linReg(ixs, iys)

  // crossing = (|추세선| + U) 가 ±tol 에 닿는 시점 (Step2 ErrorForecast 와 동일 규칙).
  //   ★ 핵심: crossing 판정의 U 는 "개별 키오스크 측정 U(큼)"가 아니라 "추세
  //   추정의 신뢰도"다. 키오스크는 점이 많아(n↑) 추세선 자체는 정밀 → 정식과
  //   같은 작은 U(formalU)로 추세 도달을 판정한다. 개별 U 가 큰 건 차트에 막대로
  //   보여주는 시각 정보일 뿐, 다수 평균이 추세를 안정적으로 잡는다.
  const sign = (reg: { slope: number; intercept: number }) =>
    (reg.intercept + reg.slope * yf(nowDate)) >= 0 ? 1 : -1
  const solveCross = (reg: { slope: number; intercept: number }, u: number): { date: string | null; months: number | null } => {
    const sg = sign(reg)
    if (reg.slope * sg <= 1e-6) return { date: null, months: null }  // 추세 없음/감소 → 안 넘음
    for (let m = 1; m <= monthsSpan + 48; m++) {
      const date = addMonths(nowDate, m)
      const x = yf(date)
      const edge = (reg.intercept + reg.slope * x) * sg + u
      if (edge >= tol) return { date, months: m }
    }
    return { date: null, months: null }
  }
  // 추세 자체가 도달하는 시점(하한 전). 양 회귀 모두 추세 신뢰 U(formalU)로 판정.
  const trendCross = solveCross(fReg, formalU)
  const iCross = solveCross(iReg, formalU)
  // formal: "정식 교정 때나 확인 가능" → 다음 정식 교정(baseMonths) 전엔 모름.
  const fCrossMonths = trendCross.months != null ? Math.max(trendCross.months, baseMonths) : null
  const fCrossDate = fCrossMonths != null ? addMonths(nowDate, fCrossMonths) : null
  // interim: 촘촘한 데이터라 실제 추세 도달 시점에 바로 확인 (하한 없음).
  const earlyDetectionMonths =
    fCrossMonths != null && iCross.months != null ? Math.max(0, fCrossMonths - iCross.months) : null

  // ── 케이스 분류: base 주기 안(또는 근처)에 추세가 한계 도달하면 'drifting' ──
  const trendMonths = trendCross.months   // 하한 적용 전, 순수 추세 도달
  const caseKind: 'drifting' | 'stable' =
    (trendMonths != null && trendMonths <= baseMonths) ? 'drifting' : 'stable'
  const crossWithinBase = caseKind === 'drifting'
  // 안정 케이스: base 주기 끝 시점에서 (|추세|+U) 가 tol 까지 남기는 여유(%).
  const sgF = sign(fReg)
  const xBaseEnd = yf(addMonths(nowDate, baseMonths))
  const edgeAtBaseEnd = (fReg.intercept + fReg.slope * xBaseEnd) * sgF + formalU
  const marginAtBaseEnd = caseKind === 'stable' ? round1(tol - edgeAtBaseEnd) : null

  return {
    available: true, label: s.label, tolerance: tol, nowDate, points,
    formal:  { slopePerYear: round2(fReg.slope), intercept: round2(fReg.intercept), r2: Math.round(fReg.r2 * 100) / 100, n: fReg.n, crossDate: fCrossDate, crossMonths: fCrossMonths },
    interim: { slopePerYear: round2(iReg.slope), intercept: round2(iReg.intercept), r2: Math.round(iReg.r2 * 100) / 100, n: iReg.n, crossDate: iCross.date, crossMonths: iCross.months },
    baseDate, interimU, formalU, earlyDetectionMonths,
    baseMonths, caseKind, crossWithinBase, marginAtBaseEnd,
  }
}

/**
 * 예측 불확실성 표준편차(%). now(dx=0)에서 측정 U의 절반에서 시작해,
 * 외삽 거리(dx, 년)에 따라 기울기 오차 + 랜덤워크로 커진다.
 *   - dx=0  → 0.5·U (측정 자체 불확도 수준, 밴드가 좁게 출발)
 *   - dx↑   → 추세 외삽 오차가 지배 (선형 + √시간)
 */
// 불확도 밴드(고정폭) = 측정 불확도 U.
//   추세선 + 측정 불확도만 고려한다(객관적·방어 가능). 시점 무관 고정폭이라
//   밴드가 "점점 넓어지는 부채꼴"이 아니라 추세선을 따라 ±U 로 평행하게 간다.
//   외삽에 따른 예측 신뢰수준 저하(멀수록 넓어짐)는 정량화하지 않고 Future Work 로 남긴다.
function forecastSd(_dx: number, _residualSd: number, _slope: number, latestU: number): number {
  return latestU
}

/** 두 YYYY-MM-DD 사이 개월 수 (근사) */
function monthDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  if (!ay || !by) return 0
  return (by - ay) * 12 + ((bm || 1) - (am || 1)) + ((bd || 1) - (ad || 1)) / 30
}
