import { NextResponse } from 'next/server'
import { getAllCachedCerts, type CertResult } from '@/lib/cert-cache'

export interface ReportData {
  certStats: {
    totalCached: number
    passCount: number
    failCount: number
    noJudgment: number
  }
  guardBandStats: {
    conformant: number
    conditionalPass: number
    conditionalFail: number
    nonConformant: number
    noData: number
  }
  calibrationLabStats: {
    name: string
    certCount: number
    passRate: number    // 적합률 (%)
    avgUtRatio: number  // 평균 U/T 비율 (%)
  }[]
  utRatioDistribution: {
    safe: number
    warning: number
    danger: number
    noData: number
  }
  nonConformantList: {
    acptNo: string
    장비명: string | null
    판정: string
    guardBand: string | null
    교정일: string | null
  }[]
}

export async function GET() {
  const allCerts = getAllCachedCerts()

  // PASS/FAIL 집계
  let passCount = 0
  let failCount = 0
  let noJudgment = 0

  // Guard Band 집계 (측정포인트 단위)
  const gb = { conformant: 0, conditionalPass: 0, conditionalFail: 0, nonConformant: 0, noData: 0 }

  // 교정기관 집계 (적합률 + U/T 비율 포함)
  const labMap = new Map<string, { certCount: number; passCount: number; utRatios: number[] }>()

  // U/T 비율 분포 (측정포인트 단위)
  const ut = { safe: 0, warning: 0, danger: 0, noData: 0 }

  // 부적합/조건부 장비 리스트
  const nonConformantList: ReportData['nonConformantList'] = []

  for (const [acptNo, cert] of allCerts) {
    // PASS/FAIL
    if (cert.전체판정 === 'PASS') passCount++
    else if (cert.전체판정 === 'FAIL') failCount++
    else noJudgment++

    // 교정기관 (교정장소 또는 기준기에서 추출)
    const labName = cert.교정장소 || (cert.기준기?.[0]?.교정기관) || null
    if (labName) {
      const entry = labMap.get(labName) || { certCount: 0, passCount: 0, utRatios: [] }
      entry.certCount++
      if (cert.전체판정 === 'PASS') entry.passCount++
      labMap.set(labName, entry)
    }

    // 측정포인트별 불확도/Guard Band 분석
    let certHasGb = false
    let certWorstGb: string | null = null
    for (const mp of cert.측정결과 ?? []) {
      // U/T 비율
      const unc = mp.불확도 != null ? parseFloat(String(mp.불확도)) : null
      const tol = mp.허용오차 != null ? parseFloat(String(mp.허용오차)) : null
      if (unc != null && !isNaN(unc) && tol != null && !isNaN(tol) && Math.abs(tol) > 0) {
        const utRatio = (Math.abs(unc) / Math.abs(tol)) * 100
        if (utRatio <= 33) ut.safe++
        else if (utRatio <= 50) ut.warning++
        else ut.danger++
        // 기관별 U/T 수집
        if (labName) {
          const entry = labMap.get(labName)
          if (entry) entry.utRatios.push(utRatio)
        }
      } else {
        ut.noData++
      }

      // Guard Band 판정
      const err = mp.오차 != null ? parseFloat(String(mp.오차)) : null
      if (err != null && !isNaN(err) && unc != null && !isNaN(unc) && tol != null && !isNaN(tol) && Math.abs(tol) > 0) {
        // 단위 호환성 체크
        const uncUnitOk = !mp.불확도단위 || !mp.오차단위 || mp.불확도단위 === mp.오차단위
        if (uncUnitOk) {
          const absErr = Math.abs(err)
          const absTol = Math.abs(tol)
          if (absErr + unc <= absTol) {
            gb.conformant++
            certHasGb = true
          } else if (absErr <= absTol) {
            gb.conditionalPass++
            certHasGb = true
            if (!certWorstGb || certWorstGb === 'conformant') certWorstGb = 'conditional-pass'
          } else if (absErr <= absTol + unc) {
            gb.conditionalFail++
            certHasGb = true
            if (!certWorstGb || certWorstGb === 'conformant' || certWorstGb === 'conditional-pass') certWorstGb = 'conditional-fail'
          } else {
            gb.nonConformant++
            certHasGb = true
            certWorstGb = 'non-conformant'
          }
        } else {
          gb.noData++
        }
      } else if (unc == null || isNaN(unc as number)) {
        gb.noData++
      }
    }

    // 부적합/조건부 장비 수집
    if (cert.전체판정 === 'FAIL' || certWorstGb === 'conditional-pass' || certWorstGb === 'conditional-fail' || certWorstGb === 'non-conformant') {
      nonConformantList.push({
        acptNo,
        장비명: cert.장비명,
        판정: cert.전체판정 ?? '-',
        guardBand: certHasGb ? certWorstGb : null,
        교정일: cert.교정일,
      })
    }
  }

  // 교정기관 정렬 (건수 내림차순) + 적합률/평균U/T 계산
  const calibrationLabStats = Array.from(labMap.entries())
    .map(([name, entry]) => ({
      name,
      certCount: entry.certCount,
      passRate: entry.certCount > 0 ? Math.round((entry.passCount / entry.certCount) * 100) : 0,
      avgUtRatio: entry.utRatios.length > 0
        ? Math.round(entry.utRatios.reduce((s, v) => s + v, 0) / entry.utRatios.length * 10) / 10
        : 0,
    }))
    .sort((a, b) => b.certCount - a.certCount)

  const data: ReportData = {
    certStats: {
      totalCached: allCerts.size,
      passCount,
      failCount,
      noJudgment,
    },
    guardBandStats: {
      conformant: gb.conformant,
      conditionalPass: gb.conditionalPass,
      conditionalFail: gb.conditionalFail,
      nonConformant: gb.nonConformant,
      noData: gb.noData,
    },
    calibrationLabStats,
    utRatioDistribution: ut,
    nonConformantList,
  }

  return NextResponse.json(data)
}
