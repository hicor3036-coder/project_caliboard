// 아토믹 엔드포인트: k-tools 세션 발급
// ─ 도메인 규칙: k-tools 호출만 (1회 — ktoolsLogin)
// ─ 입력: 자격증명 쿠키 (api/ktools/login으로 발급)
// ─ 동작: ktoolsLogin → JSESSIONID 획득 + spm0907.do 페이지 1회 방문(전제조건)
// ─ 출력: { sessionId: string }
//
// 호출자(task)가 sessionId를 받아 api/ktools/items에 재사용.
// 세션은 stateless하게 atom 응답으로만 흐름 — 서버 메모리 캐시 없음.

import { NextRequest, NextResponse } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'
import { ensureSpmAccess } from '@/lib/ktools-fetch'
import { AUTH_COOKIE } from '@/lib/auth-session'

function getCredentials(request: NextRequest): { userId: string; userPwd: string } | null {
  const auth = request.cookies.get(AUTH_COOKIE)?.value
  if (!auth) return null
  try {
    return JSON.parse(Buffer.from(auth, 'base64').toString())
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const creds = getCredentials(request)
  if (!creds) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  try {
    const sessionId = await ktoolsLogin(creds.userId, creds.userPwd)
    await ensureSpmAccess(sessionId)
    return NextResponse.json({ sessionId })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류'
    console.error('[ktools/session] 발급 실패:', msg)
    return NextResponse.json({ error: msg }, { status: 401 })
  }
}
