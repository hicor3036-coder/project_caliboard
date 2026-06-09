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

console.log('\n━━━ 완료 ━━━')
