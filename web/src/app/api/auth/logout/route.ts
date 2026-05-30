// 로그아웃 API: 인증 쿠키만 제거
// ─ 캐시(global.ktoolsCache)는 건드리지 않음 (단일 소스 원칙 — 다음 사용자가 즉시 신선한 데이터 활용)
// ─ k-tools 서버 세션 무효화는 비용 대비 효과가 낮아 생략 (세션은 자체 TTL로 정리됨)
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.cookies.set('ktools_auth', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
  })
  return res
}
