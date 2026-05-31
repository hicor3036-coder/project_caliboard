// 아토믹 엔드포인트: 진행상태별 분포
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/by-status
//   응답: { label, value }[]  (value 내림차순, NULL/'' → '(없음)')

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('by_status')

  if (error) {
    console.error('[supabase/by-status] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
