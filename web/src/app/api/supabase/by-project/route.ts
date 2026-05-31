// 아토믹 엔드포인트: 과제별 현황 (건수 + 총비용 합)
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/by-project
//   응답: { prjc_cd, count, total_sum }[]  (count 내림차순)

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('by_project')

  if (error) {
    console.error('[supabase/by-project] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
