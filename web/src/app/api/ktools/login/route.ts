// 아토믹 엔드포인트: k-tools 로그인
// ─ 도메인 규칙: k-tools 호출만
// ─ 동작: k-tools에 실제 로그인 → 자격증명 검증 → 쿠키 발급
// ─ 출력: { success: true }
//
// 세션 ID 캐싱·재사용은 별도 atom에서 다룰 일이며, 여기는 "로그인" 행위만.
import { NextResponse } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'
import { setAuthCookie } from '@/lib/auth-session'

export async function POST(request: Request) {
  try {
    const { userId, userPwd, remember } = await request.json()

    if (!userId || !userPwd) {
      return NextResponse.json({ error: '아이디와 비밀번호를 입력하세요' }, { status: 400 })
    }

    // k-tools에 실제 로그인 시도하여 자격증명 검증
    await ktoolsLogin(userId, userPwd)

    const res = NextResponse.json({ success: true })
    setAuthCookie(res, { userId, userPwd }, remember === true)
    return res
  } catch (error) {
    console.error('로그인 실패:', error)
    return NextResponse.json(
      { error: '로그인 실패: 아이디 또는 비밀번호를 확인하세요' },
      { status: 401 }
    )
  }
}
