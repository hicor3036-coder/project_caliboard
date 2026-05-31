// 클라이언트 → /api/supabase/* atom 호출 래퍼
// ─ atom 응답 (snake_case) → 컴포넌트 친화 형태 (camelCase + 한글 키)로 변환
// ─ 변환은 한 곳(이 파일)에 모음 — page.tsx가 직접 매퍼 책임지지 않도록

// =====================================================================
// 응답 타입 (atom 원형 — snake_case)
// =====================================================================

export interface SummaryResp {
  total: number
  unprocessed: number
  upcoming30: number
  avgDurationDays: number
  lastSyncedAt: string | null
}

export interface ByRow { label: string; value: number }
export interface ProjectRow { prjc_cd: string; count: number; total_sum: number }
export interface MonthlyRow { month: string; count: number }

export interface DurationResp {
  overall: { avg: number; median: number; max: number; count: number } | null
  by_product: { prd_nm: string; avg: number; median: number; count: number }[]
}

export interface UnprocessedRowRaw {
  acpt_no: string
  rcpn_ymd: string | null
  stay_days: number
  est_done_ymd: string | null
  remaining_days: number | null
  entp_prd_nm: string | null
  prdn_cmpn_nm: string | null
  stsz_nm: string | null
  mctl_no: string | null
  cust_eqpm_srno: string | null
  mngm_rspr_nm: string | null
  fnsh_scdl_ymd: string | null
  group_nm: string | null
  group_cnt: number | null
}

export interface UpcomingRowRaw {
  acpt_no: string
  entp_prd_nm: string | null
  prdn_cmpn_nm: string | null
  stsz_nm: string | null
  mctl_no: string | null
  cust_eqpm_srno: string | null
  nxtr_exrs_ymd: string | null
  d_day: number
  reco_rcpn_ymd: string | null
  urgent: boolean
  bucket: string
  group_nm: string | null
  group_cnt: number | null
}

export interface UpcomingResp {
  items: UpcomingRowRaw[]
  counts: Record<string, number>
  urgent_count: number
}

// =====================================================================
// 컴포넌트 친화 타입 (camelCase + 한글 키 — 기존 컴포넌트 prop과 일치)
// =====================================================================

export interface UnprocessedItemForUI {
  acptNo: string
  rcpnYmd: string
  체류일수: number
  예상완료일: string | null
  남은일수: number | null
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  mngmRsprNm: string
  fnshScdlYmd: string
  groupNm: string
  groupCnt: number
}

export interface UpcomingItemForUI {
  acptNo: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  nxtrExrsYmd: string
  dDay: number
  접수권장일: string
  접수시급: boolean
  구간: string
  groupNm: string
  groupCnt: number
}

export interface UpcomingDataForUI {
  평균소요일: number
  여유일: number
  장기경과: number
  만료: number
  d30: number
  d60: number
  d90: number
  items: UpcomingItemForUI[]
  제조사별: { label: string; value: number }[]
  시급건수: number
}

// =====================================================================
// 매퍼
// =====================================================================

const s = (v: string | null | undefined): string => v ?? ''
const n = (v: number | null | undefined): number => v ?? 0

export function mapUnprocessed(rows: UnprocessedRowRaw[]): UnprocessedItemForUI[] {
  return rows.map(r => ({
    acptNo: r.acpt_no,
    rcpnYmd: s(r.rcpn_ymd),
    체류일수: r.stay_days,
    예상완료일: r.est_done_ymd,
    남은일수: r.remaining_days,
    entpPrdNm: s(r.entp_prd_nm),
    prdnCmpnNm: s(r.prdn_cmpn_nm),
    stszNm: s(r.stsz_nm),
    mctlNo: s(r.mctl_no),
    custEqpmSrno: s(r.cust_eqpm_srno),
    mngmRsprNm: s(r.mngm_rspr_nm),
    fnshScdlYmd: s(r.fnsh_scdl_ymd),
    groupNm: s(r.group_nm),
    groupCnt: n(r.group_cnt) || 1,
  }))
}

export function mapUpcoming(
  resp: UpcomingResp,
  avgDurationDays: number,
  manufacturerDist: ByRow[],
): UpcomingDataForUI {
  return {
    평균소요일: avgDurationDays,
    여유일: 14,
    장기경과: resp.counts['장기경과'] ?? 0,
    만료: resp.counts['만료'] ?? 0,
    d30: resp.counts['D-30'] ?? 0,
    d60: resp.counts['D-60'] ?? 0,
    d90: resp.counts['D-90'] ?? 0,
    시급건수: resp.urgent_count,
    items: resp.items.map(r => ({
      acptNo: r.acpt_no,
      entpPrdNm: s(r.entp_prd_nm),
      prdnCmpnNm: s(r.prdn_cmpn_nm),
      stszNm: s(r.stsz_nm),
      mctlNo: s(r.mctl_no),
      custEqpmSrno: s(r.cust_eqpm_srno),
      nxtrExrsYmd: s(r.nxtr_exrs_ymd),
      dDay: r.d_day,
      접수권장일: s(r.reco_rcpn_ymd),
      접수시급: r.urgent,
      구간: r.bucket,
      groupNm: s(r.group_nm),
      groupCnt: n(r.group_cnt) || 1,
    })),
    제조사별: manufacturerDist,
  }
}

// 월별추이: MonthlyRow[] → MonthlyBarChart가 받는 { month, 건수 }[]
export function mapMonthlyForUI(rows: MonthlyRow[]): { month: string; 건수: number }[] {
  return rows.map(r => ({ month: r.month, 건수: r.count }))
}

// =====================================================================
// 호출 헬퍼 (한 번에 다 받기)
// =====================================================================

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${url}: ${res.status} ${body}`)
  }
  return res.json()
}

export interface DashboardData {
  summary: SummaryResp
  byStatus: ByRow[]
  byManager: ByRow[]
  byManufacturer: ByRow[]
  byProject: ProjectRow[]
  monthlyTrend: MonthlyRow[]
  duration: DurationResp
  unprocessed: UnprocessedRowRaw[]
  upcoming: UpcomingResp
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [
    summary, byStatus, byManager, byManufacturer, byProject,
    monthlyTrend, duration, unprocessed, upcoming,
  ] = await Promise.all([
    getJson<SummaryResp>('/api/supabase/summary'),
    getJson<ByRow[]>('/api/supabase/by-status'),
    getJson<ByRow[]>('/api/supabase/by-manager'),
    getJson<ByRow[]>('/api/supabase/by-manufacturer'),
    getJson<ProjectRow[]>('/api/supabase/by-project'),
    getJson<MonthlyRow[]>('/api/supabase/monthly-trend'),
    getJson<DurationResp>('/api/supabase/duration'),
    getJson<UnprocessedRowRaw[]>('/api/supabase/unprocessed'),
    getJson<UpcomingResp>('/api/supabase/upcoming'),
  ])

  return {
    summary, byStatus, byManager, byManufacturer, byProject,
    monthlyTrend, duration, unprocessed, upcoming,
  }
}
