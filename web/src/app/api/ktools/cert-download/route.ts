// 성적서 Excel 다운로드 API
//
// GET /api/ktools/cert-download?acptNo=26-010119-02-012
//
// k-tools에서 해당 접수번호의 성적서를 Excel로 변환 후 바이너리 응답.
// 브라우저에서 Blob으로 받아 파일 저장.

import { NextRequest } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'
import { getSessionId, setSessionId } from '@/lib/cache'
import { downloadCertExcel, makeApiAcceptNo, ensureSpmAccess } from '@/lib/cert-download'

function getCredentials(request: NextRequest): { userId: string; userPwd: string } | null {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) return null
  try {
    return JSON.parse(Buffer.from(auth, 'base64').toString())
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const acptNo = request.nextUrl.searchParams.get('acptNo')
  if (!acptNo) {
    return new Response(JSON.stringify({ error: 'acptNo 필요' }), { status: 400 })
  }

  const creds = getCredentials(request)
  if (!creds) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // 1. 세션 확보
    let sessionId = await getSessionId()
    if (!sessionId) {
      sessionId = await ktoolsLogin(creds.userId, creds.userPwd)
      await setSessionId(sessionId)
    }

    // 2. spm0907.do 접근 (API 전제조건)
    await ensureSpmAccess(sessionId)

    // 3. acptNo 변환 + Excel 다운로드
    const apiAcceptNo = makeApiAcceptNo(acptNo)
    let buffer = await downloadCertExcel(sessionId, apiAcceptNo)

    // 4. 세션 만료 시 재로그인 1회 시도
    if (!buffer) {
      sessionId = await ktoolsLogin(creds.userId, creds.userPwd)
      await setSessionId(sessionId)
      await ensureSpmAccess(sessionId)
      buffer = await downloadCertExcel(sessionId, apiAcceptNo)
    }

    if (!buffer) {
      return new Response(JSON.stringify({ error: '성적서 다운로드 실패' }), { status: 502 })
    }

    // 5. Excel 바이너리 응답
    const filename = encodeURIComponent(`성적서_${acptNo}.xlsx`)
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('[cert-download] 에러:', error)
    const msg = error instanceof Error ? error.message : '알 수 없는 오류'
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
}
