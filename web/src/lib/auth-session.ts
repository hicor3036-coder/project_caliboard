// 로그인 세션 쿠키 관리
// ─ 쿠키 maxAge = 6시간 (k-tools 데이터 동기화 주기와 동일하게 운영)
import type { NextResponse } from 'next/server'

export const AUTH_COOKIE = 'ktools_auth'
export const AUTH_COOKIE_MAX_AGE_SEC = 6 * 60 * 60

interface Credentials {
  userId: string
  userPwd: string
}

// 자격증명 → base64 인코딩 → 쿠키 옵션
function makeCookieOptions(credentials: Credentials) {
  const value = Buffer.from(JSON.stringify(credentials)).toString('base64')
  return {
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: AUTH_COOKIE_MAX_AGE_SEC,
    path: '/',
  }
}

// 신규 로그인 시 세션 쿠키 발급
export function setAuthCookie(res: NextResponse, credentials: Credentials): void {
  const { value, ...opts } = makeCookieOptions(credentials)
  res.cookies.set(AUTH_COOKIE, value, opts)
}

// 데이터 수집 완료 후 같은 자격증명으로 쿠키 만료시각만 새로 발급 (세션 연장)
// ─ 응답에 Set-Cookie를 다시 실어서 maxAge를 새로고침
export function refreshAuthCookie(res: NextResponse, encodedAuth: string): void {
  res.cookies.set(AUTH_COOKIE, encodedAuth, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE_SEC,
    path: '/',
  })
}
