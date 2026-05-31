// 아토믹 엔드포인트: k-tools 그룹 단위 상세 조회 (한 group_nm의 전체 이력)
// ─ 도메인 규칙: k-tools 호출만 (Supabase 호출 X)
// ─ 옛 supabase/group-detail은 우리 DB의 그룹 대표 1건만 반환했음
//   k-tools 옛 fetchPage 응답이 그룹당 1건씩만 보내므로 DB에도 1건씩만 있음
//   이 atom은 k-tools 그룹 단위 API를 직접 호출해 N건 전부 받음
//
// GET /api/ktools/group-equip?sessionId=X&groupNm=Y
//   응답: { items: DetailItem[], count: number }
//   ─ DetailItem 26필드 (supabase/group-detail과 동일 형식 — 컴포넌트 호환)
//   ─ rcpn_ymd desc 정렬 (k-tools 응답 순서 유지하되 최신부터)

import { NextRequest, NextResponse } from 'next/server'
import { fetchGroupEquip, type KtoolsItem } from '@/lib/ktools-fetch'
import { KTOOLS_PROJECT_CODES_PARAM } from '@/lib/projects'

interface DetailItemDTO {
  prjcCd: string
  acptNo: string
  rcpnYmd: string
  exrsWrtnYmd: string
  fnshScdlYmd: string
  snctYmd: string
  isncYmd: string
  smplOutDate: string
  pgstNm: string
  gyeoljeStatus: string
  mngmRsprNm: string
  mngmDvsnNm: string
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  prdNm: string
  mctlNo: string
  custEqpmSrno: string
  affcCyclCd: string
  nxtrExrsYmd: string
  totalFee: number
  totalVat: number
  totalSum: number
  apcnCmnm: string
  apcnNm: string
  apcnTlno: string
  apcnEmlAdrs: string
}

// k-tools가 보내는 "비어있음" 표현
function isEmpty(s: string): boolean {
  if (s === '') return true
  const lower = s.toLowerCase()
  return lower === 'none' || lower === 'null'
}

function s(v: unknown): string {
  if (typeof v !== 'string') return v == null ? '' : String(v)
  return isEmpty(v) ? '' : v
}

function n(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    if (isEmpty(v)) return 0
    const p = Number(v)
    return Number.isFinite(p) ? p : 0
  }
  return 0
}

function mapToDetail(item: KtoolsItem): DetailItemDTO {
  return {
    prjcCd:        s(item.prjcCd),
    acptNo:        s(item.acptNo),
    rcpnYmd:       s(item.rcpnYmd),       // k-tools 원본 "YYYYMMDD" 그대로
    exrsWrtnYmd:   s(item.exrsWrtnYmd),
    fnshScdlYmd:   s(item.fnshScdlYmd),
    snctYmd:       s(item.snctYmd),
    isncYmd:       s(item.isncYmd),
    smplOutDate:   s(item.smplOutDate),
    pgstNm:        s(item.pgstNm),
    gyeoljeStatus: s(item.gyeoljeStatus),
    mngmRsprNm:    s(item.mngmRsprNm),
    mngmDvsnNm:    s(item.mngmDvsnNm),
    entpPrdNm:     s(item.entpPrdNm),
    prdnCmpnNm:    s(item.prdnCmpnNm),
    stszNm:        s(item.stszNm),
    prdNm:         s(item.prdNm),
    mctlNo:        s(item.mctlNo),
    custEqpmSrno:  s(item.custEqpmSrno),
    affcCyclCd:    s(item.affcCyclCd),
    nxtrExrsYmd:   s(item.nxtrExrsYmd),
    totalFee:      n(item.totalFee),
    totalVat:      n(item.totalVat),
    totalSum:      n(item.totalSum),
    apcnCmnm:      s(item.apcnCmnm),
    apcnNm:        s(item.apcnNm),
    apcnTlno:      s(item.apcnTlno),
    apcnEmlAdrs:   s(item.apcnEmlAdrs),
  }
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('sessionId')
  const groupNm = sp.get('groupNm')?.trim()

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId 파라미터가 필요합니다' }, { status: 400 })
  }
  if (!groupNm) {
    return NextResponse.json({ error: 'groupNm 파라미터가 필요합니다' }, { status: 400 })
  }

  try {
    const list = await fetchGroupEquip(sessionId, groupNm, KTOOLS_PROJECT_CODES_PARAM)
    const items = list.map(mapToDetail)
    // 최신순 정렬 (rcpn_ymd desc)
    items.sort((a, b) => b.rcpnYmd.localeCompare(a.rcpnYmd))
    return NextResponse.json({ items, count: items.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[ktools/group-equip] 실패:', msg)
    if (msg === 'SESSION_EXPIRED') {
      return NextResponse.json({ error: 'SESSION_EXPIRED' }, { status: 401 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
