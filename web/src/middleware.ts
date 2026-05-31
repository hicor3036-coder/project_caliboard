// 미들웨어: 비로그인 사용자 → /login 리다이렉트
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 로그인 페이지, API, task, 정적 파일은 통과
  // ─ /api/* : 아토믹 엔드포인트 (인증은 각 atom 책임)
  // ─ /task/* : 여러 아토믹을 조합한 워크플로우 (인증은 각 task 책임)
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/task/') ||
    pathname.startsWith('/_next/') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // 인증 쿠키 확인
  const auth = request.cookies.get('ktools_auth')
  if (!auth) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
