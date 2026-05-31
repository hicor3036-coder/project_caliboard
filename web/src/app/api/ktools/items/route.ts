// 아토믹 엔드포인트: k-tools 장비 목록 단일 페이지 조회
// ─ 도메인 규칙: k-tools API 1회 호출 (페이지 1개)
// ─ 입력: sessionId + 검색 파라미터 (URLSearchParams)
// ─ 동작: fetchPage 1회
// ─ 출력: { list: KtoolsItem[], totalCount: number }
//
// 페이지 순회·자동 재로그인은 호출자(task)의 책임.
// sessionId는 api/ktools/session POST으로 미리 발급받아 전달.

import { NextRequest, NextResponse } from 'next/server'
import { fetchPage, FetchPageParams } from '@/lib/ktools-fetch'

function parseIntOr(v: string | null, fallback: number): number {
  if (v === null) return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function strOr(v: string | null): string | undefined {
  return v === null ? undefined : v
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const sessionId = sp.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId 파라미터가 필요합니다' }, { status: 400 })
  }

  const params: FetchPageParams = {
    page: parseIntOr(sp.get('page'), 0),
    pageCount: parseIntOr(sp.get('pageCount'), 3000),

    startDt: strOr(sp.get('startDt')),
    endDt: strOr(sp.get('endDt')),
    exrsWrtnYmdStart: strOr(sp.get('exrsWrtnYmdStart')),
    exrsWrtnYmdEnd: strOr(sp.get('exrsWrtnYmdEnd')),

    entpPrdNm: strOr(sp.get('entpPrdNm')),
    prdnCmpnNm: strOr(sp.get('prdnCmpnNm')),
    stszNm: strOr(sp.get('stszNm')),
    mctlNo: strOr(sp.get('mctlNo')),
    mctlNoTwo: strOr(sp.get('mctlNoTwo')),
    acptNo: strOr(sp.get('acptNo')),
    exrsCmnm: strOr(sp.get('exrsCmnm')),
    pgstNm: strOr(sp.get('pgstNm')),
    custEqpmSrno: strOr(sp.get('custEqpmSrno')),

    cnsnClsIdx: strOr(sp.get('cnsnClsIdx')),
    prjcCdList: strOr(sp.get('prjcCdList')),
    apcnNmList: strOr(sp.get('apcnNmList')),
    apcnDvsnNmList: strOr(sp.get('apcnDvsnNmList')),
    prjcCdFList: strOr(sp.get('prjcCdFList')),
    filterCol: strOr(sp.get('filterCol')),
  }

  try {
    const result = await fetchPage(sessionId, params)
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류'
    console.error('[ktools/items] fetchPage 실패:', msg)
    if (msg === 'SESSION_EXPIRED') {
      return NextResponse.json({ error: 'SESSION_EXPIRED' }, { status: 401 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
