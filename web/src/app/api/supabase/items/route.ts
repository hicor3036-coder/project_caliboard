// 아토믹 엔드포인트: ktools_items 테이블 CRUD
// ─ 도메인 규칙: Supabase 클라이언트만 호출 (k-tools 호출 X)
// ─ Phase D: equipment-detail용 12개 컬럼 매핑 (mappers.ts 갱신 반영)
//
// GET    /api/supabase/items?q=&pgstNm=&mngmRsprNm=&prdnCmpnNm=&prjcCd=&page=1&pageSize=50&sort=rcpn_ymd&order=desc
//   → 검색·필터·페이지네이션
//   → 응답: { items: KtoolsItemRow[], total, page, pageSize }
//
// POST   /api/supabase/items
//   body: { items: KtoolsItem[], syncedAt?: ISO }
//   → 500건씩 청크 upsert (acpt_no 충돌 시 UPDATE)
//   → 호출자가 syncedAt 주입하면 그 값을 row.synced_at에 박음 (task가 같은 sync의 모든 row를 동일 시각으로 마킹)
//
// DELETE /api/supabase/items?syncedBefore=ISO
//   → synced_at < syncedBefore 인 row 삭제 (이번 sync에 참여 안 한 = orphan)
//   → 4중 방어선:
//      1. 파라미터 필수
//      2. ISO 파싱 가능
//      3. 최소 10초 이전 시각이어야 함 (방금 upsert한 row 보호)
//      4. 삭제 대상 count > 1000건이면 거부 (운영상 사고 차단)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'
import { toRow } from '@/lib/supabase/mappers'
import { KtoolsItem } from '@/lib/ktools-fetch'

const UPSERT_CHUNK_SIZE = 500
const DELETE_MIN_AGE_MS = 10 * 1000          // 방어선 3: syncedBefore가 너무 최근이면 거부
const DELETE_MAX_COUNT  = 1000               // 방어선 4: 한 번에 1000건 이상 삭제 차단

// 검색 가능한 텍스트 컬럼 (q 파라미터 OR 매칭)
const SEARCH_COLUMNS = [
  'acpt_no', 'entp_prd_nm', 'prdn_cmpn_nm', 'stsz_nm',
  'mctl_no', 'cust_eqpm_srno', 'mngm_rspr_nm',
] as const

// 정렬 화이트리스트 (임의 컬럼 정렬 차단)
const SORTABLE_COLUMNS = new Set<string>([
  'rcpn_ymd', 'exrs_wrtn_ymd', 'fnsh_scdl_ymd', 'nxtr_exrs_ymd',
  'acpt_no', 'pgst_nm', 'mngm_rspr_nm', 'prdn_cmpn_nm', 'total_sum',
])

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 500

// =====================================================================
// GET — 검색·필터·페이지네이션
// =====================================================================
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const q            = sp.get('q')?.trim()
  const pgstNm       = sp.get('pgstNm')?.trim()
  const mngmRsprNm   = sp.get('mngmRsprNm')?.trim()
  const prdnCmpnNm   = sp.get('prdnCmpnNm')?.trim()
  const prjcCd       = sp.get('prjcCd')?.trim()

  const page     = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(sp.get('pageSize') ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE)
  )

  const sortRaw  = sp.get('sort') ?? 'rcpn_ymd'
  const sort     = SORTABLE_COLUMNS.has(sortRaw) ? sortRaw : 'rcpn_ymd'
  const order    = sp.get('order') === 'asc' ? 'asc' : 'desc'

  const from = (page - 1) * pageSize
  const to   = from + pageSize - 1

  const supabase = getSupabase()
  let query = supabase
    .from('ktools_items')
    .select('*', { count: 'exact' })

  // q: 텍스트 컬럼 OR 부분일치
  if (q) {
    const escaped = q.replace(/[%,]/g, '\\$&')
    const or = SEARCH_COLUMNS.map(c => `${c}.ilike.%${escaped}%`).join(',')
    query = query.or(or)
  }

  // 정확 매칭 필터 (자주 쓰는 컬럼만 노출)
  if (pgstNm)     query = query.eq('pgst_nm', pgstNm)
  if (mngmRsprNm) query = query.eq('mngm_rspr_nm', mngmRsprNm)
  if (prdnCmpnNm) query = query.eq('prdn_cmpn_nm', prdnCmpnNm)
  if (prjcCd)     query = query.eq('prjc_cd', prjcCd)

  query = query
    .order(sort, { ascending: order === 'asc', nullsFirst: false })
    .range(from, to)

  const { data, error, count } = await query
  if (error) {
    console.error('[supabase/items GET] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  })
}

// =====================================================================
// POST — bulk upsert
// =====================================================================
export async function POST(request: NextRequest) {
  let body: { items?: KtoolsItem[]; syncedAt?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 })
  }

  const items = body.items
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'items 배열이 필요합니다' }, { status: 400 })
  }
  if (items.length === 0) {
    return NextResponse.json({ upserted: 0 })
  }

  // syncedAt 형식 검증 (제공된 경우)
  if (body.syncedAt !== undefined) {
    if (typeof body.syncedAt !== 'string' || Number.isNaN(new Date(body.syncedAt).getTime())) {
      return NextResponse.json({ error: 'syncedAt이 유효한 ISO 문자열이 아닙니다' }, { status: 400 })
    }
  }

  const supabase = getSupabase()
  const rows = items.map(item => toRow(item, body.syncedAt))

  // 사전 검증: 받은 payload 안에 acpt_no 중복이 있는지 (있으면 정합성 사고)
  const acptCounts = new Map<string, number>()
  for (const r of rows) acptCounts.set(r.acpt_no, (acptCounts.get(r.acpt_no) ?? 0) + 1)
  const payloadDups: string[] = []
  for (const [a, c] of acptCounts.entries()) if (c > 1) payloadDups.push(`${a}(${c})`)
  if (payloadDups.length > 0) {
    console.warn(`[supabase/items POST] payload 내 acpt_no 중복 ${payloadDups.length}건:`, payloadDups.slice(0, 5))
  }

  let upserted = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE)
    const { error } = await supabase
      .from('ktools_items')
      .upsert(chunk, { onConflict: 'acpt_no' })

    if (error) {
      console.error(`[supabase/items POST] 청크 ${i}~${i + chunk.length} upsert 실패:`, error)
      return NextResponse.json(
        { error: error.message, upserted, failedAt: i },
        { status: 500 }
      )
    }
    upserted += chunk.length
  }

  // 사후 검증: 이번 batch의 acpt_no가 모두 DB에 존재하는지
  // — payload는 받았는데 silent로 누락된 row가 있으면 즉시 감지
  const expectedAcptNos = Array.from(new Set(rows.map(r => r.acpt_no)))
  const { count: actualCount, error: verifyErr } = await supabase
    .from('ktools_items')
    .select('acpt_no', { count: 'exact', head: true })
    .in('acpt_no', expectedAcptNos)

  if (verifyErr) {
    console.error('[supabase/items POST] 사후 검증 SELECT 실패:', verifyErr)
  } else if (actualCount !== expectedAcptNos.length) {
    const missing = expectedAcptNos.length - (actualCount ?? 0)
    console.error(
      `[supabase/items POST] 정합성 사고 — 받은 unique acpt_no ${expectedAcptNos.length}, ` +
      `DB 실제 ${actualCount}, 누락 ${missing}건. payload크기=${items.length}, chunks=${Math.ceil(rows.length / UPSERT_CHUNK_SIZE)}`,
    )
    return NextResponse.json(
      {
        error: `정합성 사고: ${missing}건 누락 (received=${expectedAcptNos.length}, inDb=${actualCount})`,
        upserted,
        missing,
      },
      { status: 500 }
    )
  }

  console.log(`[supabase/items POST] upsert 완료: ${upserted}건 (사후 검증 OK)`)
  return NextResponse.json({ upserted })
}

// =====================================================================
// DELETE — orphan 삭제 (synced_at < syncedBefore)
// =====================================================================
export async function DELETE(request: NextRequest) {
  const syncedBefore = request.nextUrl.searchParams.get('syncedBefore')

  // 방어선 1: 파라미터 필수
  if (!syncedBefore) {
    return NextResponse.json(
      { error: 'syncedBefore 파라미터가 필요합니다 (ISO 문자열)' },
      { status: 400 }
    )
  }

  // 방어선 2: ISO 파싱 가능 여부
  const cutoff = new Date(syncedBefore)
  if (Number.isNaN(cutoff.getTime())) {
    return NextResponse.json(
      { error: `syncedBefore가 유효한 ISO 문자열이 아닙니다: ${syncedBefore}` },
      { status: 400 }
    )
  }

  // 방어선 3: 너무 최근 시각 거부 (방금 upsert한 row를 보호)
  const ageMs = Date.now() - cutoff.getTime()
  if (ageMs < DELETE_MIN_AGE_MS) {
    return NextResponse.json(
      {
        error: 'syncedBefore가 너무 최근 시각입니다. 최소 10초 이전이어야 합니다.',
        ageMs,
        minAgeMs: DELETE_MIN_AGE_MS,
      },
      { status: 400 }
    )
  }

  const supabase = getSupabase()
  const isoCutoff = cutoff.toISOString()

  // 방어선 4: 삭제 대상 사전 카운트 → 임계 초과 시 거부
  const { count, error: countErr } = await supabase
    .from('ktools_items')
    .select('*', { count: 'exact', head: true })
    .lt('synced_at', isoCutoff)

  if (countErr) {
    console.error('[supabase/items DELETE] 카운트 조회 실패:', countErr)
    return NextResponse.json({ error: countErr.message }, { status: 500 })
  }

  const willDelete = count ?? 0
  if (willDelete > DELETE_MAX_COUNT) {
    return NextResponse.json(
      {
        error: `삭제 대상이 ${willDelete}건으로 안전 임계(${DELETE_MAX_COUNT}건) 초과. 수동 확인 후 진행하세요.`,
        wouldDelete: willDelete,
        maxAllowed: DELETE_MAX_COUNT,
      },
      { status: 400 }
    )
  }

  if (willDelete === 0) {
    return NextResponse.json({ deleted: 0, syncedBefore: isoCutoff })
  }

  // 삭제 실행 — 샘플 acpt_no 같이 받아서 로그/응답에 포함
  const { data, error } = await supabase
    .from('ktools_items')
    .delete()
    .lt('synced_at', isoCutoff)
    .select('acpt_no')

  if (error) {
    console.error('[supabase/items DELETE] 삭제 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const deletedAcptNos = (data ?? []).map(r => r.acpt_no)
  console.log(`[supabase/items DELETE] ${deletedAcptNos.length}건 삭제 (cutoff=${isoCutoff})`)

  return NextResponse.json({
    deleted: deletedAcptNos.length,
    syncedBefore: isoCutoff,
    sampleAcptNos: deletedAcptNos.slice(0, 10),
  })
}
