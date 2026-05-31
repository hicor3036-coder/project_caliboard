// 아토믹 엔드포인트: 월별 접수 추이 (rcpn_ymd 기준)
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/monthly-trend
//   응답: { month: 'YYYY-MM', count }[]  (month 오름차순)

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('monthly_trend')

  if (error) {
    console.error('[supabase/monthly-trend] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
