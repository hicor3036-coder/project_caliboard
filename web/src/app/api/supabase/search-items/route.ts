// 아토믹 엔드포인트: 장비 검색 화면용 전체 row
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/search-items
//   응답: SearchItemRow[]
//   {
//     acpt_no, entp_prd_nm, prdn_cmpn_nm, stsz_nm,
//     mctl_no, cust_eqpm_srno, rcpn_ymd, pgst_nm, mngm_rspr_nm,
//     nxtr_exrs_ymd, exrs_wrtn_ymd, group_nm, group_cnt
//   }
//   ─ equipment-search 컴포넌트의 EquipmentItem 13필드와 1:1
//   ─ 클라이언트 사이드 필터/페이지네이션 (텍스트 검색·드롭다운 즉시 반응)
//   ─ 전체 row 필요 → 페이지네이션 없음, range(0, 99999)로 PostgREST 1000건 한도 회피
//   ─ 정렬: rcpn_ymd desc (최근 접수가 위 — 컴포넌트 defaultSort와 일치)

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

const COLUMNS = [
  'acpt_no', 'entp_prd_nm', 'prdn_cmpn_nm', 'stsz_nm',
  'mctl_no', 'cust_eqpm_srno', 'rcpn_ymd', 'pgst_nm', 'mngm_rspr_nm',
  'nxtr_exrs_ymd', 'exrs_wrtn_ymd', 'group_nm', 'group_cnt',
].join(',')

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ktools_items')
    .select(COLUMNS)
    .order('rcpn_ymd', { ascending: false, nullsFirst: false })
    .range(0, 99999)

  if (error) {
    console.error('[supabase/search-items] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
