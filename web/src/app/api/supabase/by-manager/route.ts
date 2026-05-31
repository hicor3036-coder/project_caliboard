// 아토믹 엔드포인트: 담당자별 처리량 (상위 30명)
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/by-manager
//   응답: { label, value }[]  (상위 30, value 내림차순)

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('by_manager')

  if (error) {
    console.error('[supabase/by-manager] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
