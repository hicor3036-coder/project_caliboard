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
    trendDirection: number
    failHistory: number
    dataAvailability: number
  }
}

export interface CyclePrediction {
  recommendedCycleMonths: number | null
  currentCycleMonths: number | null
  direction: 'shorten' | 'maintain' | 'extend' | 'insufficient'
  directionLabel: string
  reasoning: string
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

function calcTrendDirection(series: TrendSeries[]): number {
  let totalScore = 0
  let count = 0

  for (const s of series) {
    const absErrors = s.points
      .map(p => p.오차 != null ? Math.abs(p.오차) : null)
      .filter((v): v is number => v != null)

    if (absErrors.length < 2) continue
    count++

    const first = absErrors[0] || 0.001
    const change = (absErrors[absErrors.length - 1] - absErrors[0]) / first

    let score: number
    if (change <= -0.2) score = 100
    else if (change <= 0) score = 80 + (-change / 0.2) * 20
    else if (change <= 0.2) score = 80 - (change / 0.2) * 40
    else if (change <= 0.5) score = 40 - ((change - 0.2) / 0.3) * 30
    else if (change <= 1.0) score = 10 - ((change - 0.5) / 0.5) * 10
    else score = 0

    totalScore += Math.max(0, Math.min(100, score))
  }

  return count > 0 ? Math.round(totalScore / count) : 60
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
  const td = calcTrendDirection(series)
  const fh = calcFailHistory(series)
  const da = calcDataAvailability(series, certCount)

  const total = Math.round(tp * 0.25 + td * 0.25 + fh * 0.30 + da * 0.20)
  const grade = toGrade(total)

  return {
    total,
    grade,
    gradeLabel: GRADE_CONFIG[grade].label,
    components: {
      toleranceProximity: Math.round(tp),
      trendDirection: Math.round(td),
      failHistory: Math.round(fh),
      dataAvailability: Math.round(da),
    },
  }
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
): CyclePrediction {
  const currentCycle = currentCycleMonths ?? 12

  if (calDates.length < 2) {
    return {
      recommendedCycleMonths: null,
      currentCycleMonths: currentCycle,
      direction: 'insufficient',
      directionLabel: '데이터 부족',
      reasoning: `교정 이력이 ${calDates.length}건으로 추세 분석이 어렵습니다. 2건 이상의 이력이 필요합니다.`,
      extrapolation: { currentRatio: null, regressionSlope: null, yearsTo80: null, yearsTo100: null, predictedDate100: null },
    }
  }

  // 시간축(연수) 변환
  const firstDate = parseYmd(calDates[0])
  if (!firstDate) {
    return {
      recommendedCycleMonths: null, currentCycleMonths: currentCycle,
      direction: 'insufficient', directionLabel: '데이터 부족',
      reasoning: '교정일 형식을 인식할 수 없습니다.',
      extrapolation: { currentRatio: null, regressionSlope: null, yearsTo80: null, yearsTo100: null, predictedDate100: null },
    }
  }

  // 각 시점에서 worst-case 비율 추출
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

  if (timeRatios.length < 2) {
    return {
      recommendedCycleMonths: null, currentCycleMonths: currentCycle,
      direction: 'insufficient', directionLabel: '데이터 부족',
      reasoning: '비율 데이터가 부족하여 추세 분석이 어렵습니다.',
      extrapolation: { currentRatio: null, regressionSlope: null, yearsTo80: null, yearsTo100: null, predictedDate100: null },
    }
  }

  // 단순 선형 회귀
  const n = timeRatios.length
  const sumT = timeRatios.reduce((s, p) => s + p.t, 0)
  const sumR = timeRatios.reduce((s, p) => s + p.ratio, 0)
  const sumTR = timeRatios.reduce((s, p) => s + p.t * p.ratio, 0)
  const sumT2 = timeRatios.reduce((s, p) => s + p.t * p.t, 0)

  const denom = n * sumT2 - sumT * sumT
  if (Math.abs(denom) < 1e-10) {
    return {
      recommendedCycleMonths: currentCycle, currentCycleMonths: currentCycle,
      direction: 'maintain', directionLabel: '현행 유지',
      reasoning: '데이터가 동일 시점에 집중되어 추세 판단이 어렵습니다. 현행 유지를 권고합니다.',
      extrapolation: { currentRatio: timeRatios[n - 1].ratio, regressionSlope: 0, yearsTo80: null, yearsTo100: null, predictedDate100: null },
    }
  }

  const slope = (n * sumTR - sumT * sumR) / denom  // %p / year
  const intercept = (sumR - slope * sumT) / n
  const currentRatio = timeRatios[n - 1].ratio
  const latestT = timeRatios[n - 1].t

  // 80%/100% 도달 예측
  let yearsTo80: number | null = null
  let yearsTo100: number | null = null
  let predictedDate100: string | null = null

  if (slope > 0.1) {
    if (currentRatio < 80) {
      const t80 = (80 - intercept) / slope - latestT
      if (t80 > 0) yearsTo80 = t80
    }
    if (currentRatio < 100) {
      const t100 = (100 - intercept) / slope - latestT
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

  // 주기 결정
  let recommended: number
  let direction: CyclePrediction['direction']
  let reasoning: string

  if (slope > 5) {
    recommended = Math.max(6, Math.round(currentCycle * 0.7))
    direction = 'shorten'
    reasoning = `오차 비율이 연간 ${slope.toFixed(1)}%p 증가 추세입니다. ${currentCycle}개월 → ${recommended}개월 단축을 권고합니다.`
    if (yearsTo100 != null) reasoning += ` 현 추세 시 약 ${yearsTo100.toFixed(1)}년 후 허용오차 도달 예상.`
  } else if (slope > 2) {
    if (currentRatio > 70) {
      recommended = Math.max(6, Math.round(currentCycle * 0.85))
      direction = 'shorten'
      reasoning = `현재 비율 ${currentRatio.toFixed(1)}%이며 완만한 증가 추세(연 ${slope.toFixed(1)}%p). ${recommended}개월로 소폭 단축을 권고합니다.`
    } else {
      recommended = currentCycle
      direction = 'maintain'
      reasoning = `완만한 증가 추세이나 현재 비율 ${currentRatio.toFixed(1)}%로 여유가 있어 현행 유지 가능합니다.`
    }
  } else if (slope > -1) {
    if (currentRatio < 40) {
      recommended = Math.min(24, Math.round(currentCycle * 1.2))
      direction = 'extend'
      reasoning = `오차가 안정적이고 비율 ${currentRatio.toFixed(1)}%로 여유가 있어 ${recommended}개월로 연장 가능합니다.`
    } else {
      recommended = currentCycle
      direction = 'maintain'
      reasoning = `오차 추세가 안정적입니다. 현행 ${currentCycle}개월 유지를 권고합니다.`
    }
  } else {
    if (currentRatio < 50) {
      recommended = Math.min(24, Math.round(currentCycle * 1.3))
      direction = 'extend'
      reasoning = `오차 개선 추세(연 ${Math.abs(slope).toFixed(1)}%p 감소)이며 비율 ${currentRatio.toFixed(1)}%. ${recommended}개월로 연장 검토 가능합니다.`
    } else {
      recommended = currentCycle
      direction = 'maintain'
      reasoning = `개선 추세이지만 현재 비율 ${currentRatio.toFixed(1)}%이므로 현행 유지를 권고합니다.`
    }
  }

  return {
    recommendedCycleMonths: recommended,
    currentCycleMonths: currentCycle,
    direction,
    directionLabel: direction === 'shorten' ? '단축 권고' : direction === 'extend' ? '연장 가능' : '현행 유지',
    reasoning,
    extrapolation: { currentRatio, regressionSlope: Math.round(slope * 100) / 100, yearsTo80, yearsTo100, predictedDate100 },
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
  const prediction = predictCalibrationCycle(series, calDates, currentCycleMonths)
  const prescriptions = generatePrescriptions(score, prediction, series, certCount)

  return {
    score,
    prediction,
    prescriptions,
    dataPoints: series.reduce((sum, s) => sum + s.points.length, 0),
    seriesCount: series.length,
  }
}
