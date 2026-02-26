/**
 * 장비 상세페이지 공유 타입/유틸/하위 컴포넌트
 * — equipment-detail-page.tsx에서 추출
 */
'use client'

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import type { CertResult, MeasurementPoint } from '@/lib/cert-cache'
import { useT, fmt, type Lang } from '@/lib/i18n'

// ──────────────────────────── Guard Band (ILAC-G8:09/2019) ────────────────────────────

export type GuardBandVerdict = 'conformant' | 'conditional-pass' | 'conditional-fail' | 'non-conformant'

// ──────────────────────────── 타입 ────────────────────────────

export interface DetailItem {
  prjcCd: string
  acptNo: string
  rcpnYmd: string
  exrsWrtnYmd: string
  fnshScdlYmd: string
  snctYmd: string
  isncYmd: string
  smplOutDate: string
  pgstNm: string
  gyeoljeStatus: string
  mngmRsprNm: string
  mngmDvsnNm: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  prdNm: string
  mctlNo: string
  custEqpmSrno: string
  affcCyclCd: string
  nxtrExrsYmd: string
  totalFee: number
  totalVat: number
  totalSum: number
  apcnCmnm: string
  apcnNm: string
  apcnTlno: string
  apcnEmlAdrs: string
}

export interface TableRow extends DetailItem {
  no: number
}

export interface TrendRow {
  key: string
  label: string
  unit: string
  sortNum: number
  errors: Record<string, number | null>
  판정Map: Record<string, string>
  hasFail: boolean
  lastRatio: number | null
  lastUtRatio: number | null
  lastGuardBand: GuardBandVerdict | null
  trend: 'up' | 'down' | 'stable'
  level: 'safe' | 'warning' | 'danger'
}

export interface TrendEvaluation {
  stability: 'safe' | 'warning' | 'danger'
  riskPoints: string[]
}

export interface TrendData {
  series: { key: string; label: string; unit: string; points: { 교정일: string; yearLabel: string; 오차: number | null; 허용오차: number | null; 비율: number | null; 판정: string; 불확도: number | null; utRatio: number | null; guardBand: GuardBandVerdict | null }[] }[]
  chartData: Record<string, string | number | null>[]
  mpOrder: { key: string; label: string; unit: string; refUnit: string; sortNum: number }[]
  evaluation: TrendEvaluation
}

export interface ConformityTrend extends TrendData {
  yearLabels: string[]
  calDates: string[]
  certCount: number
  toleranceData: (number | null)[]
  byQuantity: Map<string, TrendData>
  quantityKeys: string[]
}

export interface CertProgress {
  total: number
  acptNo: string
  status: string
}

// ──────────────────────────── 유틸 함수 ────────────────────────────

export function parseYmd(ymd: string): Date | null {
  if (!ymd || ymd.length < 8) return null
  return new Date(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
  )
}

export function daysBetween(a: Date, b: Date): number {
  return Math.ceil(Math.abs(b.getTime() - a.getTime()) / 86_400_000)
}

// 전문 교정 리포트 팔레트
export const TREND_COLORS = ['#1e40af', '#dc2626', '#d97706', '#059669', '#7c3aed', '#0284c7', '#be185d', '#475569']

export function normalizeRef(val: string): string {
  const cleaned = val.replace(/\s/g, '')
  const num = parseFloat(cleaned)
  if (!isNaN(num)) return String(num)
  return val
}

export function mpKey(mp: MeasurementPoint, idx: number): string {
  const q = mp.물리량 ?? inferQuantityFromUnit(mp.기준단위 || mp.오차단위 || mp.지시단위 || null) ?? ''
  if (mp.기준값 != null) return `${q}_${normalizeRef(mp.기준값)}_${mp.기준단위 || ''}`
  return `${q}_idx_${idx}`
}

export function parseNum(val: string | null | undefined): number | null {
  if (val == null) return null
  const cleaned = val.replace(/[±\s]/g, '').replace(',', '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

export function inferQuantityFromUnit(unit: string | null): string | null {
  if (!unit) return null
  const u = unit.toLowerCase().replace(/\s/g, '')
  if (u.includes('°c') || u.includes('℃')) return 'Temperature'
  if (u.includes('%r.h') || u.includes('r.h.') || u.includes('%rh')) return 'Humidity'
  if (u.includes('pa') || u.includes('mbar') || u.includes('bar') || u.includes('psi')) return 'Pressure'
  if (u.includes('m/s²') || u.includes('m/s2')) return 'Vibration'
  if (u.includes('hz') || u.includes('khz') || u.includes('mhz')) return 'Frequency'
  if (u.includes('db')) return 'Sound Level'
  return null
}

/** 대소문자·하이픈·공백 차이를 모두 무시하여 같은 물리량을 하나로 묶는 정규화 */
function normalizeQuantity(q: string | null): string | null {
  if (!q) return null
  return q.replace(/[-_\s]+/g, '').toLowerCase()
  // "Torque Counter-Clockwise" → "torquecounterclockwise"
  // "Torque Counterclockwise"  → "torquecounterclockwise"  ← 동일
}

/** 정규화 키 → 표시용 원본 라벨 (첫 등장 값 유지) */
const _qDisplayCache = new Map<string, string>()
function quantityDisplayName(raw: string): string {
  const key = normalizeQuantity(raw) ?? raw
  if (!_qDisplayCache.has(key)) _qDisplayCache.set(key, raw)
  return _qDisplayCache.get(key)!
}

function resolveQuantityKey(mp: MeasurementPoint): string {
  const raw = mp.물리량 ?? inferQuantityFromUnit(mp.기준단위 || mp.오차단위 || mp.지시단위 || null)
  if (raw) quantityDisplayName(raw) // 표시용 캐시 등록
  return normalizeQuantity(raw) || '전체'
}

export function groupByQuantity(measurements: MeasurementPoint[]): Map<string, MeasurementPoint[]> {
  const groups = new Map<string, MeasurementPoint[]>()
  for (const mp of measurements) {
    const groupName = resolveQuantityKey(mp)
    if (!groups.has(groupName)) groups.set(groupName, [])
    groups.get(groupName)!.push(mp)
  }
  return groups
}

const QUANTITY_LABELS_KO: Record<string, string> = {
  temperature: '온도', humidity: '습도', pressure: '압력',
  vibration: '진동', frequency: '주파수', soundlevel: '소음',
  voltage: '전압', current: '전류', resistance: '저항',
}

export function quantityLabel(q: string, lang: Lang, allLabel: string): string {
  if (q === '전체') return allLabel
  if (lang === 'ko') return QUANTITY_LABELS_KO[q] || _qDisplayCache.get(q) || q
  // 영문: 원본 라벨 (Title Case 유지) 반환
  return _qDisplayCache.get(q) || q
}

// ──────────────────────────── 트렌드 평가 ────────────────────────────

export function evaluateTrends(
  series: { key: string; label: string; points: { 오차: number | null; 허용오차: number | null; 비율: number | null; 판정: string }[] }[],
  t: ReturnType<typeof useT>['t'],
): TrendEvaluation {
  const riskPoints: string[] = []
  let worstLevel: 'safe' | 'warning' | 'danger' = 'safe'

  for (const s of series) {
    const pts = s.points
    if (pts.some(p => p.판정 === 'FAIL')) {
      riskPoints.push(`${s.label}: ${t.health.failRecord}`)
      worstLevel = 'danger'
      continue
    }
    const lastRatio = [...pts].reverse().find(p => p.비율 != null)?.비율
    if (lastRatio != null && lastRatio > 100) {
      riskPoints.push(`${s.label}: ${fmt(t.health.tolExceed, lastRatio.toFixed(1))}`)
      worstLevel = 'danger'
      continue
    }
    if (lastRatio != null && lastRatio > 80) {
      riskPoints.push(`${s.label}: ${fmt(t.health.tolRatio, lastRatio.toFixed(1))}`)
      if (worstLevel !== 'danger') worstLevel = 'warning'
      continue
    }
    const errors = pts.map(p => p.오차).filter((v): v is number => v != null)
    if (errors.length >= 2) {
      const absErrors = errors.map(Math.abs)
      const increasing = absErrors.every((v, i) => i === 0 || v >= absErrors[i - 1])
      if (increasing && absErrors[absErrors.length - 1] > absErrors[0] * 1.2) {
        riskPoints.push(`${s.label}: ${t.health.errorIncrease}`)
        if (worstLevel === 'safe') worstLevel = 'warning'
        continue
      }
    }
    if (lastRatio != null && lastRatio > 50 && worstLevel === 'safe') {
      worstLevel = 'warning'
    }
  }

  return { stability: worstLevel, riskPoints }
}

// ──────────────────────────── 성적서 localStorage 캐싱 ────────────────────────────

const CERT_CACHE_PREFIX = 'cert_'

export function loadCachedCerts(acptNos: string[]): Map<string, CertResult> {
  const map = new Map<string, CertResult>()
  if (typeof window === 'undefined') return map
  for (const no of acptNos) {
    try {
      const raw = localStorage.getItem(CERT_CACHE_PREFIX + no)
      if (raw) map.set(no, JSON.parse(raw))
    } catch { /* 파싱 실패 무시 */ }
  }
  return map
}

export function saveCertToCache(acptNo: string, result: CertResult) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CERT_CACHE_PREFIX + acptNo, JSON.stringify(result))
  } catch {
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(CERT_CACHE_PREFIX)) keys.push(k)
      }
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k))
      localStorage.setItem(CERT_CACHE_PREFIX + acptNo, JSON.stringify(result))
    } catch { /* 포기 */ }
  }
}

// ──────────────────────────── 성적서 커스텀 훅 ────────────────────────────

export function useCertData(groupNm: string) {
  const [certs, setCerts] = useState<Map<string, CertResult>>(new Map())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [progress, setProgress] = useState<CertProgress>({ total: 0, acptNo: '', status: '' })
  const [certLoading, setCertLoading] = useState(false)
  const [certDone, setCertDone] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const fetchCerts = useCallback((refresh = false) => {
    if (esRef.current) return
    setCertLoading(true)
    setCertDone(false)
    setCerts(new Map())
    setErrors(new Map())

    const params = new URLSearchParams({ groupNm })
    if (refresh) params.set('refresh', 'true')
    const es = new EventSource(`/api/ktools/cert?${params}`)
    esRef.current = es

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      setProgress(prev => ({ ...prev, total: data.total, acptNo: data.acptNo, status: data.status }))
    })

    es.addEventListener('cert', (e) => {
      const { acptNo, result } = JSON.parse(e.data)
      saveCertToCache(acptNo, result)
      setCerts(prev => new Map(prev).set(acptNo, result))
    })

    es.addEventListener('cert_error', (e) => {
      const { acptNo, error } = JSON.parse(e.data)
      setErrors(prev => new Map(prev).set(acptNo, error))
    })

    es.addEventListener('complete', () => {
      setCertLoading(false)
      setCertDone(true)
      es.close()
      esRef.current = null
    })

    es.addEventListener('error', () => {
      setCertLoading(false)
      es.close()
      esRef.current = null
    })
  }, [groupNm])

  useEffect(() => {
    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [])

  return { certs, setCerts, errors, progress, certLoading, certDone, fetchCerts }
}

// ──────────────────────────── conformityTrend 계산 ────────────────────────────

export function computeConformityTrend(
  certs: Map<string, CertResult>,
  t: ReturnType<typeof useT>['t'],
  spec: { tolerance: { value: number; unit: string } | null; mpePercent: number | null } | null,
): ConformityTrend | null {
  if (certs.size < 1) return null

  const sorted = Array.from(certs.entries())
    .filter(([, c]) => c.교정일 && (c.측정결과 ?? []).some(mp => mp.오차 != null || mp.기준값 != null))
    .sort((a, b) => (a[1].교정일 ?? '').localeCompare(b[1].교정일 ?? ''))

  if (sorted.length < 1) return null

  const calDates = sorted.map(([, c]) => c.교정일 ?? '')
  const years = calDates.map(d => d.slice(0, 4))
  const hasDuplicateYear = years.some((y, i) => years.indexOf(y) !== i)
  const yearLabels = hasDuplicateYear ? calDates : years

  const allQuantities = new Set<string>()
  for (const [, cert] of sorted) {
    const groups = groupByQuantity(cert.측정결과 ?? [])
    for (const key of groups.keys()) allQuantities.add(key)
  }
  const quantityKeys = Array.from(allQuantities)

  function buildTrendForMeasurements(
    measurements: (mp: MeasurementPoint, idx: number) => boolean
  ) {
    const mpOrderLocal: { key: string; label: string; unit: string; refUnit: string; sortNum: number }[] = []
    const mpKeySet = new Set<string>()
    for (const [, cert] of sorted) {
      (cert.측정결과 ?? []).forEach((mp, idx) => {
        if (!measurements(mp, idx)) return
        const key = mpKey(mp, idx)
        if (!mpKeySet.has(key)) {
          mpKeySet.add(key)
          const refNum = mp.기준값 != null ? parseFloat(mp.기준값.replace(/\s/g, '')) : NaN
          const label = mp.기준값 != null
            ? `${normalizeRef(mp.기준값)}${mp.기준단위 ? ' ' + mp.기준단위 : ''}`
            : `측정점 ${idx + 1}`
          mpOrderLocal.push({ key, label, unit: mp.오차단위 || mp.기준단위 || '', refUnit: mp.기준단위 || '', sortNum: isNaN(refNum) ? Infinity : refNum })
        }
      })
    }

    mpOrderLocal.sort((a, b) => a.sortNum - b.sortNum)
    if (mpOrderLocal.length === 0) return null

    const chartData: Record<string, string | number | null>[] = mpOrderLocal.map(mp => {
      const point: Record<string, string | number | null> = { 측정포인트: mp.label, _x: mp.sortNum === Infinity ? null : mp.sortNum }
      for (let ci = 0; ci < sorted.length; ci++) {
        const [, cert] = sorted[ci]
        const yearLabel = yearLabels[ci]
        const matched = (cert.측정결과 ?? []).find((m, idx) => mpKey(m, idx) === mp.key)
        point[yearLabel] = matched ? parseNum(matched.오차) : null
        // 불확도 에러바 데이터 (연도별)
        const unc = matched ? parseNum(matched.불확도) : null
        if (unc != null) point[`${yearLabel}_U`] = unc
      }
      for (let ci = sorted.length - 1; ci >= 0; ci--) {
        const [, cert] = sorted[ci]
        const matched = (cert.측정결과 ?? []).find((m, idx) => mpKey(m, idx) === mp.key)
        if (matched) {
          const tol = parseNum(matched.허용오차)
          if (tol != null) {
            point['허용상한'] = Math.abs(tol)
            point['허용하한'] = -Math.abs(tol)
          }
          break
        }
      }
      // 성적서 허용오차 없을 때 사용자 설정 허용오차로 fallback
      if (point['허용상한'] == null && spec?.tolerance) {
        const show = !mp.unit || !spec.tolerance.unit || mp.unit === spec.tolerance.unit
        if (show) {
          point['허용상한'] = spec.tolerance.value
          point['허용하한'] = -spec.tolerance.value
        }
      }
      // Guard Band 경계선 (T - U): 최신 성적서의 불확도 기반
      {
        const latestCi = sorted.length - 1
        const [, latestCert] = sorted[latestCi]
        const latestMatched = (latestCert.측정결과 ?? []).find((m, idx) => mpKey(m, idx) === mp.key)
        const latestUnc = latestMatched ? parseNum(latestMatched.불확도) : null
        const tol = point['허용상한'] as number | null
        if (latestUnc != null && tol != null) {
          const gbLimit = Math.abs(tol) - latestUnc
          if (gbLimit > 0) {
            point['GB상한'] = gbLimit
            point['GB하한'] = -gbLimit
          }
        }
      }
      // MPE 밴드: 허용오차 × (mpePercent / 100). 100%면 허용오차와 동일→그리지 않음
      const effectiveMpe = spec?.mpePercent ?? 100
      if (effectiveMpe < 100) {
        const tol = point['허용상한'] as number | null
        if (tol != null) {
          const mpeAbs = Math.abs(tol) * (effectiveMpe / 100)
          point['MPE상한'] = mpeAbs
          point['MPE하한'] = -mpeAbs
        }
      }
      return point
    })

    const series = mpOrderLocal.map(mp => {
      const points = sorted.map(([, cert], ci) => {
        const matched = (cert.측정결과 ?? []).find((m, idx) => mpKey(m, idx) === mp.key)
        const errNum = matched ? parseNum(matched.오차) : null
        const tolNum = matched ? parseNum(matched.허용오차) : null
        const unitsCompatible = matched?.오차단위 && matched?.허용오차단위
          ? matched.오차단위 === matched.허용오차단위
          : true
        const ratio = errNum != null && tolNum != null && tolNum !== 0 && unitsCompatible
          ? Math.round((Math.abs(errNum) / Math.abs(tolNum)) * 1000) / 10
          : null
        // 측정불확도 U/T 비율 (ISO 10012 §7.3.1)
        const uncNum = matched ? parseNum(matched.불확도) : null
        const utRatio = uncNum != null && tolNum != null && tolNum !== 0
          ? Math.round((uncNum / Math.abs(tolNum)) * 1000) / 10
          : null
        // Guard Band 판정 (ILAC-G8:09/2019)
        // 오차·불확도·허용오차 단위가 같을 때만 계산 가능
        let guardBand: GuardBandVerdict | null = null
        if (errNum != null && uncNum != null && tolNum != null && unitsCompatible) {
          const uncUnitOk = !matched?.불확도단위 || !matched?.오차단위 || matched.불확도단위 === matched.오차단위
          if (uncUnitOk) {
            const absErr = Math.abs(errNum)
            const absTol = Math.abs(tolNum)
            if (absErr + uncNum <= absTol) guardBand = 'conformant'
            else if (absErr <= absTol) guardBand = 'conditional-pass'
            else if (absErr <= absTol + uncNum) guardBand = 'conditional-fail'
            else guardBand = 'non-conformant'
          }
        }
        return {
          교정일: calDates[ci],
          yearLabel: yearLabels[ci],
          오차: errNum,
          허용오차: tolNum,
          비율: ratio,
          판정: matched?.판정 ?? 'PASS',
          불확도: uncNum,
          utRatio,
          guardBand,
        }
      })
      return { key: mp.key, label: mp.label, unit: mp.unit, points }
    })

    const evaluation = evaluateTrends(series, t)
    return { series, chartData, mpOrder: mpOrderLocal, evaluation }
  }

  const byQuantity = new Map<string, TrendData>()
  for (const q of quantityKeys) {
    const trend = buildTrendForMeasurements((mp) => resolveQuantityKey(mp) === q)
    if (trend) byQuantity.set(q, trend)
  }

  const allTrend = buildTrendForMeasurements(() => true)
  if (!allTrend) return null

  return {
    ...allTrend,
    yearLabels,
    calDates,
    certCount: sorted.length,
    toleranceData: allTrend.mpOrder.map(mp => {
      for (let ci = sorted.length - 1; ci >= 0; ci--) {
        const [, cert] = sorted[ci]
        const matched = (cert.측정결과 ?? []).find((m, idx) => mpKey(m, idx) === mp.key)
        if (matched) return parseNum(matched.허용오차)
      }
      return null
    }),
    byQuantity,
    quantityKeys,
  }
}
