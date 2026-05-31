// 아토믹 엔드포인트: 미처리 현황 + 체류일수 + 예상완료일
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/unprocessed
//   응답: UnprocessedRow[]
//   {
//     acpt_no, rcpn_ymd, stay_days, est_done_ymd, remaining_days,
//     entp_prd_nm, prdn_cmpn_nm, stsz_nm, mctl_no, cust_eqpm_srno,
//     mngm_rspr_nm, fnsh_scdl_ymd, group_nm, group_cnt
//   }
//   체류일수 내림차순 (가장 오래 걸린 게 위)

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('unprocessed_items')

  if (error) {
    console.error('[supabase/unprocessed] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
