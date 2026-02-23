// 장비 건강검진 AI — 진단(점수) / 예측(교정주기) / 처방(권고사항)
// 클라이언트 사이드, 규칙기반 통계 분석. LLM 호출 없음.

// ─── 타입 ───

export interface TrendPoint {
  교정일: string
  yearLabel: string
  오차: number | null
  허용오차: number | null
  비율: number | null
  판정: string
}

export interface TrendSeries {
  key: string
  label: string
  unit: string
  points: TrendPoint[]
}

export interface HealthScore {
  total: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  gradeLabel: string
  components: {
    toleranceProximity: number
    longTermStability: number
    shortTermStability: number
    failHistory: number
    dataAvailability: number
  }
}

export interface CyclePredictionDetail {
  label: string           // 측정포인트명 (예: "81.36 N·m")
  recentYears: string[]   // 분석 대상 연도 (예: ["2022","2024","2025","2026"])
  recentErrors: number[]  // 해당 연도 절대오차
  slope: number           // 기울기 (%p/년 또는 오차단위/년)
  pValue: number          // t-검정 p-value
  significant: boolean    // 통계적 유의성 (p < 0.05)
  usageRatio: number | null    // |오차|/|허용오차| % (최신 측정 기준)
  yearsToLimit: number | null  // 현 추세로 허용한계 도달까지 남은 연수
}

export interface CycleSimulationRow {
  cycleMonths: number
  healthScore: number           // 예상 건강점수
  grade: HealthScore['grade']
  dangerCount: number           // 위험 포인트 건수
  dangerPoints: { label: string; usageRatio: number }[]  // 위험 포인트 상세
  verdict: 'safe' | 'caution' | 'danger'
}

export interface CycleSimulation {
  rows: CycleSimulationRow[]
  shortestPoint: { label: string; yearsToLimit: number } | null
  criticalDetails: {
    label: string
    usageRatio: number | null
    slope: number
    yearsToLimit: number | null
    significant: boolean
  }[]
}

export interface CyclePrediction {
  recommendedCycleMonths: number | null
  currentCycleMonths: number | null
  direction: 'shorten' | 'maintain' | 'extend' | 'insufficient'
  directionLabel: string
  reasoning: string
  details: CyclePredictionDetail[]  // 포인트별 분석 근거
  simulation: CycleSimulation | null  // 주기별 시뮬레이션 (insufficient일 때 null)
  extrapolation: {
    currentRatio: number | null
    regressionSlope: number | null
    yearsTo80: number | null
    yearsTo100: number | null
    predictedDate100: string | null
  }
}

export interface Prescription {
  priority: 'high' | 'medium' | 'low'
  category: string
  categoryLabel: string
  title: string
  description: string
}

export interface HealthCheckResult {
  score: HealthScore
  prediction: CyclePrediction
  prescriptions: Prescription[]
  dataPoints: number
  seriesCount: number
}

// ─── 등급 매핑 ───

const GRADE_CONFIG: Record<string, { label: string; labelEn: string }> = {
  A: { label: '우수', labelEn: 'Excellent' },
  B: { label: '양호', labelEn: 'Good' },
  C: { label: '보통', labelEn: 'Fair' },
  D: { label: '주의', labelEn: 'Caution' },
  F: { label: '위험', labelEn: 'Critical' },
}

function toGrade(score: number): HealthScore['grade'] {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 55) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

// ─── 세부 점수 계산 ───

function calcToleranceProximity(series: TrendSeries[]): number {
  const latestRatios: number[] = []
  for (const s of series) {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].비율 != null) {
        latestRatios.push(s.points[i].비율!)
        break
      }
    }
  }
  if (latestRatios.length === 0) return 50

  const worst = Math.max(...latestRatios)
  const avg = latestRatios.reduce((a, b) => a + b, 0) / latestRatios.length
  const composite = worst * 0.7 + avg * 0.3

  if (composite <= 0) return 100
  if (composite <= 80) return 100 - (composite / 80) * 50
  if (composite <= 100) return 50 - ((composite - 80) / 20) * 30
  if (composite <= 120) return 20 - ((composite - 100) / 20) * 20
  return 0
}

// 장기안정성(Long-term stability) 평가: 선형 회귀 기울기의 t-검정
// 교정에서 "안정"이란 오차의 크기가 아니라 변화의 부재.
// 5년 내내 오차 10%인 장비가, 매년 1%씩 감소하는 장비보다 안정적이다.
//
// 방법: 각 측정포인트별 시계열에서 선형 회귀 → slope의 t-검정
// H0: slope = 0 (추세 없음 = 안정)
// p >= 0.05 → 귀무가설 채택 → 안정  |  p < 0.05 → 유의미한 추세 → 불안정

function slopeSignificance(values: number[]): { slope: number; pValue: number } {
  const n = values.length
  if (n < 3) return { slope: 0, pValue: 1 }  // 최소 3점 필요 (df=n-2≥1)

  // x = 0,1,2,...,n-1 (시간축)
  const sumX = (n * (n - 1)) / 2
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6
  const sumY = values.reduce((a, b) => a + b, 0)
  const sumXY = values.reduce((s, y, i) => s + i * y, 0)

  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-12) return { slope: 0, pValue: 1 }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // 잔차 제곱합 (SSE)
  let sse = 0
  for (let i = 0; i < n; i++) {
    const residual = values[i] - (intercept + slope * i)
    sse += residual * residual
  }

  const df = n - 2
  const mse = sse / df
  const seBeta = Math.sqrt(mse / (sumX2 - (sumX * sumX) / n))

  if (seBeta < 1e-12) {
    return { slope, pValue: Math.abs(slope) < 1e-12 ? 1 : 0 }
  }

  const tStat = slope / seBeta
  const absT = Math.abs(tStat)

  // t분포 양측 p-value 근사
  let pValue: number
  if (df >= 30) {
    pValue = 2 * (1 - normalCdf(absT))
  } else {
    // t-table 임계값 (양측 0.05) for df=1..20
    const critTable = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
      2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086]
    const crit05 = df < critTable.length ? critTable[df] : 2.0
    // 0.01 임계값 근사: crit05 * 1.5~1.8
    const crit01 = crit05 * 1.5

    if (absT < crit05 * 0.3) pValue = 0.7
    else if (absT < crit05 * 0.6) pValue = 0.4
    else if (absT < crit05 * 0.85) pValue = 0.15
    else if (absT < crit05) pValue = 0.08
    else if (absT < crit01) pValue = 0.03
    else pValue = 0.005
  }

  return { slope, pValue }
}

function normalCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x)
  const t = 1 / (1 + p * absX)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2)
  return 0.5 * (1 + sign * y)
}

function pValueToScore(pValue: number): number {
  if (pValue >= 0.3) return 100       // 추세 없음 확실 (매우 안정)
  if (pValue >= 0.1) return 80        // 추세 미약 (안정)
  if (pValue >= 0.05) return 60       // 경계 (0.05 턱걸이)
  if (pValue >= 0.01) return 30       // 유의미한 추세 (불안정)
  return 10                           // 매우 유의미한 추세 (경고)
}

// CV(변동계수) 기반 fallback 점수 (데이터 부족 시)
function cvFallbackScore(series: TrendSeries[], minPoints: number): number | null {
  let totalScore = 0
  let count = 0
  for (const s of series) {
    const absErrors = s.points
      .map(p => p.오차 != null ? Math.abs(p.오차) : null)
      .filter((v): v is number => v != null)
    if (absErrors.length < minPoints) continue
    count++
    const mean = absErrors.reduce((a, b) => a + b, 0) / absErrors.length
    const variance = absErrors.reduce((sum, v) => sum + (v - mean) ** 2, 0) / absErrors.length
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0
    totalScore += cv <= 0.05 ? 100 : cv <= 0.15 ? 80 : cv <= 0.3 ? 55 : cv <= 0.5 ? 30 : 10
  }
  return count > 0 ? Math.round(totalScore / count) : null
}

function calcStability(series: TrendSeries[]): { longTerm: number; shortTerm: number } {
  // 장기안정도: 전체 기간 기울기 t-검정
  // 단기안정도: 최근 3년(3점) 기울기 t-검정
  // 각각 독립적으로 보고 — 장기는 OK인데 단기 불안정, 또는 그 반대 가능

  const RECENT_WINDOW = 3

  const longTermScores: number[] = []
  const shortTermScores: number[] = []

  for (const s of series) {
    const absErrors = s.points
      .map(p => p.오차 != null ? Math.abs(p.오차) : null)
      .filter((v): v is number => v != null)

    // 장기: 전체 기간 (3점 이상)
    if (absErrors.length >= 3) {
      const { pValue } = slopeSignificance(absErrors)
      longTermScores.push(pValueToScore(pValue))
    }

    // 단기: 최근 윈도우 (전체 4점 이상일 때만 의미 — 3점이면 장기=단기)
    if (absErrors.length >= 4) {
      const recent = absErrors.slice(-RECENT_WINDOW)
      if (recent.length >= 3) {
        const { pValue } = slopeSignificance(recent)
        shortTermScores.push(pValueToScore(pValue))
      }
    }
  }

  // 장기 점수
  let longTerm: number
  if (longTermScores.length > 0) {
    longTerm = Math.round(longTermScores.reduce((a, b) => a + b, 0) / longTermScores.length)
  } else {
    longTerm = cvFallbackScore(series, 2) ?? 60
  }

  // 단기 점수
  let shortTerm: number
  if (shortTermScores.length > 0) {
    shortTerm = Math.round(shortTermScores.reduce((a, b) => a + b, 0) / shortTermScores.length)
  } else {
    // 데이터 부족 시 장기와 동일하게
    shortTerm = longTerm
  }

  return { longTerm, shortTerm }
}

function calcFailHistory(series: TrendSeries[]): number {
  let totalPoints = 0
  let failPoints = 0
  let latestHasFail = false

  for (const s of series) {
    for (const p of s.points) {
      totalPoints++
      if (p.판정 === 'FAIL') failPoints++
    }
    const last = s.points[s.points.length - 1]
    if (last?.판정 === 'FAIL') latestHasFail = true
  }

  if (totalPoints === 0) return 70
  if (failPoints === 0) return 100

  const failRatio = failPoints / totalPoints
  let score = 100 - failRatio * 150
  if (latestHasFail) score -= 30

  return Math.max(0, Math.min(100, Math.round(score)))
}

function calcDataAvailability(series: TrendSeries[], certCount: number): number {
  const certScore = certCount >= 4 ? 100 : certCount === 3 ? 80 : certCount === 2 ? 60 : certCount === 1 ? 30 : 0

  let totalDataPoints = 0
  let validRatios = 0
  for (const s of series) {
    for (const p of s.points) {
      totalDataPoints++
      if (p.비율 != null) validRatios++
    }
  }
  const ratioScore = totalDataPoints > 0 ? (validRatios / totalDataPoints) * 100 : 0

  return Math.round(certScore * 0.6 + ratioScore * 0.4)
}

// ─── 건강점수 산출 ───

export function calculateHealthScore(series: TrendSeries[], certCount: number): HealthScore {
  const tp = calcToleranceProximity(series)
  const { longTerm, shortTerm } = calcStability(series)
  const fh = calcFailHistory(series)
  const da = calcDataAvailability(series, certCount)

  // 가중치: 허용오차여유 20% + 장기안정 15% + 단기안정 20% + 적합이력 30% + 데이터충분성 15%
  const total = Math.round(tp * 0.20 + longTerm * 0.15 + shortTerm * 0.20 + fh * 0.30 + da * 0.15)
  const grade = toGrade(total)

  return {
    total,
    grade,
    gradeLabel: GRADE_CONFIG[grade].label,
    components: {
      toleranceProximity: Math.round(tp),
      longTermStability: Math.round(longTerm),
      shortTermStability: Math.round(shortTerm),
      failHistory: Math.round(fh),
      dataAvailability: Math.round(da),
    },
  }
}

// ─── 주기별 시뮬레이션 ───

// toleranceProximity 점수 계산 (calcToleranceProximity와 동일 로직)
function ratioToTpScore(composite: number): number {
  if (composite <= 0) return 100
  if (composite <= 80) return 100 - (composite / 80) * 50
  if (composite <= 100) return 50 - ((composite - 80) / 20) * 30
  if (composite <= 120) return 20 - ((composite - 100) / 20) * 20
  return 0
}

// 특정 주기에서의 건강점수 시뮬레이션
function simulateHealthForCycle(
  baseScore: HealthScore,
  details: CyclePredictionDetail[],
  series: TrendSeries[],
  cycleMonths: number,
): CycleSimulationRow {
  const yearsAhead = cycleMonths / 12

  // 포인트별 연간 비율 변화율 계산
  const pointRates: { label: string; currentRatio: number; annualRate: number }[] = []
  for (const d of details) {
    if (d.usageRatio == null || d.slope <= 0) continue
    if (d.yearsToLimit != null && d.yearsToLimit > 0) {
      const annualRate = (100 - d.usageRatio) / d.yearsToLimit
      pointRates.push({ label: d.label, currentRatio: d.usageRatio, annualRate })
    }
  }

  // 같은 label이 여러 series에서 나오는지 검사 (CW/CCW 구분 필요 여부)
  const labelCount = new Map<string, number>()
  for (const s of series) labelCount.set(s.label, (labelCount.get(s.label) ?? 0) + 1)

  // series key에서 방향 접미사 추출 (예: "Torque Clockwise_1_N·m" → "CW")
  function directionSuffix(key: string): string {
    const kl = key.toLowerCase()
    if (kl.includes('counterclockwise') || kl.includes('ccw') || kl.includes('반시계')) return ' (CCW)'
    if (kl.includes('clockwise') || kl.includes('cw') || kl.includes('시계')) return ' (CW)'
    return ''
  }

  // 각 series의 주기 도래 시점 예상 비율 계산
  const predictedRatios: number[] = []
  const dangerPoints: { label: string; usageRatio: number }[] = []

  for (const s of series) {
    // 현재 비율 (최신 측정값)
    let currentRatio: number | null = null
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].비율 != null) {
        currentRatio = s.points[i].비율!
        break
      }
    }
    if (currentRatio == null) continue

    // 이 series에 해당하는 detail 찾기 (label 매칭)
    const detail = details.find(d => d.label === s.label)
    const rate = pointRates.find(pr => pr.label === s.label)
    const predicted = rate
      ? rate.currentRatio + rate.annualRate * yearsAhead
      : currentRatio  // 추세 없으면 현재값 유지

    predictedRatios.push(predicted)

    // 위험 포인트: 예상 소진율 > 80% 또는 yearsToLimit < 주기(년)
    const isDanger = predicted > 80 ||
      (detail?.yearsToLimit != null && detail.yearsToLimit > 0 && detail.yearsToLimit < yearsAhead)

    if (isDanger) {
      // 동일 label이 여러 개면 CW/CCW 접미사 추가
      const displayLabel = (labelCount.get(s.label) ?? 0) > 1
        ? s.label + directionSuffix(s.key)
        : s.label
      dangerPoints.push({ label: displayLabel, usageRatio: Math.round(predicted * 10) / 10 })
    }
  }

  // 예상 toleranceProximity 재계산
  let simulatedTp: number
  if (predictedRatios.length === 0) {
    simulatedTp = baseScore.components.toleranceProximity
  } else {
    const worst = Math.max(...predictedRatios)
    const avg = predictedRatios.reduce((a, b) => a + b, 0) / predictedRatios.length
    const composite = worst * 0.7 + avg * 0.3
    simulatedTp = ratioToTpScore(composite)
  }

  // 건강점수 재계산 (tp만 변경, 나머지 고정)
  const { longTermStability, shortTermStability, failHistory, dataAvailability } = baseScore.components
  const rawScore =
    simulatedTp * 0.20 +
    longTermStability * 0.15 +
    shortTermStability * 0.20 +
    failHistory * 0.30 +
    dataAvailability * 0.15
  const healthScore = Math.round(rawScore * 10) / 10  // 소수점 1자리
  const grade = toGrade(Math.round(rawScore))

  // 위험도순 정렬
  dangerPoints.sort((a, b) => b.usageRatio - a.usageRatio)

  // verdict: 위험 포인트 건수 기반 (점수보다 직관적)
  const verdict: CycleSimulationRow['verdict'] =
    dangerPoints.length === 0 ? 'safe' : dangerPoints.length <= 2 ? 'caution' : 'danger'

  return { cycleMonths, healthScore, grade, dangerCount: dangerPoints.length, dangerPoints, verdict }
}

function buildCycleSimulation(
  details: CyclePredictionDetail[],
  series: TrendSeries[],
  baseScore: HealthScore,
  recommended: number,
  currentCycle: number,
  direction: CyclePrediction['direction'],
): CycleSimulation {
  // 비교 주기 목록 생성 (direction별 최적화)
  const cycleSet = new Set<number>()
  if (direction === 'shorten') {
    cycleSet.add(recommended)
    cycleSet.add(currentCycle)
    cycleSet.add(currentCycle + 2)
  } else if (direction === 'extend') {
    cycleSet.add(currentCycle)
    cycleSet.add(recommended)
    cycleSet.add(recommended + 3)
  } else {
    cycleSet.add(Math.max(6, currentCycle - 2))
    cycleSet.add(currentCycle)
    cycleSet.add(currentCycle + 2)
  }
  const cycles = [...cycleSet].filter(c => c >= 6).sort((a, b) => a - b)

  // 시뮬레이션 행 생성
  const rows = cycles.map(c => simulateHealthForCycle(baseScore, details, series, c))

  // 최단 한계도달 포인트
  let shortestPoint: CycleSimulation['shortestPoint'] = null
  for (const d of details) {
    if (d.yearsToLimit != null && d.yearsToLimit > 0) {
      if (!shortestPoint || d.yearsToLimit < shortestPoint.yearsToLimit) {
        shortestPoint = { label: d.label, yearsToLimit: d.yearsToLimit }
      }
    }
  }

  // 상위 3개 위험 포인트
  const criticalDetails = [...details]
    .filter(d => d.usageRatio != null)
    .sort((a, b) => {
      if (a.significant !== b.significant) return a.significant ? -1 : 1
      return (b.usageRatio ?? 0) - (a.usageRatio ?? 0)
    })
    .slice(0, 3)
    .map(d => ({
      label: d.label,
      usageRatio: d.usageRatio,
      slope: d.slope,
      yearsToLimit: d.yearsToLimit,
      significant: d.significant,
    }))

  return { rows, shortestPoint, criticalDetails }
}

// ─── 교정주기 예측 ───

function parseYmd(s: string): Date | null {
  if (!s || s.length < 8) return null
  const clean = s.replace(/[^0-9]/g, '')
  const y = parseInt(clean.slice(0, 4))
  const m = parseInt(clean.slice(4, 6)) - 1
  const d = parseInt(clean.slice(6, 8))
  const date = new Date(y, m, d)
  return isNaN(date.getTime()) ? null : date
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function predictCalibrationCycle(
  series: TrendSeries[],
  calDates: string[],
  currentCycleMonths: number | null,
  certCount: number = 0,
): CyclePrediction {
  const currentCycle = currentCycleMonths ?? 12
  const emptyExtra = { currentRatio: null, regressionSlope: null, yearsTo80: null, yearsTo100: null, predictedDate100: null }

  if (calDates.length < 2) {
    return {
      recommendedCycleMonths: null, currentCycleMonths: currentCycle,
      direction: 'insufficient', directionLabel: '데이터 부족',
      reasoning: `교정 이력이 ${calDates.length}건으로 추세 분석이 어렵습니다. 2건 이상의 이력이 필요합니다.`,
      details: [], simulation: null, extrapolation: emptyExtra,
    }
  }

  const firstDate = parseYmd(calDates[0])
  if (!firstDate) {
    return {
      recommendedCycleMonths: null, currentCycleMonths: currentCycle,
      direction: 'insufficient', directionLabel: '데이터 부족',
      reasoning: '교정일 형식을 인식할 수 없습니다.',
      details: [], simulation: null, extrapolation: emptyExtra,
    }
  }

  // ── 포인트별 상세 분석 (details) ──
  const yearLabels = calDates.map(d => {
    const pd = parseYmd(d)
    return pd ? String(pd.getFullYear()) : d.slice(0, 4)
  })

  const details: CyclePredictionDetail[] = []
  for (const s of series) {
    const absErrors = s.points
      .map(p => p.오차 != null ? Math.abs(p.오차) : null)

    const validPairs: { year: string; error: number }[] = []
    for (let i = 0; i < absErrors.length; i++) {
      if (absErrors[i] != null) validPairs.push({ year: yearLabels[i] ?? `#${i + 1}`, error: absErrors[i]! })
    }

    if (validPairs.length >= 3) {
      const errors = validPairs.map(p => p.error)
      const { slope, pValue } = slopeSignificance(errors)

      // usageRatio / yearsToLimit 계산
      const lastPt = s.points.findLast(p => p.오차 != null)
      const latestErr = lastPt?.오차 != null ? Math.abs(lastPt.오차) : null
      const tol = lastPt?.허용오차 != null ? Math.abs(lastPt.허용오차) : null
      const usageRatio = latestErr != null && tol != null && tol > 0
        ? Math.round((latestErr / tol) * 1000) / 10
        : null
      const absSlope = Math.abs(slope)
      let yearsToLimit: number | null = null
      if (absSlope > 0 && latestErr != null && tol != null && latestErr < tol) {
        yearsToLimit = Math.round(((tol - latestErr) / absSlope) * 10) / 10
      }

      details.push({
        label: s.label,
        recentYears: validPairs.map(p => p.year),
        recentErrors: errors,
        slope: Math.round(slope * 10000) / 10000,
        pValue,
        significant: pValue < 0.05,
        usageRatio,
        yearsToLimit,
      })
    }
  }

  // ── worst-case 비율 기반 회귀 (보조 지표, 없어도 주기 결정 가능) ──
  const timeRatios: { t: number; ratio: number }[] = []
  for (let ci = 0; ci < calDates.length; ci++) {
    const date = parseYmd(calDates[ci])
    if (!date) continue
    const t = (date.getTime() - firstDate.getTime()) / (365.25 * 86400000)

    let maxRatio = -Infinity
    for (const s of series) {
      const r = s.points[ci]?.비율
      if (r != null && r > maxRatio) maxRatio = r
    }
    if (maxRatio > -Infinity) timeRatios.push({ t, ratio: maxRatio })
  }

  // 비율 회귀 계산 (가능한 경우에만)
  let ratioSlope = 0
  let currentRatio: number | null = null
  let yearsTo80: number | null = null
  let yearsTo100: number | null = null
  let predictedDate100: string | null = null

  if (timeRatios.length >= 2) {
    const n = timeRatios.length
    const sumT = timeRatios.reduce((s, p) => s + p.t, 0)
    const sumR = timeRatios.reduce((s, p) => s + p.ratio, 0)
    const sumTR = timeRatios.reduce((s, p) => s + p.t * p.ratio, 0)
    const sumT2 = timeRatios.reduce((s, p) => s + p.t * p.t, 0)
    const denom = n * sumT2 - sumT * sumT

    if (Math.abs(denom) > 1e-10) {
      ratioSlope = (n * sumTR - sumT * sumR) / denom
      currentRatio = timeRatios[n - 1].ratio
      const intercept = (sumR - ratioSlope * sumT) / n
      const latestT = timeRatios[n - 1].t

      if (ratioSlope > 0.1) {
        if (currentRatio < 80) {
          const t80 = (80 - intercept) / ratioSlope - latestT
          if (t80 > 0) yearsTo80 = t80
        }
        if (currentRatio < 100) {
          const t100 = (100 - intercept) / ratioSlope - latestT
          if (t100 > 0) {
            yearsTo100 = t100
            const latestDate = parseYmd(calDates[calDates.length - 1])
            if (latestDate) {
              const pred = new Date(latestDate.getTime() + t100 * 365.25 * 86400000)
              predictedDate100 = formatYmd(pred)
            }
          }
        }
      }
    }
  }

  // details도 비율도 없으면 진짜 데이터 부족
  if (details.length === 0 && timeRatios.length < 2) {
    return {
      recommendedCycleMonths: null, currentCycleMonths: currentCycle,
      direction: 'insufficient', directionLabel: '데이터 부족',
      reasoning: '측정 데이터가 부족하여 추세 분석이 어렵습니다.',
      details, simulation: null, extrapolation: emptyExtra,
    }
  }

  // ── 유의미 포인트 판별 + 위험도 판단 ──
  const significantDetails = details.filter(d => d.significant)
  const sigCount = significantDetails.length
  const sigRatio = details.length > 0 ? sigCount / details.length : 0
  const hasRatio = currentRatio != null

  // 위험도 판단: 유의미 포인트 중 한계 도달이 가까운 것이 있는가?
  const urgentPoints = significantDetails.filter(d =>
    (d.yearsToLimit != null && d.yearsToLimit < 3) ||  // 3년 이내 한계 도달
    (d.usageRatio != null && d.usageRatio > 80)        // 이미 80% 이상 사용
  )

  // ── 주기 결정 (포인트별 t-검정 + 위험도 종합) ──
  let recommended: number
  let direction: CyclePrediction['direction']

  if (sigCount === 0 && details.length > 0) {
    // 모든 포인트 안정
    if (hasRatio && currentRatio! < 40) {
      recommended = Math.min(24, Math.round(currentCycle * 1.2))
      direction = 'extend'
    } else {
      recommended = currentCycle
      direction = 'maintain'
    }
  } else if (sigRatio >= 0.5) {
    // 과반 이상 포인트에서 유의미 → 단축
    if (urgentPoints.length > 0) {
      recommended = Math.max(6, Math.round(currentCycle * 0.7))
    } else {
      recommended = Math.max(6, Math.round(currentCycle * 0.85))
    }
    direction = 'shorten'
  } else if (sigCount > 0 && urgentPoints.length > 0) {
    // 소수 포인트이지만 한계 근접 → 단축
    recommended = Math.max(6, Math.round(currentCycle * 0.85))
    direction = 'shorten'
  } else if (sigCount > 0) {
    // 소수 포인트, 여유 충분 → 주의 관찰하며 유지
    recommended = currentCycle
    direction = 'maintain'
  } else {
    recommended = currentCycle
    direction = 'maintain'
  }

  // ── 구체적 reasoning 생성 ──
  const reasonParts: string[] = []

  // 1줄 요약
  if (direction === 'shorten') {
    const pct = Math.round((1 - recommended / currentCycle) * 100)
    reasonParts.push(`${calDates.length}회 교정 이력 분석 결과, ${currentCycle}개월 → ${recommended}개월(${pct}% 단축)을 권고합니다.`)
  } else if (direction === 'extend') {
    reasonParts.push(`${calDates.length}회 교정 이력 분석 결과, ${recommended}개월로 연장 검토가 가능합니다.`)
  } else if (direction === 'maintain') {
    reasonParts.push(`${calDates.length}회 교정 이력 분석 결과, 현행 ${currentCycle}개월 유지를 권고합니다.`)
  }

  // 유의미한 변화 포인트 상세
  if (sigCount > 0) {
    const pointDescs = significantDetails.slice(0, 3).map(a => {
      const dir = a.slope > 0 ? '증가' : '감소'
      let desc = `${a.label}(p=${a.pValue < 0.01 ? '<0.01' : a.pValue.toFixed(2)}, ${dir}`
      if (a.usageRatio != null) desc += `, 허용대비 ${a.usageRatio}%`
      desc += ')'
      return desc
    })
    const extra = sigCount > 3 ? ` 외 ${sigCount - 3}건` : ''
    reasonParts.push(`${details.length}개 중 ${sigCount}개 포인트에서 유의미한 변화: ${pointDescs.join(', ')}${extra}.`)

    // 왜 유지/단축인지 설명
    if (direction === 'maintain' && sigCount > 0) {
      const reasons: string[] = []
      if (sigCount < details.length * 0.5) reasons.push(`변화 포인트가 소수(${sigCount}/${details.length})`)
      const safePoints = significantDetails.filter(a => a.yearsToLimit == null || a.yearsToLimit >= 3)
      if (safePoints.length === significantDetails.length) {
        const minYears = significantDetails.reduce((min, a) => a.yearsToLimit != null && a.yearsToLimit < min ? a.yearsToLimit : min, Infinity)
        if (minYears < Infinity) {
          reasons.push(`현 추세로도 허용한계 도달까지 약 ${minYears}년 여유`)
        } else {
          reasons.push(`허용한계까지 충분한 여유`)
        }
      }
      if (reasons.length > 0) {
        reasonParts.push(`다만 ${reasons.join(', ')}이므로 현행 주기를 유지하되 해당 포인트를 주시할 것을 권고합니다.`)
      }
    } else if (direction === 'shorten') {
      if (urgentPoints.length > 0) {
        const urgDesc = urgentPoints.map(a => {
          if (a.yearsToLimit != null) return `${a.label}: 약 ${a.yearsToLimit}년 내 한계 도달 예상`
          if (a.usageRatio != null) return `${a.label}: 허용오차의 ${a.usageRatio}% 사용`
          return a.label
        })
        reasonParts.push(`주의 필요: ${urgDesc.join(', ')}.`)
      }
    }
  } else if (details.length > 0) {
    reasonParts.push(`${details.length}개 측정포인트 모두 통계적으로 유의미한 추세 없음 (p≥0.05).`)
  }

  // 비율 정보 (있는 경우에만)
  if (hasRatio) {
    reasonParts.push(`현재 최대 허용오차 비율 ${currentRatio!.toFixed(1)}%, 연간 변화량 ${ratioSlope > 0 ? '+' : ''}${ratioSlope.toFixed(2)}%p/년.`)
  }

  if (yearsTo100 != null && ratioSlope > 0) {
    reasonParts.push(`현 추세 유지 시 약 ${yearsTo100.toFixed(1)}년 후 허용오차 100% 도달 예상 (${predictedDate100}).`)
  }

  const reasoning = reasonParts.join('\n')

  // ── 시뮬레이션 계산 ──
  const baseScore = calculateHealthScore(series, certCount)
  const simulation = buildCycleSimulation(details, series, baseScore, recommended, currentCycle, direction)

  return {
    recommendedCycleMonths: recommended,
    currentCycleMonths: currentCycle,
    direction,
    directionLabel: direction === 'shorten' ? '단축 권고' : direction === 'extend' ? '연장 가능' : '현행 유지',
    reasoning,
    details,
    simulation,
    extrapolation: {
      currentRatio,
      regressionSlope: Math.round(ratioSlope * 100) / 100,
      yearsTo80, yearsTo100, predictedDate100,
    },
  }
}

// ─── 처방 생성 ───

export function generatePrescriptions(
  score: HealthScore,
  prediction: CyclePrediction,
  series: TrendSeries[],
  certCount: number,
): Prescription[] {
  const rx: Prescription[] = []

  // 1. 교정주기 권고
  if (prediction.direction === 'shorten') {
    rx.push({
      priority: 'high', category: 'cycle', categoryLabel: '교정주기',
      title: `교정주기 ${prediction.currentCycleMonths}개월 → ${prediction.recommendedCycleMonths}개월 단축 권고`,
      description: prediction.reasoning,
    })
  } else if (prediction.direction === 'extend') {
    rx.push({
      priority: 'low', category: 'cycle', categoryLabel: '교정주기',
      title: `교정주기 ${prediction.recommendedCycleMonths}개월로 연장 검토 가능`,
      description: prediction.reasoning,
    })
  } else if (prediction.direction === 'maintain') {
    rx.push({
      priority: 'low', category: 'cycle', categoryLabel: '교정주기',
      title: `현행 ${prediction.currentCycleMonths}개월 교정주기 적정`,
      description: prediction.reasoning,
    })
  }

  // 2. FAIL 이력 대응
  const failSeries = series.filter(s => s.points.some(p => p.판정 === 'FAIL'))
  if (failSeries.length > 0) {
    const latestFail = failSeries.some(s => s.points[s.points.length - 1]?.판정 === 'FAIL')
    rx.push({
      priority: latestFail ? 'high' : 'medium',
      category: latestFail ? 'replacement' : 'focus',
      categoryLabel: latestFail ? '장비 점검' : '이력 관리',
      title: latestFail ? '최근 교정에서 부적합 판정 — 장비 점검/교체 검토' : `과거 부적합 이력 ${failSeries.length}개 포인트`,
      description: latestFail
        ? '장비의 물리적 상태를 점검하고 수리 또는 교체를 검토하세요. 측정 불확도와 환경 조건도 함께 확인이 필요합니다.'
        : `과거 FAIL 이력이 있었으나 최근에는 PASS 판정입니다. ${failSeries.map(s => s.label).join(', ')} 포인트를 지속 모니터링하세요.`,
    })
  }

  // 3. 위험 측정포인트 집중 관리
  const riskSeries = series.filter(s => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].비율 != null) return s.points[i].비율! > 70
    }
    return false
  })
  if (riskSeries.length > 0) {
    const points = riskSeries.map(s => {
      const r = [...s.points].reverse().find(p => p.비율 != null)!.비율!
      return `${s.label} (${r.toFixed(1)}%)`
    })
    rx.push({
      priority: riskSeries.some(s => ([...s.points].reverse().find(p => p.비율 != null)?.비율 ?? 0) > 90) ? 'high' : 'medium',
      category: 'focus', categoryLabel: '집중 관리',
      title: `${riskSeries.length}개 측정포인트 집중 모니터링 필요`,
      description: `허용오차 대비 70% 이상: ${points.join(', ')}. 다음 교정 시 해당 포인트의 측정 환경과 장비 상태를 특별히 점검하세요.`,
    })
  }

  // 4. 오차 연속 증가
  const increasingSeries = series.filter(s => {
    const abs = s.points.map(p => p.오차).filter((v): v is number => v != null).map(Math.abs)
    if (abs.length < 3) return false
    return abs.every((v, i) => i === 0 || v >= abs[i - 1])
  })
  if (increasingSeries.length > 0 && failSeries.length === 0) {
    rx.push({
      priority: 'medium', category: 'focus', categoryLabel: '추세 관찰',
      title: `${increasingSeries.length}개 포인트 오차 연속 증가`,
      description: `${increasingSeries.map(s => s.label).join(', ')} 포인트에서 교정 회차마다 오차가 증가하고 있습니다. 장비 노후화 또는 환경 변화 가능성을 점검하세요.`,
    })
  }

  // 5. 데이터 부족
  if (certCount < 3) {
    rx.push({
      priority: certCount < 2 ? 'medium' : 'low',
      category: 'data', categoryLabel: '데이터',
      title: `교정 이력 ${certCount}건 — 분석 정확도 제한`,
      description: `3건 이상의 이력이 축적되면 추세 분석과 주기 예측의 정확도가 크게 향상됩니다.`,
    })
  }

  // 6. 상태 우수
  if (score.total >= 85 && rx.every(p => p.priority !== 'high')) {
    rx.push({
      priority: 'low', category: 'general', categoryLabel: '종합',
      title: '장비 상태 우수',
      description: `종합 건강점수 ${score.total}점(${score.gradeLabel})으로 전반적으로 양호합니다. 현재 관리 체계를 유지하세요.`,
    })
  }

  // 정렬
  const order = { high: 0, medium: 1, low: 2 }
  rx.sort((a, b) => order[a.priority] - order[b.priority])

  return rx
}

// ─── 메인 진입 ───

export function analyzeEquipmentHealth(
  series: TrendSeries[],
  calDates: string[],
  certCount: number,
  affcCyclCd: string | null,
): HealthCheckResult {
  const score = calculateHealthScore(series, certCount)
  const currentCycleMonths = affcCyclCd ? parseInt(affcCyclCd) || null : null
  const prediction = predictCalibrationCycle(series, calDates, currentCycleMonths, certCount)
  const prescriptions = generatePrescriptions(score, prediction, series, certCount)

  return {
    score,
    prediction,
    prescriptions,
    dataPoints: series.reduce((sum, s) => sum + s.points.length, 0),
    seriesCount: series.length,
  }
}

// ─── LLM 입력용 요약 데이터 빌더 ───

export interface HealthReasoningInput {
  currentCycle: number
  recommended: number | null
  direction: CyclePrediction['direction']
  totalPoints: number
  details: Array<{
    label: string
    slope: number
    pValue: number
    significant: boolean
    usageRatio: number | null
    yearsToLimit: number | null
  }>
  currentRatio: number | null
  ratioSlope: number | null
  certCount: number
  healthGrade: string
  healthTotal: number
  components: HealthScore['components']
}

export function buildHealthReasoningInput(result: HealthCheckResult): HealthReasoningInput {
  const { prediction, score } = result
  return {
    currentCycle: prediction.currentCycleMonths ?? 12,
    recommended: prediction.recommendedCycleMonths,
    direction: prediction.direction,
    totalPoints: prediction.details.length,
    details: prediction.details.map(d => ({
      label: d.label,
      slope: d.slope,
      pValue: d.pValue,
      significant: d.significant,
      usageRatio: d.usageRatio,
      yearsToLimit: d.yearsToLimit,
    })),
    currentRatio: prediction.extrapolation.currentRatio,
    ratioSlope: prediction.extrapolation.regressionSlope,
    certCount: result.dataPoints > 0 && result.seriesCount > 0
      ? Math.ceil(result.dataPoints / result.seriesCount)
      : 0,
    healthGrade: score.grade,
    healthTotal: score.total,
    components: score.components,
  }
}

// ─── AI 교정 지시서 ───

export type InstructionLevel = 'precision' | 'standard' | 'observation'

export interface PointInstruction {
  label: string
  level: InstructionLevel
  levelLabel: string
  priority: 'high' | 'medium' | 'low'
  instruction: string
  evidence: string[]
}

export interface CalibrationInstruction {
  points: PointInstruction[]
  schedule: { label: string; timing: string; reason: string }[]
  environmentNotes: string[]
}

// 규칙 기반 교정 지시서 생성 (즉시 표시용)
export function generateCalibrationInstruction(result: HealthCheckResult): CalibrationInstruction {
  const { prediction } = result
  const currentCycleYears = (prediction.currentCycleMonths ?? 12) / 12

  const points: PointInstruction[] = prediction.details.map(d => {
    // 분류
    let level: InstructionLevel
    let priority: 'high' | 'medium' | 'low'

    if (d.significant && (d.usageRatio != null && d.usageRatio > 70 || d.yearsToLimit != null && d.yearsToLimit < 3)) {
      level = 'precision'
      priority = 'high'
    } else if (d.significant || (d.usageRatio != null && d.usageRatio > 50)) {
      level = 'standard'
      priority = 'medium'
    } else {
      level = 'observation'
      priority = 'low'
    }

    const levelLabels: Record<InstructionLevel, string> = {
      precision: '정밀교정',
      standard: '표준교정',
      observation: '관찰',
    }

    // 규칙 기반 지시
    let instruction: string
    if (level === 'precision') {
      instruction = `${d.label} 포인트 정밀 교정 실시. 반복 측정 3회, 상승·하강 양방향 측정 권장.`
    } else if (level === 'standard') {
      instruction = `${d.label} 포인트 표준 교정 절차 수행.`
    } else {
      instruction = `${d.label} 포인트 기본 확인. 특별 조치 불필요.`
    }

    // 규칙 기반 근거
    const evidence: string[] = []
    if (d.significant) {
      const dir = d.slope > 0 ? '증가' : '감소'
      evidence.push(`오차 ${dir} 추세 (기울기 ${d.slope > 0 ? '+' : ''}${d.slope.toFixed(3)}/년, p=${d.pValue.toFixed(3)})`)
    } else {
      evidence.push(`통계적으로 유의미한 변화 없음 (p=${d.pValue.toFixed(3)})`)
    }
    if (d.usageRatio != null) {
      evidence.push(`허용오차 대비 ${d.usageRatio.toFixed(1)}% 사용`)
    }
    if (d.yearsToLimit != null) {
      evidence.push(`현 추세로 약 ${d.yearsToLimit.toFixed(1)}년 후 한계 도달 예상`)
    }

    return { label: d.label, level, levelLabel: levelLabels[level], priority, instruction, evidence }
  })

  // 재점검 스케줄: yearsToLimit < currentCycle*2인 포인트
  const schedule = prediction.details
    .filter(d => d.yearsToLimit != null && d.yearsToLimit < currentCycleYears * 2)
    .map(d => {
      const halfCycle = Math.round((prediction.currentCycleMonths ?? 12) / 2)
      return {
        label: d.label,
        timing: `${halfCycle}개월 후 중간점검`,
        reason: `한계 도달 예상 ${d.yearsToLimit!.toFixed(1)}년 (교정주기 ${(d.yearsToLimit! / currentCycleYears).toFixed(1)}회분)`,
      }
    })

  // 환경 주의사항 (규칙 기반 기본)
  const environmentNotes: string[] = []
  if (result.score.total < 55) {
    environmentNotes.push('교정 환경(온도, 습도) 재확인 필요')
  }
  const hasFail = prediction.details.some(d => d.recentErrors.length > 0 && d.usageRatio != null && d.usageRatio > 90)
  if (hasFail) {
    environmentNotes.push('측정 불확도 재검증 권장')
  }

  // priority 순서로 정렬 (high → medium → low)
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  points.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return { points, schedule, environmentNotes }
}

// LLM 입력용 교정 지시서 데이터 빌더
export interface CalibrationInstructionInput {
  equipmentName: string
  manufacturer: string
  model: string
  currentCycleMonths: number
  direction: CyclePrediction['direction']
  healthGrade: string
  healthTotal: number
  quantityLabel?: string  // 물리량 탭 라벨 (예: "Torque Clockwise")
  details: Array<{
    label: string
    recentYears: string[]
    recentErrors: number[]
    slope: number
    pValue: number
    significant: boolean
    usageRatio: number | null
    yearsToLimit: number | null
  }>
}

export function buildCalibrationInstructionInput(
  result: HealthCheckResult,
  meta: { equipmentName: string; manufacturer: string; model: string },
): CalibrationInstructionInput {
  const { prediction, score } = result
  // significant 우선 정렬, 최대 10개
  const sorted = [...prediction.details].sort((a, b) => {
    if (a.significant !== b.significant) return a.significant ? -1 : 1
    return (b.usageRatio ?? 0) - (a.usageRatio ?? 0)
  })
  const details = sorted.slice(0, 10).map(d => ({
    label: d.label,
    recentYears: d.recentYears,
    recentErrors: d.recentErrors,
    slope: d.slope,
    pValue: d.pValue,
    significant: d.significant,
    usageRatio: d.usageRatio,
    yearsToLimit: d.yearsToLimit,
  }))

  return {
    equipmentName: meta.equipmentName,
    manufacturer: meta.manufacturer,
    model: meta.model,
    currentCycleMonths: prediction.currentCycleMonths ?? 12,
    direction: prediction.direction,
    healthGrade: score.grade,
    healthTotal: score.total,
    details,
  }
}
