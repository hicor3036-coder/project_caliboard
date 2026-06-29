// 보호 라우트: 용어집(문서·용어집) HTML 제공
// ─ public/ 에서 빼낸 afmetcal-hub.html을 권한 검사 후에만 반환 (URL 직접접근 차단)
// ─ canViewDocs 권한이 있는 계정만 200, 아니면 403
// ─ 도메인 규칙: 인증은 이 라우트가 직접 책임 (쿠키 → userId → 화이트리스트)
import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { reqCanViewDocs } from '@/lib/auth-session'

export async function GET(request: NextRequest) {
  if (!reqCanViewDocs(request)) {
    return new NextResponse('이 계정은 문서·용어집 접근 권한이 없습니다.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const filePath = path.join(process.cwd(), 'protected', 'afmetcal-hub.html')
  const html = await readFile(filePath, 'utf-8')
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
