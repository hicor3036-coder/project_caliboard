// 로그인 API: k-tools 인증 검증 → 쿠키에 자격증명 저장
import { NextResponse } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'

export async function POST(request: Request) {
  try {
    const { userId, userPwd } = await request.json()

    if (!userId || !userPwd) {
      return NextResponse.json({ error: '아이디와 비밀번호를 입력하세요' }, { status: 400 })
    }

    // k-tools에 실제 로그인 시도하여 검증
    await ktoolsLogin(userId, userPwd)

    // 자격증명을 base64로 인코딩하여 httpOnly 쿠키에 저장
    const credentials = Buffer.from(JSON.stringify({ userId, userPwd })).toString('base64')

    const res = NextResponse.json({ success: true })
    res.cookies.set('ktools_auth', credentials, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24시간
      path: '/',
    })

    return res
  } catch (error) {
    console.error('로그인 실패:', error)
    return NextResponse.json(
      { error: '로그인 실패: 아이디 또는 비밀번호를 확인하세요' },
      { status: 401 }
    )
  }
}
