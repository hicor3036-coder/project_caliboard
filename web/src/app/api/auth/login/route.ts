// 로그인 API: k-tools 인증 검증 → 쿠키에 자격증명 저장 + 세션 ID 캐시
// 쿠키 TTL = 데이터 신선도 TTL (6시간) — 데이터 갱신 시 세션도 함께 연장
import { NextResponse } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'
import { setSessionId } from '@/lib/cache'
import { setAuthCookie } from '@/lib/auth-session'

export async function POST(request: Request) {
  try {
    const { userId, userPwd } = await request.json()

    if (!userId || !userPwd) {
      return NextResponse.json({ error: '아이디와 비밀번호를 입력하세요' }, { status: 400 })
    }

    // k-tools에 실제 로그인 시도하여 검증 + JSESSIONID 확보
    const sessionId = await ktoolsLogin(userId, userPwd)

    // 세션 ID를 단일 소스에 저장 → 다음 fetchAll에서 재사용 (재로그인 1회 절약)
    await setSessionId(sessionId)

    const res = NextResponse.json({ success: true })
    setAuthCookie(res, { userId, userPwd })
    return res
  } catch (error) {
    console.error('로그인 실패:', error)
    return NextResponse.json(
      { error: '로그인 실패: 아이디 또는 비밀번호를 확인하세요' },
      { status: 401 }
    )
  }
}
