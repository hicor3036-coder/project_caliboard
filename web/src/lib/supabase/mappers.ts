// KtoolsItem (k-tools 원본) ↔ DB row 매퍼
// ─ 키 변환: camelCase → snake_case
// ─ 날짜 변환: "YYYYMMDD" → "YYYY-MM-DD" (Postgres DATE 호환), 잘못된 값은 null
// ─ "None" 문자열 → null (k-tools가 Python str(None) 흘려보내는 경우 처리)

import { KtoolsItem } from '../ktools-fetch'
import { KtoolsItemRow } from './types'

// k-tools가 보내는 "비어있음" 표현 (대소문자 무시)
// — 빈 문자열, "None" (Python str(None)), "null" (Java null.toString())
function isEmpty(s: string): boolean {
  if (s === '') return true
  const lower = s.toLowerCase()
  return lower === 'none' || lower === 'null'
}

// k-tools "YYYYMMDD" 8자리 문자열 → Postgres DATE "YYYY-MM-DD"
// 일부 필드는 "YYYY-MM-DD" 그대로 오기도 함 → 양쪽 다 허용
function toDate(s: unknown): string | null {
  if (typeof s !== 'string') return null
  if (isEmpty(s)) return null
  if (s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (s.length !== 8) return null
  const y = s.slice(0, 4)
  const m = s.slice(4, 6)
  const d = s.slice(6, 8)
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null
  return `${y}-${m}-${d}`
}

function toText(s: unknown): string | null {
  if (typeof s !== 'string') return null
  if (isEmpty(s)) return null
  return s
}

// k-tools는 숫자 필드도 문자열("0", "12345")로 보냄 → 변환 수용
function toNumber(n: unknown): number | null {
  if (typeof n === 'number' && Number.isFinite(n)) return n
  if (typeof n === 'string') {
    if (isEmpty(n)) return null
    const parsed = Number(n)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// syncedAt: 호출자가 명시한 sync 시각 (task의 startedAt). 미지정 시 now().
// ─ 같은 task의 모든 row가 같은 synced_at 값을 갖도록 task가 주입하는 패턴.
// ─ 이 값이 orphan 판정의 기준선 (이번 sync보다 오래된 row = orphan)
export function toRow(item: KtoolsItem, syncedAt?: string): KtoolsItemRow {
  // group 필드는 KtoolsItem 타입엔 없지만 실제 응답에 존재 (analyze에서 사용)
  const raw = item as Record<string, unknown>

  return {
    acpt_no: item.acptNo,  // PK는 반드시 존재

    rcpn_ymd:      toDate(item.rcpnYmd),
    exrs_wrtn_ymd: toDate(item.exrsWrtnYmd),
    fnsh_scdl_ymd: toDate(item.fnshScdlYmd),
    nxtr_exrs_ymd: toDate(item.nxtrExrsYmd),

    prd_nm:         toText(item.prdNm),
    entp_prd_nm:    toText(item.entpPrdNm),
    prdn_cmpn_nm:   toText(item.prdnCmpnNm),
    stsz_nm:        toText(item.stszNm),
    mctl_no:        toText(item.mctlNo),
    cust_eqpm_srno: toText(item.custEqpmSrno),

    pgst_nm:      toText(item.pgstNm),
    prjc_cd:      toText(item.prjcCd),
    mngm_rspr_nm: toText(item.mngmRsprNm),

    total_sum: toNumber(item.totalSum),

    group_nm:  toText(raw.groupNm),
    group_cnt: toNumber(raw.groupCnt),

    // equipment-detail용 (Phase D)
    snct_ymd:       toDate(item.snctYmd),
    isnc_ymd:       toDate(item.isncYmd),
    smpl_out_date:  toDate(item.smplOutDate),
    gyeolje_status: toText(item.gyeoljeStatus),
    mngm_dvsn_nm:   toText(item.mngmDvsnNm),
    affc_cycl_cd:   toText(item.affcCyclCd),
    total_fee:      toNumber(item.totalFee),
    total_vat:      toNumber(item.totalVat),
    apcn_cmnm:      toText(item.apcnCmnm),
    apcn_nm:        toText(item.apcnNm),
    apcn_tlno:      toText(item.apcnTlno),
    apcn_eml_adrs:  toText(item.apcnEmlAdrs),

    synced_at: syncedAt ?? new Date().toISOString(),
  }
}
