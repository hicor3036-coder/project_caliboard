// 아토믹 엔드포인트: k-tools에서 교정성적서 Excel(PDF→Excel 변환본) 1건 다운로드
// ─ 도메인 규칙: k-tools 호출만 (cert 파싱·LLM 호출 X)
//
// GET /api/ktools/cert-excel?sessionId=X&acptNo=Y
//   ─ 입력: sessionId (api/ktools/session으로 발급), acptNo (DB zero-padded 형식)
//   ─ 동작: makeApiAcceptNo로 변환 → 토큰 발급 → PDF→Excel 변환 요청 → Excel 다운로드
//   ─ 응답:
//     - 성공 (Excel 받음): application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
//     - PDF 없음 (성적서 미발급 등): 204 No Content
//     - 세션 만료: 401 SESSION_EXPIRED
//     - 기타: 500
//
// 파싱은 별도 atom (cert/parse). 일괄 처리는 task (cert-batch).

import { NextRequest, NextResponse } from 'next/server'
import { downloadCertExcel, makeApiAcceptNo, ensureSpmAccess } from '@/lib/cert-download'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('sessionId')
  const acptNo = sp.get('acptNo')?.trim()

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId 파라미터가 필요합니다' }, { status: 400 })
  }
  if (!acptNo) {
    return NextResponse.json({ error: 'acptNo 파라미터가 필요합니다' }, { status: 400 })
  }

  try {
    await ensureSpmAccess(sessionId)
    const apiAcceptNo = makeApiAcceptNo(acptNo)
    const buffer = await downloadCertExcel(sessionId, apiAcceptNo)

    if (!buffer) {
      // PDF 없음 (성적서 미발급, 결재 미완료 등)
      return new NextResponse(null, { status: 204 })
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${apiAcceptNo}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[ktools/cert-excel] 실패:', msg)
    if (msg === 'SESSION_EXPIRED') {
      return NextResponse.json({ error: 'SESSION_EXPIRED' }, { status: 401 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
