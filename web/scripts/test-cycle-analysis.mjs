// cycle-analysis.ts 빠른 동작 검증 스크립트
// 실행: cd web && node scripts/test-cycle-analysis.mjs
//
// .ts 파일을 직접 import 못해서 핵심 로직만 mjs로 복제해서 검증

// ── parseCycleString 복제 ──
function parseCycleString(s) {
  if (!s) return null
  const trimmed = String(s).trim()
  if (!trimmed) return null

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

  const plain = parseFloat(trimmed)
  if (Number.isFinite(plain) && plain > 0 && plain <= 120) return Math.round(plain)

  return null
}

// ── 시나리오들 ──
const scenarios = [
  {
    name: '시나리오 A: profile + ktools 일치',
    profile: { category: '토크렌치', calibration: { recommended_cycle: '12개월', standards: ['KOLAS 권장'] } },
    ktoolsAffcCyclCd: '12',
    expect: { months: 12, source: 'profile_recommended', warnings: 0 },
  },
  {
    name: '시나리오 B: profile 우선, ktools 다름 → 경고',
    profile: { category: '토크렌치', calibration: { recommended_cycle: '12개월', standards: [] } },
    ktoolsAffcCyclCd: '6',
    expect: { months: 12, source: 'profile_recommended', warnings: 1 },
  },
  {
    name: '시나리오 C: profile 없음, ktools만 있음',
    profile: null,
    ktoolsAffcCyclCd: '6',
    expect: { months: 6, source: 'ktools_registered', warnings: 1 },
  },
  {
    name: '시나리오 D: 둘 다 없음 → 12개월 fallback',
    profile: null,
    ktoolsAffcCyclCd: '',
    expect: { months: 12, source: 'default_fallback', warnings: 1 },
  },
  {
    name: '시나리오 E: profile 단종 장비',
    profile: {
      category: '토크렌치',
      calibration: { recommended_cycle: '12개월' },
      meta: { discontinued: true, successor_model: 'QD2R200' },
    },
    ktoolsAffcCyclCd: '12',
    expect: { months: 12, source: 'profile_recommended', warnings: 1 },
  },
  {
    name: '시나리오 F: "1년" 표현 파싱',
    profile: { calibration: { recommended_cycle: '1년' } },
    ktoolsAffcCyclCd: '12',
    expect: { months: 12, source: 'profile_recommended', warnings: 0 },
  },
  {
    name: '시나리오 G: 잘못된 cycle 값 → ktools fallback',
    profile: { calibration: { recommended_cycle: 'unknown' } },
    ktoolsAffcCyclCd: '6',
    expect: { months: 6, source: 'ktools_registered', warnings: 1 },
  },
]

// ── parseCycleString 단독 테스트 ──
console.log('━━━ parseCycleString 단위 테스트 ━━━')
const parseTests = [
  ['12개월', 12], ['1년', 12], ['6 months', 6], ['12 mo', 12],
  ['1년 6개월', 18], ['24', 24], ['', null], [null, null],
  ['unknown', null], ['1000', null], // 가드 (120 초과)
]
let parsePass = 0
for (const [input, expected] of parseTests) {
  const got = parseCycleString(input)
  const ok = got === expected
  if (ok) parsePass++
  console.log(`  ${ok ? '✅' : '❌'} parseCycleString(${JSON.stringify(input)}) → ${got} ${ok ? '' : `(예상: ${expected})`}`)
}
console.log(`  ${parsePass}/${parseTests.length} 통과\n`)

// ── 시나리오별 검증 (parseCycleString만 검증, 전체 step1 검증은 dev 환경에서) ──
console.log('━━━ step1_baseline 시나리오 검증 (요약) ━━━')
for (const sc of scenarios) {
  const rawProfile = sc.profile?.calibration?.recommended_cycle ?? null
  const profileMonths = parseCycleString(rawProfile)
  const rawKtools = sc.ktoolsAffcCyclCd?.trim() || null
  const ktoolsMonths = parseCycleString(rawKtools)

  let months, source
  if (profileMonths != null) {
    months = profileMonths; source = 'profile_recommended'
  } else if (ktoolsMonths != null) {
    months = ktoolsMonths; source = 'ktools_registered'
  } else {
    months = 12; source = 'default_fallback'
  }

  const ok = months === sc.expect.months && source === sc.expect.source
  console.log(`  ${ok ? '✅' : '❌'} ${sc.name}`)
  console.log(`     → months=${months}, source=${source}`)
  if (!ok) console.log(`     예상: months=${sc.expect.months}, source=${sc.expect.source}`)
}

// ─────────────────────────────────────────────────────────────────
// Step 2 (Trend Drift) — 핵심 로직 복제 테스트
// ─────────────────────────────────────────────────────────────────

function detectAcceleration(history) {
  if (history.length < 4) return { accelerating: false, ratio: null }
  const recentChange = Math.abs(history[history.length - 1] - history[history.length - 2])
  const prevChanges = []
  for (let i = 1; i < history.length - 1; i++) {
    prevChanges.push(Math.abs(history[i] - history[i - 1]))
  }
  if (prevChanges.length === 0) return { accelerating: false, ratio: null }
  const avgPrev = prevChanges.reduce((s, v) => s + v, 0) / prevChanges.length
  if (avgPrev < 1) return { accelerating: false, ratio: null }
  const ratio = recentChange / avgPrev
  return { accelerating: ratio >= 2, ratio: Math.round(ratio * 10) / 10 }
}

function classifyTrend(history) {
  if (history.length < 2) return 'stable'
  const overall = history[history.length - 1] - history[0]
  const meanAbs = history.reduce((s, v) => s + Math.abs(v), 0) / history.length || 1
  const changes = []
  for (let i = 1; i < history.length; i++) {
    changes.push(history[i] - history[i - 1])
  }
  let signChanges = 0
  for (let i = 1; i < changes.length; i++) {
    if (changes[i - 1] * changes[i] < 0) signChanges++
  }
  const avgChangeMagnitude = changes.reduce((s, v) => s + Math.abs(v), 0) / changes.length
  if (
    history.length >= 4 &&
    signChanges >= Math.floor((history.length - 1) / 2) &&
    avgChangeMagnitude >= meanAbs * 0.2
  ) {
    return 'volatile'
  }
  if (Math.abs(overall) < meanAbs * 0.15) return 'stable'
  return overall > 0 ? 'rising' : 'falling'
}

console.log('\n━━━ detectAcceleration 단위 테스트 ━━━')
const accelTests = [
  // [history, expectedAccelerating, label]
  [[10, 11, 12, 13], false, '균등 증가 (가속 없음)'],
  [[10, 11, 12, 20], true, '직전 변화 8배 (가속)'],
  [[10, 11, 12, 13.5], false, '직전 변화 1.5배 (가속 아님)'],
  [[10, 11, 12, 16], true, '직전 변화 4배 (가속)'],
  [[10, 11], false, '데이터 부족 (4회 미만)'],
  [[10, 10, 10, 10], false, '평균 변화 0 (판단 무의미)'],
]
let accelPass = 0
for (const [history, expected, label] of accelTests) {
  const { accelerating, ratio } = detectAcceleration(history)
  const ok = accelerating === expected
  if (ok) accelPass++
  console.log(`  ${ok ? '✅' : '❌'} ${label}: [${history.join(', ')}] → 가속=${accelerating}, 배수=${ratio} ${ok ? '' : `(예상: 가속=${expected})`}`)
}
console.log(`  ${accelPass}/${accelTests.length} 통과`)

console.log('\n━━━ classifyTrend 단위 테스트 ━━━')
const trendTests = [
  [[60, 70, 80, 90, 95], 'rising', '증가 추세'],
  [[90, 80, 70, 60, 50], 'falling', '감소 추세'],
  [[60, 62, 61, 63, 60], 'stable', '안정 (작은 변동)'],
  [[60, 90, 50, 95, 55], 'volatile', '큰 변동 (volatile)'],
  [[60], 'stable', '단일 데이터'],
]
let trendPass = 0
for (const [history, expected, label] of trendTests) {
  const got = classifyTrend(history)
  const ok = got === expected
  if (ok) trendPass++
  console.log(`  ${ok ? '✅' : '❌'} ${label}: [${history.join(', ')}] → ${got} ${ok ? '' : `(예상: ${expected})`}`)
}
console.log(`  ${trendPass}/${trendTests.length} 통과`)

console.log('\n━━━ step2 위험도 시나리오 (개념 검증) ━━━')
// classifyRiskLevel 핵심 로직만 복제
function classifyRiskLevel(latestRatio, nearLimitCount, accelerating) {
  if (latestRatio != null && latestRatio >= 95) return 'urgent'
  if (accelerating && latestRatio != null && latestRatio >= 80) return 'urgent'
  if (nearLimitCount >= 3) return 'urgent'
  if (latestRatio != null && latestRatio >= 80) return 'watch'
  if (nearLimitCount >= 2) return 'watch'
  if (accelerating) return 'watch'
  return 'safe'
}
const riskTests = [
  [98, 1, false, 'urgent', '최신 98% — urgent'],
  [85, 1, true, 'urgent', '최신 85% + 가속 — urgent'],
  [50, 3, false, 'urgent', '한계 근접 3회 — urgent'],
  [82, 1, false, 'watch', '최신 82% — watch'],
  [60, 2, false, 'watch', '한계 근접 2회 — watch'],
  [50, 0, true, 'watch', '가속만 — watch'],
  [40, 0, false, 'safe', '안정 — safe'],
]
let riskPass = 0
for (const [latest, nearCount, accel, expected, label] of riskTests) {
  const got = classifyRiskLevel(latest, nearCount, accel)
  const ok = got === expected
  if (ok) riskPass++
  console.log(`  ${ok ? '✅' : '❌'} ${label} → ${got} ${ok ? '' : `(예상: ${expected})`}`)
}
console.log(`  ${riskPass}/${riskTests.length} 통과`)

console.log('\n━━━ 완료 ━━━')
