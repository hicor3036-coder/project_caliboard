// 로그인 세션 쿠키 관리
// ─ 쿠키 maxAge = 24시간 (사내 도구 — 매일 1회 재로그인 정도가 적당)
// ─ 데이터 신선도 임계값과 다름 (인증과 데이터 정합성은 별개 목적)

import type { NextRequest, NextResponse } from 'next/server'

export const AUTH_COOKIE = 'ktools_auth'
export const AUTH_COOKIE_MAX_AGE_SEC = 24 * 60 * 60          // 기본: 24시간
export const AUTH_COOKIE_REMEMBER_MAX_AGE_SEC = 30 * 24 * 60 * 60  // "로그인 유지" 체크 시: 30일

// ── 용어집(문서·용어집) 접근 허용 계정 (화이트리스트)
// ─ 보안: 이 ID로 로그인한 계정만 용어집을 볼 수 있음. 그 외 모든 k-tools 계정은 차단.
// ─ 계정 추가 시 이 배열에 ID만 추가 (k-tools 로그인 검증은 그대로 통과해야 함).
const DOCS_ALLOWED_IDS = ['KL_KAI_DOC']

export function canViewDocs(userId: string): boolean {
  return DOCS_ALLOWED_IDS.includes(userId)
}

// 표시용(non-httpOnly) 권한 쿠키 — 클라이언트(사이드바)가 메뉴 노출 판단에만 사용.
// ─ 위조 가능하지만 실 보안은 /afmetcal-hub 서버 라우트가 책임짐(위조해도 HTML은 403).
export const DOCS_COOKIE = 'cb_docs'

// 쿠키 도메인: www.caliboard.kr / caliboard.kr 양쪽에서 공유되도록 '.caliboard.kr'로 발급.
// ─ domain 미지정 시 쿠키가 발급 호스트 전용(host-only)이 되어, www↔apex 이동 중 쿠키 누락 → 불규칙 로그아웃.
// ─ 개발(localhost)에서는 domain을 붙이면 안 됨(쿠키 무효) → undefined로 두어 host-only 동작.
const AUTH_COOKIE_DOMAIN =
  process.env.NODE_ENV === 'production' ? '.caliboard.kr' : undefined

interface Credentials {
  userId: string
  userPwd: string
}

export function setAuthCookie(
  res: NextResponse,
  credentials: Credentials,
  remember = false,
): void {
  // "로그인 유지" 체크 시 30일, 아니면 24시간
  const maxAge = remember ? AUTH_COOKIE_REMEMBER_MAX_AGE_SEC : AUTH_COOKIE_MAX_AGE_SEC

  const value = Buffer.from(JSON.stringify(credentials)).toString('base64')
  res.cookies.set(AUTH_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
    domain: AUTH_COOKIE_DOMAIN,
  })

  // 표시용 권한 쿠키 (사이드바 메뉴 노출용 — httpOnly 아님). 인증 쿠키와 수명 일치.
  res.cookies.set(DOCS_COOKIE, canViewDocs(credentials.userId) ? '1' : '0', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
    domain: AUTH_COOKIE_DOMAIN,
  })
}

// 서버 라우트용: 인증 쿠키를 풀어 userId의 용어집 권한을 판정 (위조 불가 — httpOnly 쿠키 기반)
export function reqCanViewDocs(request: NextRequest): boolean {
  const raw = request.cookies.get(AUTH_COOKIE)?.value
  if (!raw) return false
  try {
    const { userId } = JSON.parse(Buffer.from(raw, 'base64').toString()) as Credentials
    return canViewDocs(userId)
  } catch {
    return false
  }
}

// 로그아웃: setAuthCookie와 동일한 domain/path로 만료시켜야 실제로 삭제됨.
// ─ domain이 다르면 브라우저가 다른 쿠키로 보고 원본을 안 지움.
export function clearAuthCookie(res: NextResponse): void {
  for (const name of [AUTH_COOKIE, DOCS_COOKIE]) {
    res.cookies.set(name, '', {
      httpOnly: name === AUTH_COOKIE,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
      domain: AUTH_COOKIE_DOMAIN,
    })
  }
}
