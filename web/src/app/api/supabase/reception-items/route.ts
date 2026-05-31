// 아토믹 엔드포인트: 접수 점검 대조용 장비 목록
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/reception-items
//   응답: ReceptionItemRow[]
//   {
//     acpt_no, entp_prd_nm, prdn_cmpn_nm, stsz_nm,
//     mctl_no, cust_eqpm_srno, rcpn_ymd, pgst_nm, mngm_rspr_nm
//   }
//   ─ 메일 표 붙여넣기 대조 + 빠른 조회용 (전체 row 필요 → 페이지네이션 없음)
//   ─ 9개 컬럼만 select (row size 최소화, 9311건 기준 ~1MB)
//   ─ PostgREST 기본 1000건 한도 회피 위해 명시적 range(0, 99999) 사용
//   ─ 정렬: rcpn_ymd desc (최근 접수가 위)

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

const COLUMNS = [
  'acpt_no', 'entp_prd_nm', 'prdn_cmpn_nm', 'stsz_nm',
  'mctl_no', 'cust_eqpm_srno', 'rcpn_ymd', 'pgst_nm', 'mngm_rspr_nm',
].join(',')

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ktools_items')
    .select(COLUMNS)
    .order('rcpn_ymd', { ascending: false, nullsFirst: false })
    .range(0, 99999)

  if (error) {
    console.error('[supabase/reception-items] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
