// 교정 데이터 분석 모듈 (Python ktools_분석.py → TypeScript 변환)

import { KtoolsItem } from './ktools-fetch'

// === 유틸 ===

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr || dateStr === 'None') return null
  const y = dateStr.slice(0, 4)
  const m = dateStr.slice(4, 6)
  const d = dateStr.slice(6, 8)
  const date = new Date(`${y}-${m}-${d}`)
  return isNaN(date.getTime()) ? null : date
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// 그룹별 카운트
function countBy<T>(items: T[], keyFn: (item: T) => string | null): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of items) {
    const key = keyFn(item) ?? '(없음)'
    result[key] = (result[key] || 0) + 1
  }
  return result
}

// === 분석 결과 타입 ===

export interface UnprocessedItem {
  acptNo: string
  rcpnYmd: string
  체류일수: number
  예상완료일: string | null
  남은일수: number | null
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  mngmRsprNm: string
  fnshScdlYmd: string
  groupNm: string
  groupCnt: number
}

export interface CalibrationDuration {
  전체평균: number
  전체중앙값: number
  전체최대: number
  건수: number
  제품별: { prdNm: string; 평균: number; 중앙값: number; 건수: number }[]
}

export interface UpcomingItem {
  acptNo: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  nxtrExrsYmd: string
  dDay: number
  접수권장일: string
  접수시급: boolean
  구간: '장기경과' | '만료' | 'D-30' | 'D-60' | 'D-90' | 'D-90+'
  groupNm: string
  groupCnt: number
}

export interface UpcomingCalibration {
  평균소요일: number
  여유일: number
  장기경과: number
  만료: number
  d30: number
  d60: number
  d90: number
  items: UpcomingItem[]
  제조사별: { label: string; value: number }[]
  시급건수: number
}

// 전체 장비 검색용 간소화 항목
export interface EquipmentItem {
  acptNo: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  rcpnYmd: string
  pgstNm: string
  mngmRsprNm: string
  nxtrExrsYmd: string
  exrsWrtnYmd: string
  groupNm: string
  groupCnt: number
}

export interface AnalysisResult {
  summary: {
    총건수: number
    미처리건수: number
    교정임박건수: number
    평균소요일: number
    데이터시점: string
  }
  전체장비: EquipmentItem[]
  미처리현황: UnprocessedItem[]
  교정소요기간: CalibrationDuration
  차기교정임박: UpcomingCalibration
  진행상태분포: { label: string; value: number }[]
  월별접수추이: { month: string; 건수: number }[]
  과제별현황: { prjcCd: string; 건수: number; 총비용: number }[]
  제조사별분포: { label: string; value: number }[]
  담당자별처리량: { label: string; value: number }[]
}

// === 분석 함수 ===

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// 제품별 평균 소요일 맵 (미처리 예상완료 계산용)
function calcDurationByProduct(items: KtoolsItem[]): Map<string, number> {
  const map = new Map<string, number[]>()
  for (const item of items) {
    const rcpn = parseDate(item.rcpnYmd)
    const exrs = parseDate(item.exrsWrtnYmd)
    if (!rcpn || !exrs) continue
    const days = daysBetween(rcpn, exrs)
    if (days < 0) continue
    const key = item.prdNm ?? '(없음)'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(days)
  }

  const result = new Map<string, number>()
  for (const [key, days] of map) {
    result.set(key, Math.round(median(days)))
  }
  return result
}

// Priority 1: 미처리 현황 + 예상완료시점
function analyzeUnprocessed(items: KtoolsItem[], durationByProduct: Map<string, number>, 전체중앙값: number): UnprocessedItem[] {
  const today = new Date()

  return items
    .filter(item => item.pgstNm?.includes('미처리'))
    .map(item => {
      const rcpn = parseDate(item.rcpnYmd)
      const 체류일수 = rcpn ? daysBetween(rcpn, today) : 0

      // 예상완료일: 접수일 + 제품별 평균소요일 (없으면 전체 중앙값)
      const 제품소요일 = durationByProduct.get(item.prdNm ?? '') ?? 전체중앙값
      const 예상완료 = rcpn ? new Date(rcpn.getTime() + 제품소요일 * 86400000) : null

      return {
        acptNo: item.acptNo,
        rcpnYmd: item.rcpnYmd ? `${item.rcpnYmd.slice(0, 4)}-${item.rcpnYmd.slice(4, 6)}-${item.rcpnYmd.slice(6, 8)}` : '',
        체류일수,
        예상완료일: 예상완료 ? formatDate(예상완료) : null,
        남은일수: 예상완료 ? daysBetween(today, 예상완료) : null,
        entpPrdNm: item.entpPrdNm ?? '',
        prdnCmpnNm: item.prdnCmpnNm ?? '',
        stszNm: item.stszNm ?? '',
        mctlNo: item.mctlNo ?? '',
        custEqpmSrno: item.custEqpmSrno ?? '',
        mngmRsprNm: item.mngmRsprNm ?? '',
        fnshScdlYmd: item.fnshScdlYmd ? `${item.fnshScdlYmd.slice(0, 4)}-${item.fnshScdlYmd.slice(4, 6)}-${item.fnshScdlYmd.slice(6, 8)}` : '',
        groupNm: (item as Record<string, unknown>).groupNm as string ?? '',
        groupCnt: ((item as Record<string, unknown>).groupCnt as number) ?? 1,
      }
    })
    .sort((a, b) => b.체류일수 - a.체류일수)
}

// Priority 1: 교정 소요기간 통계
function analyzeDuration(items: KtoolsItem[]): CalibrationDuration {
  const durations: { prdNm: string; days: number }[] = []

  for (const item of items) {
    const rcpn = parseDate(item.rcpnYmd)
    const exrs = parseDate(item.exrsWrtnYmd)
    if (!rcpn || !exrs) continue
    const days = daysBetween(rcpn, exrs)
    if (days < 0) continue
    durations.push({ prdNm: item.prdNm ?? '(없음)', days })
  }

  const allDays = durations.map(d => d.days)

  // 제품별 집계
  const byProduct = new Map<string, number[]>()
  for (const d of durations) {
    if (!byProduct.has(d.prdNm)) byProduct.set(d.prdNm, [])
    byProduct.get(d.prdNm)!.push(d.days)
  }

  const 제품별 = Array.from(byProduct.entries())
    .filter(([, days]) => days.length >= 5)
    .map(([prdNm, days]) => ({
      prdNm,
      평균: Math.round(days.reduce((a, b) => a + b, 0) / days.length),
      중앙값: Math.round(median(days)),
      건수: days.length,
    }))
    .sort((a, b) => b.평균 - a.평균)
    .slice(0, 20)

  return {
    전체평균: allDays.length ? Math.round(allDays.reduce((a, b) => a + b, 0) / allDays.length) : 0,
    전체중앙값: Math.round(median(allDays)),
    전체최대: allDays.length ? Math.max(...allDays) : 0,
    건수: allDays.length,
    제품별,
  }
}

// Priority 1: 차기교정 임박
function analyzeUpcoming(items: KtoolsItem[], 전체중앙값: number): UpcomingCalibration {
  const today = new Date()
  const 여유일 = 14

  const result: UpcomingItem[] = []

  for (const item of items) {
    const nxtr = parseDate(item.nxtrExrsYmd)
    if (!nxtr) continue

    const dDay = daysBetween(today, nxtr)
    const 접수권장일 = new Date(nxtr.getTime() - (전체중앙값 + 여유일) * 86400000)
    const 접수시급 = 접수권장일 <= today

    let 구간: UpcomingItem['구간']
    if (dDay < -730) 구간 = '장기경과'   // 2년+ 초과
    else if (dDay <= 0) 구간 = '만료'   // 오늘 만료(D-0) 포함
    else if (dDay <= 30) 구간 = 'D-30'
    else if (dDay <= 60) 구간 = 'D-60'
    else if (dDay <= 90) 구간 = 'D-90'
    else 구간 = 'D-90+'

    result.push({
      acptNo: item.acptNo,
      entpPrdNm: item.entpPrdNm ?? '',
      prdnCmpnNm: item.prdnCmpnNm ?? '',
      stszNm: item.stszNm ?? '',
      mctlNo: item.mctlNo ?? '',
      custEqpmSrno: item.custEqpmSrno ?? '',
      nxtrExrsYmd: formatDate(nxtr),
      dDay,
      접수권장일: formatDate(접수권장일),
      접수시급,
      구간,
      groupNm: (item as Record<string, unknown>).groupNm as string ?? '',
      groupCnt: ((item as Record<string, unknown>).groupCnt as number) ?? 1,
    })
  }

  // D-90+ 제외, 나머지 모두 포함 (장기경과 포함 — UI에서 분리 표시)
  const alertItems = result
    .filter(r => r.구간 !== 'D-90+')
    .sort((a, b) => a.dDay - b.dDay)

  // 제조사별 집계 (장기경과 제외 기준, Top 10)
  const mfrCounts = new Map<string, number>()
  for (const item of alertItems) {
    if (item.구간 === '장기경과') continue
    const key = item.prdnCmpnNm || '(없음)'
    mfrCounts.set(key, (mfrCounts.get(key) ?? 0) + 1)
  }
  const 제조사별 = Array.from(mfrCounts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  return {
    평균소요일: 전체중앙값,
    여유일,
    장기경과: result.filter(r => r.구간 === '장기경과').length,
    만료: result.filter(r => r.구간 === '만료').length,
    d30: result.filter(r => r.구간 === 'D-30').length,
    d60: result.filter(r => r.구간 === 'D-60').length,
    d90: result.filter(r => r.구간 === 'D-90').length,
    items: alertItems,
    제조사별,
    시급건수: alertItems.filter(i => i.접수시급 && i.구간 !== '장기경과').length,
  }
}

// Priority 2: 진행상태 분포
function analyzeStatus(items: KtoolsItem[]) {
  const counts = countBy(items, i => i.pgstNm)
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

// Priority 2: 월별 접수 추이
function analyzeMonthly(items: KtoolsItem[]) {
  const counts: Record<string, number> = {}
  for (const item of items) {
    if (!item.rcpnYmd) continue
    const month = `${item.rcpnYmd.slice(0, 4)}-${item.rcpnYmd.slice(4, 6)}`
    counts[month] = (counts[month] || 0) + 1
  }
  return Object.entries(counts)
    .map(([month, 건수]) => ({ month, 건수 }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-24) // 최근 24개월
}

// Priority 2: 과제별 현황
function analyzeByProject(items: KtoolsItem[]) {
  const map = new Map<string, { 건수: number; 총비용: number }>()
  for (const item of items) {
    const key = item.prjcCd ?? '(없음)'
    const prev = map.get(key) ?? { 건수: 0, 총비용: 0 }
    map.set(key, { 건수: prev.건수 + 1, 총비용: prev.총비용 + (item.totalSum || 0) })
  }
  return Array.from(map.entries())
    .map(([prjcCd, data]) => ({ prjcCd, ...data }))
    .sort((a, b) => b.건수 - a.건수)
}

// Priority 2: 제조사별 분포
function analyzeByManufacturer(items: KtoolsItem[]) {
  const counts = countBy(items, i => i.prdnCmpnNm)
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20)
}

// Priority 2: 담당자별 처리량
function analyzeByManager(items: KtoolsItem[]) {
  const counts = countBy(items, i => i.mngmRsprNm)
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

// 전체 장비 목록 — raw 데이터를 검색용 간소화 형태로 변환
function toEquipmentList(items: KtoolsItem[]): EquipmentItem[] {
  function fmtDate(d: string | null): string {
    if (!d || d.length < 8) return ''
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  }

  return items.map(item => ({
    acptNo: item.acptNo,
    entpPrdNm: item.entpPrdNm ?? '',
    prdnCmpnNm: item.prdnCmpnNm ?? '',
    stszNm: item.stszNm ?? '',
    mctlNo: item.mctlNo ?? '',
    custEqpmSrno: item.custEqpmSrno ?? '',
    rcpnYmd: fmtDate(item.rcpnYmd),
    pgstNm: item.pgstNm ?? '',
    mngmRsprNm: item.mngmRsprNm ?? '',
    nxtrExrsYmd: fmtDate(item.nxtrExrsYmd),
    exrsWrtnYmd: fmtDate(item.exrsWrtnYmd),
    groupNm: (item as Record<string, unknown>).groupNm as string ?? '',
    groupCnt: ((item as Record<string, unknown>).groupCnt as number) ?? 1,
  }))
}

// === 메인 분석 함수 ===

export function analyzeAll(items: KtoolsItem[], fetchedAt: Date): AnalysisResult {
  const duration = analyzeDuration(items)
  const durationByProduct = calcDurationByProduct(items)
  const upcoming = analyzeUpcoming(items, duration.전체중앙값)
  const unprocessed = analyzeUnprocessed(items, durationByProduct, duration.전체중앙값)

  return {
    summary: {
      총건수: items.length,
      미처리건수: unprocessed.length,
      교정임박건수: upcoming.만료 + upcoming.d30 + upcoming.d60,
      평균소요일: duration.전체중앙값,
      데이터시점: fetchedAt.toISOString(),
    },
    전체장비: toEquipmentList(items),
    미처리현황: unprocessed,
    교정소요기간: duration,
    차기교정임박: upcoming,
    진행상태분포: analyzeStatus(items),
    월별접수추이: analyzeMonthly(items),
    과제별현황: analyzeByProject(items),
    제조사별분포: analyzeByManufacturer(items),
    담당자별처리량: analyzeByManager(items),
  }
}
