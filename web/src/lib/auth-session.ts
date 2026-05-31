// 로그인 세션 쿠키 관리
// ─ 쿠키 maxAge = 24시간 (사내 도구 — 매일 1회 재로그인 정도가 적당)
// ─ 데이터 신선도 임계값과 다름 (인증과 데이터 정합성은 별개 목적)

import type { NextResponse } from 'next/server'

export const AUTH_COOKIE = 'ktools_auth'
export const AUTH_COOKIE_MAX_AGE_SEC = 24 * 60 * 60

interface Credentials {
  userId: string
  userPwd: string
}

export function setAuthCookie(res: NextResponse, credentials: Credentials): void {
  const value = Buffer.from(JSON.stringify(credentials)).toString('base64')
  res.cookies.set(AUTH_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE_SEC,
    path: '/',
  })
}
