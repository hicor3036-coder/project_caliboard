// 로그인 세션 쿠키 관리
// ─ 쿠키 maxAge = 24시간 (사내 도구 — 매일 1회 재로그인 정도가 적당)
// ─ 데이터 신선도 임계값과 다름 (인증과 데이터 정합성은 별개 목적)

import type { NextRequest, NextResponse } from 'next/server'

export const AUTH_COOKIE = 'ktools_auth'
export const AUTH_COOKIE_MAX_AGE_SEC = 24 * 60 * 60          // 기본: 24시간
export const AUTH_COOKIE_REMEMBER_MAX_AGE_SEC = 30 * 24 * 60 * 60  // "로그인 유지" 체크 시: 30일

// =====================================================================
// 용어집(문서·용어집) 접근 허용 계정 화이트리스트
// =====================================================================
// 이 목록에 있는 k-tools 계정만 "문서·용어집" 메뉴를 볼 수 있음.
// 그 외 모든 계정은 메뉴가 숨겨지고, URL 직접접근(/api/docs)도 403으로 차단됨.
//
// ┌─ 계정을 추가/제거하려면? ─────────────────────────────────────────┐
// │ 아래 배열에 ID 문자열만 추가/삭제하면 끝. 예) ['kl_kai_doc', 'kl_kai_doc2'] │
// │ ⚠️ 반드시 "소문자"로 적을 것 — 비교가 소문자 기준이라 대문자로 적으면 안 걸림. │
// │ 변경 후 git commit → push 하면 Vercel 자동 배포로 반영됨.              │
// └──────────────────────────────────────────────────────────────────┘
//
// 왜 ID 기반인가?
//  - k-tools 로그인 응답엔 회원 고유번호 같은 식별자가 없음(실측 확인:
//    {"result","message","returnType","url"} 만 반환). 우리가 가진 유일한
//    식별자는 사용자가 입력한 ID뿐 → ID가 사실상 고유키 역할.
//
// 입력 ID는 대소문자가 섞여 들어올 수 있으므로 trim+소문자화 후 비교한다.
// (KL_KAI_DOC / kl_kai_doc / Kl_Kai_Doc 모두 동일하게 허용)
const DOCS_ALLOWED_IDS = [
  'kl_kai_doc',   // KAI 문서·용어집 전용 계정
]

export function canViewDocs(userId: string): boolean {
  return DOCS_ALLOWED_IDS.includes(userId.trim().toLowerCase())
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
