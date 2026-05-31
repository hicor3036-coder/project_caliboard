// 아토믹 엔드포인트: 제조사별 분포 (상위 30개)
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/by-manufacturer
//   응답: { label, value }[]  (상위 30, value 내림차순)

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('by_manufacturer')

  if (error) {
    console.error('[supabase/by-manufacturer] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
