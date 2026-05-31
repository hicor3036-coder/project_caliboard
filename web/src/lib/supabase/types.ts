// Supabase DB row 타입 (snake_case)
// 0001_init.sql 스키마와 1:1 매칭

export interface KtoolsItemRow {
  acpt_no: string

  // 날짜 (Postgres DATE → "YYYY-MM-DD" 문자열로 직렬화됨)
  rcpn_ymd: string | null
  exrs_wrtn_ymd: string | null
  fnsh_scdl_ymd: string | null
  nxtr_exrs_ymd: string | null

  // 장비/제품
  prd_nm: string | null
  entp_prd_nm: string | null
  prdn_cmpn_nm: string | null
  stsz_nm: string | null
  mctl_no: string | null
  cust_eqpm_srno: string | null

  // 상태/담당
  pgst_nm: string | null
  prjc_cd: string | null
  mngm_rspr_nm: string | null

  // 비용
  total_sum: number | null

  // 그룹
  group_nm: string | null
  group_cnt: number | null

  // 메타
  synced_at: string  // ISO timestamp
}

export interface SyncRunRow {
  id: number
  started_at: string
  finished_at: string | null
  item_count: number | null
  inserted_count: number | null
  updated_count: number | null
  status: 'running' | 'success' | 'failed'
  error_message: string | null
  triggered_by: string | null
}
