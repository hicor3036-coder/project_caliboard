// 아토믹 엔드포인트: 차기교정 임박 + 구간 분류 + 접수권장일
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/upcoming?limit=5000
//   응답:
//   {
//     items: UpcomingRow[],                         // d_day 오름차순, 장기경과 제외, 상위 limit건
//     counts: {장기경과, 만료, 'D-30', 'D-60', 'D-90', 'D-90+'},  // 전체 row 집계
//     urgent_count: number                          // 전체 row 중 urgent=true 카운트
//   }
//
// 주의: counts는 SQL 전수 집계 (PostgREST 1000건 한도 영향 없음)
//       items는 장기경과(< -730일) 제외하고 액션 가능한 것만 반환

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

const DEFAULT_LIMIT = 5000
const MAX_LIMIT = 20000

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(sp.get('limit') ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT)
  )

  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('upcoming_summary', { p_limit: limit })

  if (error) {
    console.error('[supabase/upcoming] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? { items: [], counts: {}, urgent_count: 0 })
}
