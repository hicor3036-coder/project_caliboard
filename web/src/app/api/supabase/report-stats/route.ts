// 아토믹 엔드포인트: ISO 10012 보고서용 통계
// ─ 도메인 규칙: Supabase 클라이언트만 호출
// ─ 옛 /api/ktools/report (cert-cache 의존)와 동일한 ReportData 형식 반환
// ─ 단, 성적서 파싱 도메인(cert)이 미정비이므로 cert 의존 필드는 0건 stub
//   cert 도메인이 재정비되면 별도 atom에서 합성하도록 후속 작업 예정
//
// GET /api/supabase/report-stats
//   응답: ReportData (management-report 컴포넌트와 1:1)

import { NextResponse } from 'next/server'

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
    passRate: number
    avgUtRatio: number
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
  // 현재는 cert 도메인 미정비 → 모든 필드 0건 반환
  // management-report는 hasCertData (totalCached > 0)로 분기하여 EmptyState 표시
  const stub: ReportData = {
    certStats: {
      totalCached: 0,
      passCount: 0,
      failCount: 0,
      noJudgment: 0,
    },
    guardBandStats: {
      conformant: 0,
      conditionalPass: 0,
      conditionalFail: 0,
      nonConformant: 0,
      noData: 0,
    },
    calibrationLabStats: [],
    utRatioDistribution: {
      safe: 0,
      warning: 0,
      danger: 0,
      noData: 0,
    },
    nonConformantList: [],
  }
  return NextResponse.json(stub)
}
