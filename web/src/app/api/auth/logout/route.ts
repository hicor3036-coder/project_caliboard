// 로그아웃 API: k-tools 세션 무효화 + 쿠키 삭제 + 캐시 초기화
import { NextRequest, NextResponse } from 'next/server'
import { clearCache } from '@/lib/cache'
import { ktoolsLogin } from '@/lib/ktools-login'

const KTOOLS_LOGOUT_URL = 'https://k-tools.ktl.re.kr/spm/contents/login01.do?code=out'

export async function POST(request: NextRequest) {
  // k-tools 서버 측 세션 무효화 (실패해도 로그아웃은 진행)
  try {
    const auth = request.cookies.get('ktools_auth')?.value
    if (auth) {
      const { userId, userPwd } = JSON.parse(Buffer.from(auth, 'base64').toString())
      const sessionId = await ktoolsLogin(userId, userPwd)
      await fetch(KTOOLS_LOGOUT_URL, {
        headers: { 'Cookie': `KTOOLS_JSESSIONID=${sessionId}` },
      })
    }
  } catch {
    // k-tools 로그아웃 실패는 무시
  }

  clearCache()

  const res = NextResponse.json({ success: true })
  res.cookies.set('ktools_auth', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
  })

  return res
}
