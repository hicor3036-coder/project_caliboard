// 아토믹 엔드포인트: 교정 소요일 통계 (전체 + 제품별 상위 20)
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/duration
//   응답:
//   {
//     overall:    { avg, median, max, count },
//     by_product: [{ prd_nm, avg, median, count }, ...]   // 건수 >= 5, avg 내림차순 top 20
//   }

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('duration_stats')

  if (error) {
    console.error('[supabase/duration] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? { overall: null, by_product: [] })
}
