// 로그인 세션 쿠키 관리
// ─ 쿠키 maxAge = 24시간 (사내 도구 — 매일 1회 재로그인 정도가 적당)
// ─ 데이터 신선도 임계값과 다름 (인증과 데이터 정합성은 별개 목적)

import type { NextResponse } from 'next/server'

export const AUTH_COOKIE = 'ktools_auth'
export const AUTH_COOKIE_MAX_AGE_SEC = 24 * 60 * 60

// 쿠키 도메인: www.caliboard.kr / caliboard.kr 양쪽에서 공유되도록 '.caliboard.kr'로 발급.
// ─ domain 미지정 시 쿠키가 발급 호스트 전용(host-only)이 되어, www↔apex 이동 중 쿠키 누락 → 불규칙 로그아웃.
// ─ 개발(localhost)에서는 domain을 붙이면 안 됨(쿠키 무효) → undefined로 두어 host-only 동작.
const AUTH_COOKIE_DOMAIN =
  process.env.NODE_ENV === 'production' ? '.caliboard.kr' : undefined

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
    domain: AUTH_COOKIE_DOMAIN,
  })
}

// 로그아웃: setAuthCookie와 동일한 domain/path로 만료시켜야 실제로 삭제됨.
// ─ domain이 다르면 브라우저가 다른 쿠키로 보고 원본을 안 지움.
export function clearAuthCookie(res: NextResponse): void {
  res.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    domain: AUTH_COOKIE_DOMAIN,
  })
}
