'use client'

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Area, ComposedChart,
} from 'recharts'
import DataTable, { type Column, fmtDate } from './data-table'
import EquipmentHealthPanel from './equipment-health-panel'
import CalibrationInstructionPanel from './calibration-instruction-panel'
import type { CertResult, MeasurementPoint } from '@/lib/cert-cache'
import { useT, fmt, type Dict, type Lang } from '@/lib/i18n'

// === 타입 ===

interface DetailItem {
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

interface TableRow extends DetailItem {
  no: number
}

interface Props {
  groupNm: string
  equipmentName: string
  onBack: () => void
}

// === 유틸 ===

function parseYmd(ymd: string): Date | null {
  if (!ymd || ymd.length < 8) return null
  return new Date(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
  )
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil(Math.abs(b.getTime() - a.getTime()) / 86_400_000)
}

// === 트렌드 유틸 ===

// 전문 교정 리포트 팔레트 — 절제되고 구분 명확한 색상
const TREND_COLORS = ['#1e40af', '#dc2626', '#d97706', '#059669', '#7c3aed', '#0284c7', '#be185d', '#475569']

function normalizeRef(val: string): string {
  // 숫자로 파싱 가능하면 정규화 (소수점 표기 통일: "1.0" → "1", "3.0" → "3", "1.2" → "1.2")
  const cleaned = val.replace(/\s/g, '')
  const num = parseFloat(cleaned)
  if (!isNaN(num)) return String(num)
  return val
}

function mpKey(mp: MeasurementPoint, idx: number): string {
  const q = mp.물리량 ?? inferQuantityFromUnit(mp.기준단위 || mp.오차단위 || mp.지시단위 || null) ?? ''
  if (mp.기준값 != null) return `${q}_${normalizeRef(mp.기준값)}_${mp.기준단위 || ''}`
  return `${q}_idx_${idx}`
}

function parseNum(val: string | null | undefined): number | null {
  if (val == null) return null
  const cleaned = val.replace(/[±\s]/g, '').replace(',', '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

interface TrendEvaluation {
  stability: 'safe' | 'warning' | 'danger'
  riskPoints: string[]
}

function evaluateTrends(series: { key: string; label: string; points: { 오차: number | null; 허용오차: number | null; 비율: number | null; 판정: string }[] }[], t: Dict): TrendEvaluation {
  const riskPoints: string[] = []
  let worstLevel: 'safe' | 'warning' | 'danger' = 'safe'

  for (const s of series) {
    const pts = s.points
    // FAIL 이력 확인
    if (pts.some(p => p.판정 === 'FAIL')) {
      riskPoints.push(`${s.label}: ${t.health.failRecord}`)
      worstLevel = 'danger'
      continue
    }

    // 최근 비율 확인 (PASS이면서 비율 > 100%만 위험, > 80%는 주의)
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

    // 오차 연속 증가 확인 (2건 이상 필요)
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

// === 물리량 그룹핑 유틸 ===

function inferQuantityFromUnit(unit: string | null): string | null {
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

function groupByQuantity(measurements: MeasurementPoint[]): Map<string, MeasurementPoint[]> {
  const groups = new Map<string, MeasurementPoint[]>()
  for (const mp of measurements) {
    let key = mp.물리량 ?? null
    if (!key) key = inferQuantityFromUnit(mp.기준단위 || mp.오차단위 || mp.지시단위 || null)
    const groupName = key || '전체'
    if (!groups.has(groupName)) groups.set(groupName, [])
    groups.get(groupName)!.push(mp)
  }
  return groups
}

const QUANTITY_LABELS_KO: Record<string, string> = {
  Temperature: '온도', Humidity: '습도', Pressure: '압력',
  Vibration: '진동', Frequency: '주파수', 'Sound Level': '소음',
  Voltage: '전압', Current: '전류', Resistance: '저항',
}

function quantityLabel(q: string, lang: Lang, allLabel: string): string {
  if (q === '전체') return allLabel
  if (lang === 'ko') return QUANTITY_LABELS_KO[q] || q
  return q
}

// === 테이블 컬럼 (hook) ===

function useColumns(): Column<TableRow>[] {
  const { t } = useT()
  return useMemo(() => [
    {
      key: 'no', header: 'No', align: 'center' as const,
      sortValue: (i: TableRow) => i.no,
      render: (i: TableRow) => <span className="text-gray-400">{i.no}</span>,
    },
    {
      key: 'prjcCd', header: t.detail.project,
      sortValue: (i: TableRow) => i.prjcCd,
      render: (i: TableRow) => <span className="font-mono text-gray-500">{i.prjcCd}</span>,
    },
    {
      key: 'acptNo', header: t.detail.acptNo,
      sortValue: (i: TableRow) => i.acptNo,
      render: (i: TableRow) => <span className="font-mono text-gray-500">{i.acptNo}</span>,
    },
    {
      key: 'rcpnYmd', header: t.detail.rcpnDate,
      sortValue: (i: TableRow) => i.rcpnYmd,
      render: (i: TableRow) => <span className="text-gray-600">{fmtDate(i.rcpnYmd)}</span>,
    },
    {
      key: 'exrsWrtnYmd', header: t.detail.calComplete,
      sortValue: (i: TableRow) => i.exrsWrtnYmd,
      render: (i: TableRow) => <span className="text-gray-600">{fmtDate(i.exrsWrtnYmd)}</span>,
    },
    {
      key: 'nxtrExrsYmd', header: t.detail.nextCalDate,
      sortValue: (i: TableRow) => i.nxtrExrsYmd,
      render: (i: TableRow) => <span className="text-gray-600">{fmtDate(i.nxtrExrsYmd)}</span>,
    },
    {
      key: 'totalSum', header: t.detail.cost,
      sortValue: (i: TableRow) => i.totalSum,
      render: (i: TableRow) => <span className="text-gray-600">{i.totalSum ? fmt(t.detail.costUnit, i.totalSum.toLocaleString()) : '-'}</span>,
    },
    {
      key: 'pgstNm', header: t.detail.status,
      sortValue: (i: TableRow) => i.pgstNm,
      render: (i: TableRow) => {
        const s = i.pgstNm
        const color = s.includes('미처리') ? 'bg-amber-100 text-amber-700'
          : s.includes('완료') ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-600'
        return <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${color}`}>{s || '-'}</span>
      },
    },
    {
      key: 'mngmRsprNm', header: t.detail.calManager,
      sortValue: (i: TableRow) => i.mngmRsprNm,
      render: (i: TableRow) => <span className="text-gray-600">{i.mngmRsprNm || '-'}</span>,
    },
  ], [t])
}

// === 성적서 localStorage 캐싱 ===

const CERT_CACHE_PREFIX = 'cert_'

function loadCachedCerts(acptNos: string[]): Map<string, CertResult> {
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

function saveCertToCache(acptNo: string, result: CertResult) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CERT_CACHE_PREFIX + acptNo, JSON.stringify(result))
  } catch {
    // localStorage 용량 초과 시 오래된 캐시 정리 시도
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(CERT_CACHE_PREFIX)) keys.push(k)
      }
      // 앞쪽 절반 삭제
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k))
      localStorage.setItem(CERT_CACHE_PREFIX + acptNo, JSON.stringify(result))
    } catch { /* 포기 */ }
  }
}

// === 성적서 커스텀 훅 ===

interface CertProgress {
  total: number
  acptNo: string
  status: string
}

function useCertData(groupNm: string) {
  const [certs, setCerts] = useState<Map<string, CertResult>>(new Map())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [progress, setProgress] = useState<CertProgress>({ total: 0, acptNo: '', status: '' })
  const [certLoading, setCertLoading] = useState(false)
  const [certDone, setCertDone] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const fetchCerts = useCallback((refresh = false) => {
    // 이미 로딩 중이면 무시
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
      // total과 현재 처리 중인 건 정보만 업데이트 (current는 완료 기준으로 별도 계산)
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

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [])

  return { certs, setCerts, errors, progress, certLoading, certDone, fetchCerts }
}

// === 메인 컴포넌트 ===

export default function EquipmentDetailPage({ groupNm, equipmentName, onBack }: Props) {
  const { t, lang } = useT()
  const columns = useColumns()
  const [items, setItems] = useState<DetailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)      // 원본
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null) // 썸네일 (빠른 로딩)
  const [imageLoading, setImageLoading] = useState(true)
  const [imageError, setImageError] = useState(false)
  const [selectedCert, setSelectedCert] = useState<{ acptNo: string; cert: CertResult } | null>(null)
  const [activeTrendQuantity, setActiveTrendQuantity] = useState<string | null>(null)
  const [hiddenYears, setHiddenYears] = useState<Set<string>>(new Set())

  // 성적서 데이터
  const { certs, setCerts, errors: certErrors, progress: certProgress, certLoading, certDone, fetchCerts } = useCertData(groupNm)

  // items 로드 후 localStorage 캐시 자동 로드
  useEffect(() => {
    if (!items.length || certs.size > 0 || certLoading || certDone) return
    const acptNos = items.filter(i => i.acptNo).map(i => i.acptNo)
    const cached = loadCachedCerts(acptNos)
    if (cached.size > 0) {
      setCerts(cached)
    }
  }, [items, certs.size, certLoading, certDone, setCerts])

  // 상세 데이터 로딩
  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ktools/detail?groupNm=${encodeURIComponent(groupNm)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setItems(json.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : t.detail.queryFail)
    } finally {
      setLoading(false)
    }
  }, [groupNm])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  // 장비 이미지 검색
  useEffect(() => {
    if (!items.length) return
    const info = items[0]
    const q = [info.prdnCmpnNm, info.stszNm].filter(Boolean).join(' ')
    if (!q.trim()) { setImageLoading(false); return }

    const params = new URLSearchParams({ q })

    setImageLoading(true)
    setImageError(false)
    fetch(`/api/images/search?${params}`)
      .then(res => res.json())
      .then(json => {
        if (json.thumbnailUrl || json.imageUrl) {
          setThumbnailUrl(json.thumbnailUrl || null)
          setImageUrl(json.imageUrl || null)
        } else {
          setImageError(true)
        }
      })
      .catch(() => setImageError(true))
      .finally(() => setImageLoading(false))
  }, [items])

  // ESC로 모달 닫기 또는 뒤로가기
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedCert) setSelectedCert(null)
        else onBack()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onBack, selectedCert])

  const info = items[0]

  const tableData: TableRow[] = useMemo(() =>
    [...items]
      .sort((a, b) => (b.rcpnYmd ?? '').localeCompare(a.rcpnYmd ?? ''))
      .map((item, idx) => ({ ...item, no: idx + 1 })),
    [items]
  )

  // 타임라인 데이터 (접수일 기준 오름차순)
  const timelineData = useMemo(() =>
    [...items]
      .filter(item => item.rcpnYmd)
      .sort((a, b) => a.rcpnYmd.localeCompare(b.rcpnYmd))
      .map(item => {
        const rcpn = parseYmd(item.rcpnYmd)
        const exrs = parseYmd(item.exrsWrtnYmd)
        return {
          rcpnYmd: item.rcpnYmd,
          exrsWrtnYmd: item.exrsWrtnYmd,
          prjcCd: item.prjcCd,
          pgstNm: item.pgstNm,
          소요일: rcpn && exrs ? daysBetween(rcpn, exrs) : null,
          acptNo: item.acptNo,
        }
      }),
    [items]
  )

  // 연차별 적합성검토 트렌드 데이터
  // X축: 측정포인트, Y축: 오차값, 각 라인: 교정연차별
  const conformityTrend = useMemo(() => {
    if (certs.size < 1) return null

    // 1. 교정일 기준 시간순 정렬 + 구조화 데이터 있는 건만
    const sorted = Array.from(certs.entries())
      .filter(([, c]) => c.교정일 && c.측정결과.some(mp => mp.오차 != null || mp.기준값 != null))
      .sort((a, b) => (a[1].교정일 ?? '').localeCompare(b[1].교정일 ?? ''))

    if (sorted.length < 1) return null

    // 2. 연차별 라벨 (범례용): 교정일에서 연도 추출, 중복 시 전체 날짜
    const calDates = sorted.map(([, c]) => c.교정일 ?? '')
    const years = calDates.map(d => d.slice(0, 4))
    const hasDuplicateYear = years.some((y, i) => years.indexOf(y) !== i)
    const yearLabels = hasDuplicateYear ? calDates : years

    // 3. 물리량 그룹 수집 (모든 cert에서)
    const allQuantities = new Set<string>()
    for (const [, cert] of sorted) {
      const groups = groupByQuantity(cert.측정결과)
      for (const key of groups.keys()) allQuantities.add(key)
    }
    const quantityKeys = Array.from(allQuantities)

    // 4. 물리량별 트렌드 빌드
    function buildTrendForMeasurements(
      measurements: (mp: MeasurementPoint, idx: number) => boolean
    ) {
      const mpOrderLocal: { key: string; label: string; unit: string }[] = []
      const mpKeySet = new Set<string>()
      for (const [, cert] of sorted) {
        cert.측정결과.forEach((mp, idx) => {
          if (!measurements(mp, idx)) return
          const key = mpKey(mp, idx)
          if (!mpKeySet.has(key)) {
            mpKeySet.add(key)
            const label = mp.기준값 != null
              ? `${normalizeRef(mp.기준값)}${mp.기준단위 ? ' ' + mp.기준단위 : ''}`
              : `측정점 ${idx + 1}`
            mpOrderLocal.push({ key, label, unit: mp.오차단위 || mp.기준단위 || '' })
          }
        })
      }

      if (mpOrderLocal.length === 0) return null

      const chartData: Record<string, string | number | null>[] = mpOrderLocal.map(mp => {
        const point: Record<string, string | number | null> = { 측정포인트: mp.label }
        for (let ci = 0; ci < sorted.length; ci++) {
          const [, cert] = sorted[ci]
          const yearLabel = yearLabels[ci]
          const matched = cert.측정결과.find((m, idx) => mpKey(m, idx) === mp.key)
          point[yearLabel] = matched ? parseNum(matched.오차) : null
        }
        // 허용오차 상한/하한 (최신 cert 기준)
        for (let ci = sorted.length - 1; ci >= 0; ci--) {
          const [, cert] = sorted[ci]
          const matched = cert.측정결과.find((m, idx) => mpKey(m, idx) === mp.key)
          if (matched) {
            const tol = parseNum(matched.허용오차)
            if (tol != null) {
              point['허용상한'] = Math.abs(tol)
              point['허용하한'] = -Math.abs(tol)
            }
            break
          }
        }
        return point
      })

      const series = mpOrderLocal.map(mp => {
        const points = sorted.map(([, cert], ci) => {
          const matched = cert.측정결과.find((m, idx) => mpKey(m, idx) === mp.key)
          const errNum = matched ? parseNum(matched.오차) : null
          const tolNum = matched ? parseNum(matched.허용오차) : null
          // 오차와 허용오차의 단위가 같은 경우에만 비율 계산 (% vs N·cm 등 불일치 방지)
          const unitsCompatible = matched?.오차단위 && matched?.허용오차단위
            ? matched.오차단위 === matched.허용오차단위
            : true  // 단위 정보 없으면 기존 동작 유지
          const ratio = errNum != null && tolNum != null && tolNum !== 0 && unitsCompatible
            ? Math.round((Math.abs(errNum) / Math.abs(tolNum)) * 1000) / 10
            : null
          return {
            교정일: calDates[ci],
            yearLabel: yearLabels[ci],
            오차: errNum,
            허용오차: tolNum,
            비율: ratio,
            판정: matched?.판정 ?? 'PASS',
          }
        })
        return { key: mp.key, label: mp.label, unit: mp.unit, points }
      })

      const evaluation = evaluateTrends(series, t)

      return { series, chartData, mpOrder: mpOrderLocal, evaluation }
    }

    // 5. 물리량별 트렌드 맵 생성
    const byQuantity = new Map<string, NonNullable<ReturnType<typeof buildTrendForMeasurements>>>()
    for (const q of quantityKeys) {
      const trend = buildTrendForMeasurements((mp, idx) => {
        const qKey = mp.물리량 ?? inferQuantityFromUnit(mp.기준단위 || mp.오차단위 || mp.지시단위 || null) ?? '전체'
        return qKey === q
      })
      if (trend) byQuantity.set(q, trend)
    }

    // 6. 전체 통합 (기존 호환)
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
          const matched = cert.측정결과.find((m, idx) => mpKey(m, idx) === mp.key)
          if (matched) return parseNum(matched.허용오차)
        }
        return null
      }),
      byQuantity,
      quantityKeys,
    }
  }, [certs, t])

  // D-day 계산
  const dday = useMemo(() => {
    if (!info?.nxtrExrsYmd || info.nxtrExrsYmd.length < 8) return null
    const target = parseYmd(info.nxtrExrsYmd)!
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
  }, [info])

  // 로딩 스켈레톤
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          <div className="lg:col-span-2 h-64 bg-gray-100 rounded-xl animate-pulse" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  // 에러
  if (error) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {t.detail.back}
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <button onClick={fetchDetail} className="mt-3 px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
            {t.detail.retry}
          </button>
        </div>
      </div>
    )
  }

  if (!info) return null

  return (
    <div className="space-y-6">
      {/* ===== 헤더 ===== */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-800 truncate">{equipmentName || t.detail.equipmentDetail}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {info.prdNm && <span className="text-slate-600 font-medium">{info.prdNm}</span>}
            {info.prdNm && (info.prdnCmpnNm || info.stszNm) && <span> · </span>}
            {info.prdnCmpnNm}{info.stszNm && ` · ${info.stszNm}`}
          </p>
        </div>
        {dday !== null && <DdayBadge dday={dday} />}
      </div>

      {/* ===== 장비 프로필 (이미지 + 정보) ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 이미지 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center justify-center min-h-[240px]">
          {imageLoading ? (
            <div className="w-full h-full bg-gray-50 rounded-lg animate-pulse flex items-center justify-center min-h-[200px]">
              <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          ) : (thumbnailUrl || imageUrl) && !imageError ? (
            <img
              src={thumbnailUrl || imageUrl!}
              alt={equipmentName}
              className="max-w-full max-h-[240px] object-contain rounded-lg"
              onError={() => {
                // 썸네일 실패 시 원본 시도, 원본도 실패 시 에러
                if (thumbnailUrl && imageUrl) {
                  setThumbnailUrl(null)
                } else {
                  setImageError(true)
                }
              }}
            />
          ) : (
            <div className="w-full min-h-[200px] bg-gray-50 rounded-lg flex flex-col items-center justify-center text-gray-400">
              <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="text-xs">{t.detail.noImage}</span>
            </div>
          )}
        </div>

        {/* 장비 정보 카드 */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 장비 식별 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <SectionHeader
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />}
              title={t.detail.equipmentInfo}
              color="text-slate-400"
            />
            <div className="space-y-2.5">
              <InfoRow label={t.detail.manufacturer} value={info.prdnCmpnNm} />
              <InfoRow label={t.detail.model} value={info.stszNm} />
              <InfoRow label={t.detail.deviceNo} value={info.mctlNo} />
              <InfoRow label={t.detail.mgmtNo} value={info.custEqpmSrno} />
              <InfoRow label={t.detail.productName} value={info.prdNm} />
            </div>
          </div>

          {/* 교정 관리 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <SectionHeader
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
              title={t.detail.calMgmt}
              color="text-blue-400"
            />
            <div className="space-y-2.5">
              <InfoRow label={t.detail.calCycle} value={info.affcCyclCd ? `${info.affcCyclCd}${t.detail.months}` : '-'} />
              <InfoRow label={t.detail.nextCal} value={fmtDate(info.nxtrExrsYmd)} />
              <InfoRow label={t.detail.latestCal} value={fmtDate(info.exrsWrtnYmd)} />
              <InfoRow label={t.detail.calHistory} value={fmt(t.detail.historyUnit, items.length)} />
              <InfoRow label={t.detail.manager} value={info.mngmRsprNm} />
            </div>
          </div>
        </div>
      </div>

      {/* ===== 교정 이력 타임라인 ===== */}
      {timelineData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-5">{t.detail.calTimeline}</h3>
          <div className="overflow-x-auto">
            <div className="flex items-start gap-0 min-w-max px-4 pb-2">
              {timelineData.map((item, idx) => {
                const isLast = idx === timelineData.length - 1
                const statusColor = item.pgstNm.includes('완료') ? 'bg-green-500' :
                  item.pgstNm.includes('미처리') ? 'bg-amber-500' : 'bg-blue-500'

                let gapDays: number | null = null
                if (!isLast) {
                  const curEnd = parseYmd(item.exrsWrtnYmd)
                  const nextStart = parseYmd(timelineData[idx + 1].rcpnYmd)
                  if (curEnd && nextStart) {
                    gapDays = daysBetween(curEnd, nextStart)
                  }
                }

                return (
                  <div key={item.acptNo} className="flex items-start">
                    <div className="flex flex-col items-center min-w-[120px] group relative">
                      <div className={`w-3.5 h-3.5 rounded-full ${statusColor} ring-4 ring-white shadow-sm z-10`} />
                      <div className="mt-2 text-center">
                        <p className="text-xs font-medium text-slate-700">{fmtDate(item.rcpnYmd)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{item.prjcCd}</p>
                        {item.소요일 !== null && (
                          <p className="text-[10px] text-blue-500 mt-0.5">{fmt(t.detail.elapsed, item.소요일)}</p>
                        )}
                        <span className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          item.pgstNm.includes('완료') ? 'bg-green-50 text-green-600' :
                          item.pgstNm.includes('미처리') ? 'bg-amber-50 text-amber-600' :
                          'bg-gray-50 text-gray-500'
                        }`}>{item.pgstNm}</span>
                      </div>
                    </div>
                    {!isLast && (
                      <div className="flex flex-col items-center mt-[6px]">
                        <div className="w-20 h-0.5 bg-gray-200" />
                        {gapDays !== null && (
                          <span className="text-[10px] text-slate-400 mt-1 whitespace-nowrap">
                            {fmt(t.detail.gapDays, gapDays)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== 교정성적서 분석 ===== */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-700">{t.detail.certAnalysis}</h3>

          {/* 상태 배지 + 버튼 */}
          <div className="ml-auto flex items-center gap-2">
            {certDone && certs.size > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-600 rounded-full">
                {fmt(t.detail.certDone, certs.size)}
              </span>
            )}
            {certErrors.size > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-red-50 text-red-500 rounded-full">
                {fmt(t.detail.certFail, certErrors.size)}
              </span>
            )}
            {!certLoading && !certDone && (
              <button
                onClick={() => fetchCerts()}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
              >
                {t.detail.loadCerts}
              </button>
            )}
            {certDone && (
              <button
                onClick={() => fetchCerts(true)}
                className="px-2 py-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
              >
                {t.detail.refresh}
              </button>
            )}
          </div>
        </div>

        {/* 프로그레스바 — 완료(cert + error) 기준 */}
        {certLoading && certProgress.total > 0 && (() => {
          const completed = certs.size + certErrors.size
          return (
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span>
                  {certProgress.status === 'cached' ? t.detail.certCached : certProgress.status === 'downloading' ? t.detail.certDownloading : t.detail.certAnalyzing}
                  {certProgress.acptNo && <span className="text-slate-400 ml-1">({certProgress.acptNo})</span>}
                </span>
                <span className="font-medium">{completed} / {certProgress.total}</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${(completed / certProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )
        })()}

        {/* 로딩 중 스피너 (total 아직 모를 때) */}
        {certLoading && certProgress.total === 0 && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t.detail.certLoading}
          </div>
        )}

        {/* 미시작 상태 */}
        {!certLoading && !certDone && certs.size === 0 && (
          <div className="bg-slate-50 rounded-lg p-4 border border-dashed border-slate-200">
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.detail.certDesc}
            </p>
          </div>
        )}

        {/* 성적서 결과 테이블 */}
        {certs.size > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.acptNo}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.manufacturer}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.model}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.deviceNo}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.mgmtNo}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.calDate}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.nextCalDateLabel}</th>
                  <th className="text-center py-2 px-2 text-slate-400 font-medium">{t.detail.verdict}</th>
                  <th className="text-center py-2 px-2 text-slate-400 font-medium">{t.detail.mpCount}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(certs.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([acptNo, cert]) => (
                  <tr
                    key={acptNo}
                    className="border-b border-gray-50 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedCert({ acptNo, cert })}
                  >
                    <td className="py-2 px-2 font-mono text-slate-500">{acptNo}</td>
                    <td className="py-2 px-2 text-slate-700">{cert.제조사 || '-'}</td>
                    <td className="py-2 px-2 text-slate-700">{cert.모델 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.시리얼 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.관리번호 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.교정일 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.차기교정일 || '-'}</td>
                    <td className="py-2 px-2 text-center">
                      {cert.전체판정 === 'PASS' ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">PASS</span>
                      ) : cert.전체판정 === 'FAIL' ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">FAIL</span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center text-slate-500">{cert.측정포인트수 || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 에러 건 목록 */}
        {certErrors.size > 0 && (
          <div className="mt-3 space-y-1">
            {Array.from(certErrors.entries()).map(([acptNo, errMsg]) => (
              <div key={acptNo} className="flex items-center gap-2 text-xs text-red-500 bg-red-50 rounded px-3 py-1.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-mono">{acptNo}</span>
                <span className="text-red-400">{errMsg}</span>
              </div>
            ))}
          </div>
        )}


        {/* 완료 + 결과 0건 */}
        {certDone && certs.size === 0 && certErrors.size === 0 && (
          <div className="text-center py-6 text-sm text-slate-400">
            {t.detail.noCertResult}
          </div>
        )}
      </div>

      {/* ===== 연차별 적합성검토 트렌드 ===== */}
      {conformityTrend && (() => {
        const hasMultiQ = conformityTrend.quantityKeys.length > 1
        const activeQ = activeTrendQuantity && conformityTrend.byQuantity.has(activeTrendQuantity)
          ? activeTrendQuantity : null
        const currentTrend = activeQ
          ? conformityTrend.byQuantity.get(activeQ)!
          : conformityTrend
        const isSingleCert = conformityTrend.certCount === 1

        return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="flex flex-col">
              <h3 className="text-sm font-semibold text-slate-800">{t.detail.trendTitle}</h3>
              <span className="text-[10px] text-slate-400 tracking-wide">{t.detail.trendSub}</span>
            </div>
            <span className="px-2.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded-full border border-slate-200">
              {fmt(t.detail.trendCount, conformityTrend.certCount)}
            </span>
            <div className="ml-auto">
              <StabilityBadge level={currentTrend.evaluation.stability} />
            </div>
          </div>

          {/* 물리량 탭 */}
          {hasMultiQ && (
            <div className="flex gap-1 mb-4 bg-gray-50 rounded-lg p-1">
              <button
                onClick={() => setActiveTrendQuantity(null)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  !activeQ ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.detail.allQuantities}
              </button>
              {conformityTrend.quantityKeys.filter(q => q !== '전체').map(q => (
                <button
                  key={q}
                  onClick={() => setActiveTrendQuantity(q)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    activeQ === q ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {quantityLabel(q, lang, t.detail.allQuantities)}
                </button>
              ))}
            </div>
          )}

          {/* 오차 추이 차트: X축=측정포인트, Y축=오차, 라인=연차별, 허용오차 밴드 */}
          {(() => {
            const totalYears = conformityTrend.yearLabels.length
            const hasTolerance = currentTrend.chartData.some(d => d['허용상한'] != null)
            return (
              <ResponsiveContainer key={activeQ ?? '__all__'} width="100%" height={300}>
                <ComposedChart data={currentTrend.chartData} margin={{ left: 15, right: 15, top: 10, bottom: 5 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e8ecf1" />
                  <XAxis
                    dataKey="측정포인트"
                    tick={{ fontSize: 10, fill: '#475569' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    angle={-30}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    label={currentTrend.mpOrder[0]?.unit ? {
                      value: fmt(t.detail.errorAxis, currentTrend.mpOrder[0].unit),
                      angle: -90, position: 'insideLeft',
                      style: { fontSize: 11, fill: '#64748b' },
                      offset: -5,
                    } : undefined}
                  />
                  <Tooltip content={<TrendChartTooltip yearLabels={conformityTrend.yearLabels} unit={currentTrend.mpOrder[0]?.unit ?? ''} />} />
                  {/* 허용오차 밴드 — 중성적 인디고 계열 */}
                  {hasTolerance && (
                    <>
                      <Area dataKey="허용상한" fill="#dbeafe" stroke="none" fillOpacity={0.45} isAnimationActive={false} />
                      <Area dataKey="허용하한" fill="#dbeafe" stroke="none" fillOpacity={0.45} isAnimationActive={false} />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />
                    </>
                  )}
                  {conformityTrend.yearLabels.map((label, i) => {
                    const isLatest = i === totalYears - 1
                    const color = TREND_COLORS[i % TREND_COLORS.length]
                    const isHidden = hiddenYears.has(label)
                    return (
                      <Line
                        key={label}
                        dataKey={label}
                        name={label}
                        stroke={color}
                        strokeWidth={isLatest ? 2.5 : 1.5}
                        strokeOpacity={isLatest ? 1 : 0.55}
                        dot={{ r: isLatest ? 3.5 : 2.5, fill: color, strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                        connectNulls
                        hide={isHidden}
                      />
                    )
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            )
          })()}

          {/* 범례 */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-3 text-[11px]">
            {currentTrend.chartData.some(d => d['허용상한'] != null) && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <svg width="20" height="10"><rect x="0" y="2" width="20" height="6" rx="1" fill="#dbeafe" opacity="0.7" /><line x1="0" y1="5" x2="20" y2="5" stroke="#93c5fd" strokeWidth="1" strokeDasharray="2 2" /></svg>
                <span>{t.detail.tolerance}</span>
              </div>
            )}
            {conformityTrend.yearLabels.map((label, i) => {
              const isLatest = i === conformityTrend.yearLabels.length - 1
              const color = TREND_COLORS[i % TREND_COLORS.length]
              const isHidden = hiddenYears.has(label)
              return (
                <button
                  key={label}
                  className="flex items-center gap-1.5 cursor-pointer select-none transition-opacity hover:opacity-80"
                  onClick={() => setHiddenYears(prev => {
                    const next = new Set(prev)
                    if (next.has(label)) next.delete(label); else next.add(label)
                    return next
                  })}
                >
                  <svg width="18" height="10" className={isHidden ? 'opacity-25' : ''}>
                    <line x1="0" y1="5" x2="18" y2="5" stroke={color} strokeWidth={isLatest ? 2.5 : 1.5} opacity={isLatest ? 1 : 0.55} />
                    <circle cx="9" cy="5" r="2.5" fill={color} stroke="#fff" strokeWidth="1.5" />
                  </svg>
                  <span className={`${isLatest ? 'font-bold text-slate-700' : 'text-slate-500'} ${isHidden ? 'line-through opacity-40' : ''}`}>{label}</span>
                </button>
              )
            })}
          </div>

          {/* 트렌드 요약 테이블 */}
          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-800">
                  <th className="text-left py-2 px-2.5 text-slate-300 font-semibold whitespace-nowrap text-[11px]">{t.detail.mpHeader}</th>
                  {conformityTrend.yearLabels.map(y => (
                    !hiddenYears.has(y) && <th key={y} className="text-center py-2 px-2.5 text-slate-300 font-semibold whitespace-nowrap text-[11px]">{y}</th>
                  ))}
                  <th className="text-center py-2 px-2.5 text-slate-300 font-semibold text-[11px]">{t.detail.trendCol}</th>
                  <th className="text-center py-2 px-2.5 text-slate-300 font-semibold text-[11px]">{t.detail.statusCol}</th>
                </tr>
              </thead>
              <tbody>
                {currentTrend.series.map((s, si) => {
                  const errors = s.points.map(p => p.오차).filter((v): v is number => v != null)
                  const absErrors = errors.map(Math.abs)
                  // 추세: 증가/감소 모두 "변화"로 표시 (교정 관점: 변화 자체가 위험)
                  const trend = absErrors.length >= 2
                    ? absErrors[absErrors.length - 1] > absErrors[0] * 1.1 ? 'up'
                    : absErrors[absErrors.length - 1] < absErrors[0] * 0.9 ? 'down'
                    : 'stable'
                    : 'stable'

                  const lastRatio = [...s.points].reverse().find(p => p.비율 != null)?.비율
                  const hasFail = s.points.some(p => p.판정 === 'FAIL')
                  // 상태: 증가든 감소든 변화가 있으면 주의 (안정만 양호)
                  const hasChange = trend !== 'stable'
                  const level = hasFail || (lastRatio != null && lastRatio > 100) ? 'danger'
                    : (lastRatio != null && lastRatio > 80) || hasChange ? 'warning'
                    : 'safe'

                  return (
                    <tr key={s.key} className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${si % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                      <td className="py-2 px-2.5 font-semibold text-slate-700 whitespace-nowrap">{s.label}</td>
                      {s.points.map((p, pi) => {
                        if (hiddenYears.has(conformityTrend.yearLabels[pi])) return null
                        // 오차 색상: FAIL=빨간배경, 음수=파랑, 양수=주황, 0=회색
                        let cellStyle = 'text-slate-500'
                        let cellBg = ''
                        if (p.오차 != null) {
                          if (p.판정 === 'FAIL') {
                            cellBg = 'bg-red-600 text-white font-bold rounded'
                            cellStyle = ''
                          } else if (p.오차 > 0) {
                            cellStyle = 'text-amber-700 font-medium'
                          } else if (p.오차 < 0) {
                            cellStyle = 'text-blue-700 font-medium'
                          } else {
                            cellStyle = 'text-slate-400'
                          }
                        }
                        return (
                          <td key={conformityTrend.yearLabels[pi]} className="py-2 px-2.5 text-center font-mono whitespace-nowrap">
                            {p.오차 != null ? (
                              <span className={`${cellStyle} ${cellBg ? `inline-block px-1.5 py-0.5 ${cellBg}` : ''}`}>
                                {p.오차 > 0 ? '+' : ''}{p.오차}
                                {s.unit && !cellBg && <span className="text-slate-300 text-[10px] ml-0.5">{s.unit}</span>}
                              </span>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                        )
                      })}
                      <td className="py-2 px-2.5 text-center">
                        {isSingleCert
                          ? <span className="text-slate-300 text-xs" title="데이터 부족">&mdash;</span>
                          : trend === 'up' ? (
                            <svg className="w-4 h-4 text-red-500 inline-block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M8 12V4M8 4l3 3M8 4L5 7" />
                            </svg>
                          ) : trend === 'down' ? (
                            <svg className="w-4 h-4 text-amber-500 inline-block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M8 4v8M8 12l3-3M8 12L5 9" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-slate-400 inline-block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 8h10M13 8l-3-3M13 8l-3 3" />
                            </svg>
                          )}
                      </td>
                      <td className="py-2 px-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          level === 'safe' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : level === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {level === 'safe' ? t.detail.safe : level === 'warning' ? t.detail.warning : t.detail.danger}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 종합 평가 */}
          {currentTrend.evaluation.riskPoints.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{t.detail.stabilityEval}</span>
                <StabilityBadge level={currentTrend.evaluation.stability} />
              </div>
              <div className="space-y-2">
                {currentTrend.evaluation.riskPoints.map((rp, i) => {
                  // 위험도 분류: FAIL/초과/위험 키워드 → 빨강, 증가/주의 → 주황, 나머지 → 파랑
                  const isDanger = /FAIL|초과|위험|100%/.test(rp)
                  const isWarning = /증가|주의|불안정|80%/.test(rp)
                  const borderColor = isDanger ? 'border-l-red-500' : isWarning ? 'border-l-amber-500' : 'border-l-blue-400'
                  const iconColor = isDanger ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-blue-400'
                  const iconPath = isDanger
                    ? 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
                    : isWarning
                    ? 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  return (
                    <div key={i} className={`flex items-start gap-2.5 pl-3 py-2 border-l-[3px] ${borderColor} bg-white rounded-r-md`}>
                      <svg className={`w-3.5 h-3.5 ${iconColor} mt-0.5 shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
                      </svg>
                      <span className="text-xs text-slate-600 leading-relaxed">{rp}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        )
      })()}

      {/* ===== AI 교정 지시서 ===== */}
      {conformityTrend && (
        <CalibrationInstructionPanel
          series={conformityTrend.series}
          calDates={conformityTrend.calDates}
          certCount={conformityTrend.certCount}
          affcCyclCd={info.affcCyclCd}
          equipmentName={equipmentName}
          manufacturer={info.prdnCmpnNm || ''}
          model={info.stszNm || ''}
          byQuantity={conformityTrend.byQuantity}
          quantityKeys={conformityTrend.quantityKeys}
        />
      )}

      {/* ===== 장비 건강검진 AI ===== */}
      {conformityTrend ? (
        <EquipmentHealthPanel
          series={conformityTrend.series}
          calDates={conformityTrend.calDates}
          certCount={conformityTrend.certCount}
          affcCyclCd={info.affcCyclCd}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AiPlaceholder
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />}
            title={t.detail.aiHealthTitle}
            description={t.detail.aiHealthDesc}
          />
          <AiPlaceholder
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
            title={t.detail.aiCycleTitle}
            description={t.detail.aiCycleDesc}
          />
        </div>
      )}

      {/* ===== 교정 이력 상세 테이블 ===== */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">{t.detail.historyDetail}</h3>
        {tableData.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{t.detail.noHistory}</div>
        ) : (
          <DataTable
            columns={columns}
            data={tableData}
            rowKey={i => `${i.acptNo}-${i.no}`}
            defaultSort={{ key: 'no', direction: 'asc' }}
          />
        )}
      </div>

      {/* ===== 성적서 파싱 결과 모달 ===== */}
      {selectedCert && (
        <CertDetailModal
          acptNo={selectedCert.acptNo}
          cert={selectedCert.cert}
          onClose={() => setSelectedCert(null)}
        />
      )}
    </div>
  )
}

// === 하위 컴포넌트 ===

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-gray-400 whitespace-nowrap min-w-[56px]">{label}</span>
      <span className="text-sm text-gray-800 font-medium truncate" title={value}>{value || '-'}</span>
    </div>
  )
}

function SectionHeader({ icon, title, color }: { icon: ReactNode; title: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icon}
      </svg>
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
    </div>
  )
}

function DdayBadge({ dday }: { dday: number }) {
  const { t } = useT()
  let label: string
  let color: string

  if (dday < 0) {
    const abs = Math.abs(dday)
    if (abs >= 365) {
      const y = Math.floor(abs / 365)
      const m = Math.floor((abs % 365) / 30)
      label = m > 0 ? fmt(t.time.yearMonthOver, y, m) : fmt(t.time.yearOver, y)
    } else if (abs >= 30) {
      label = fmt(t.time.monthOver, Math.floor(abs / 30))
    } else {
      label = fmt(t.time.dayOver, abs)
    }
    color = 'text-red-600 bg-red-50 border-red-200'
  } else if (dday === 0) {
    label = t.detail.todayExpired
    color = 'text-red-600 bg-red-50 border-red-200'
  } else if (dday <= 30) {
    label = `D-${dday}`
    color = 'text-orange-600 bg-orange-50 border-orange-200'
  } else if (dday <= 60) {
    label = `D-${dday}`
    color = 'text-amber-600 bg-amber-50 border-amber-200'
  } else if (dday <= 90) {
    label = `D-${dday}`
    color = 'text-blue-600 bg-blue-50 border-blue-200'
  } else {
    label = `D-${dday}`
    color = 'text-green-600 bg-green-50 border-green-200'
  }

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-bold border ${color}`}>
      {label}
    </span>
  )
}

function CertDetailModal({ acptNo, cert, onClose }: { acptNo: string; cert: CertResult; onClose: () => void }) {
  const { t, lang } = useT()
  const quantityGroups = useMemo(() => groupByQuantity(cert.측정결과), [cert.측정결과])
  const quantityKeys = useMemo(() => Array.from(quantityGroups.keys()), [quantityGroups])
  const hasMultiQuantity = quantityKeys.length > 1
  const [activeQuantity, setActiveQuantity] = useState<string>(quantityKeys[0] || '전체')
  const currentMeasurements = hasMultiQuantity
    ? (quantityGroups.get(activeQuantity) ?? cert.측정결과)
    : cert.측정결과

  // [i18nLabel, value, originalKoKey(for _llm_보강 matching)]
  const fields: [string, string | null, string][] = [
    [t.detail.certNo, cert.성적서번호, '성적서번호'],
    [t.detail.customer, cert.고객명, '고객명'],
    [t.detail.equipName, cert.장비명, '장비명'],
    [t.detail.manufacturer, cert.제조사, '제조사'],
    [t.detail.model, cert.모델, '모델'],
    [t.detail.deviceNo, cert.시리얼, '기기번호'],
    [t.detail.mgmtNo, cert.관리번호, '관리번호'],
    [t.detail.calDate, cert.교정일, '교정일'],
    [t.detail.nextCalDateLabel, cert.차기교정일, '차기교정일'],
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{t.detail.parseResult}</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{acptNo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 기본정보 */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t.detail.basicInfo}</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {fields.map(([label, value, koKey]) => (
                <div key={koKey} className="flex items-baseline gap-2">
                  <span className="text-[11px] text-gray-400 min-w-[60px] shrink-0">{label}</span>
                  <span className={`text-xs font-medium truncate ${
                    cert._llm_보강.includes(koKey) ? 'text-indigo-600' : 'text-slate-700'
                  }`} title={value || '-'}>
                    {value || '-'}
                    {cert._llm_보강.includes(koKey) && (
                      <span className="ml-1 text-[9px] text-indigo-400">(AI)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 적합성검토 */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t.detail.conformity}</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400">{t.detail.conformityDoc}</span>
                <span className={`text-xs font-medium ${cert.적합성검토 ? 'text-green-600' : 'text-slate-400'}`}>
                  {cert.적합성검토 ? t.detail.exists : t.detail.notExists}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400">{t.detail.overallVerdict}</span>
                {cert.전체판정 === 'PASS' ? (
                  <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-bold">PASS</span>
                ) : cert.전체판정 === 'FAIL' ? (
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-bold">FAIL</span>
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400">{t.detail.mpCount}</span>
                <span className="text-xs font-medium text-slate-700">{fmt(t.detail.mpCountUnit, cert.측정포인트수)}</span>
              </div>
            </div>

            {/* 물리량 탭 */}
            {hasMultiQuantity && (
              <div className="flex gap-1 mb-3 bg-gray-50 rounded-lg p-1">
                {quantityKeys.map(q => (
                  <button
                    key={q}
                    onClick={() => setActiveQuantity(q)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      activeQuantity === q
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {quantityLabel(q, lang, t.detail.allQuantities)}
                    <span className="ml-1 text-[10px] text-gray-400">({quantityGroups.get(q)?.length ?? 0})</span>
                  </button>
                ))}
              </div>
            )}

            {/* 측정결과 테이블 */}
            {currentMeasurements.length > 0 && (() => {
              // LLM 구조화 데이터 유무 판별
              const hasStructured = currentMeasurements.some(mp => mp.기준값 != null || mp.지시값 != null)

              if (hasStructured) {
                // 구조화된 테이블 (LLM 파싱 결과)
                // 사용 가능한 컬럼만 표시
                const cols: { key: string; label: string; unitKey: string }[] = [
                  { key: '기준값', label: t.detail.refValue, unitKey: '기준단위' },
                  { key: '지시값', label: t.detail.indication, unitKey: '지시단위' },
                  { key: '오차', label: t.detail.error, unitKey: '오차단위' },
                  { key: '허용오차', label: t.detail.toleranceVal, unitKey: '허용오차단위' },
                ]
                const usedCols = cols.filter(c =>
                  currentMeasurements.some(mp => (mp as unknown as Record<string, unknown>)[c.key] != null)
                )

                return (
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-center py-1.5 px-2 text-gray-400 font-medium">#</th>
                          {usedCols.map(c => (
                            <th key={c.key} className="text-center py-1.5 px-2 text-gray-400 font-medium whitespace-nowrap">
                              {c.label}
                            </th>
                          ))}
                          <th className="text-center py-1.5 px-2 text-gray-400 font-medium">{t.detail.verdict}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentMeasurements.map((mp, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="py-1.5 px-2 text-gray-400 text-center">{i + 1}</td>
                            {usedCols.map(c => {
                              const val = (mp as unknown as Record<string, unknown>)[c.key] as string | null
                              const unit = (mp as unknown as Record<string, unknown>)[c.unitKey] as string | null
                              return (
                                <td key={c.key} className="py-1.5 px-2 text-center whitespace-nowrap font-mono text-slate-600">
                                  {val ?? '-'}
                                  {unit && <span className="text-slate-400 text-[10px] ml-0.5">{unit}</span>}
                                </td>
                              )
                            })}
                            <td className="py-1.5 px-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                mp.판정 === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>{mp.판정}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }

              // Fallback: 원본데이터 텍스트
              return (
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left py-1.5 px-2 text-gray-400 font-medium">#</th>
                        <th className="text-left py-1.5 px-2 text-gray-400 font-medium">{t.detail.dataCol}</th>
                        <th className="text-center py-1.5 px-2 text-gray-400 font-medium">{t.detail.verdict}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentMeasurements.map((mp, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-1.5 px-2 text-gray-400">{i + 1}</td>
                          <td className="py-1.5 px-2 text-slate-600 font-mono">{mp.원본데이터.join(' | ')}</td>
                          <td className="py-1.5 px-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              mp.판정 === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>{mp.판정}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </section>

          {/* 불일치 항목 */}
          {cert.불일치.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">{t.detail.discrepancy}</h3>
              <div className="space-y-1.5">
                {cert.불일치.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                    <svg className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="leading-relaxed">
                      <span className="font-medium text-amber-700">{item.항목}</span>
                      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 bg-white rounded text-amber-700 font-mono">{item.갑지}</span>
                        <span className="text-amber-400 text-[10px]">{t.detail.coverSheet}</span>
                        <span className="text-amber-300 mx-0.5">vs</span>
                        <span className="px-1.5 py-0.5 bg-white rounded text-amber-700 font-mono">{item.적합성검토}</span>
                        <span className="text-amber-400 text-[10px]">{t.detail.conformDoc}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI 보강 정보 */}
          {cert._llm_provider && (
            <section>
              <h3 className="text-xs font-semibold text-indigo-500 uppercase tracking-wide mb-2">{t.detail.aiEnhance}</h3>
              <div className="bg-indigo-50/50 rounded-lg p-3 border border-indigo-100">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-indigo-400">{t.detail.aiAnalysis}</span>
                  <span className="font-medium text-indigo-600">KTL AI</span>
                  {cert._llm_보강.length > 0 && (
                    <>
                      <span className="text-indigo-300">|</span>
                      <span className="text-indigo-400">{t.detail.aiEnhancedFields}</span>
                      <span className="text-indigo-600">{cert._llm_보강.join(', ')}</span>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 메타 정보 */}
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{t.detail.meta}</h3>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>{fmt(t.detail.sheetCount, cert.시트수)}</span>
              <span className="text-slate-300">|</span>
              <span className="truncate" title={cert.시트목록.join(', ')}>{cert.시트목록.join(', ')}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function StabilityBadge({ level }: { level: 'safe' | 'warning' | 'danger' }) {
  const { t } = useT()
  const style = level === 'safe' ? 'bg-green-100 text-green-700'
    : level === 'warning' ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'
  const label = level === 'safe' ? t.detail.safe : level === 'warning' ? t.detail.warning : t.detail.danger
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${style}`}>{label}</span>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function TrendChartTooltip({ active, payload, label, yearLabels, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2.5 shadow-xl border border-slate-700 min-w-[160px]">
      <p className="text-slate-300 font-medium mb-1.5">{label}</p>
      {payload.filter((p: any) => p.value != null).map((p: any, i: number) => {
        const idx = yearLabels?.indexOf(p.dataKey) ?? -1
        return (
          <div key={i} className="flex items-center justify-between gap-3 py-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.stroke }} />
              <span className="text-slate-300">{p.dataKey}</span>
            </div>
            <span className="font-mono font-medium" style={{ color: TREND_COLORS[idx >= 0 ? idx % TREND_COLORS.length : 0] }}>
              {p.value}{unit ? ` ${unit}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function AiPlaceholder({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  const { t } = useT()
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="ml-auto px-2 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-500 rounded-full">
          {t.detail.aiReady}
        </span>
      </div>
      <div className="bg-slate-50 rounded-lg p-4 border border-dashed border-slate-200">
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}
