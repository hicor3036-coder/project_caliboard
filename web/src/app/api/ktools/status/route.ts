// 단일 소스(global.ktoolsCache)의 메타데이터 조회
// 만료된 캐시도 그대로 노출 (관리 화면이 정확한 상태를 알 수 있도록)
import { NextRequest, NextResponse } from 'next/server'
import { getCacheStatus } from '@/lib/cache'

export async function GET(request: NextRequest) {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) {
    return NextResponse.json({ error: '로그인 필요' }, { status: 401 })
  }

  return NextResponse.json(getCacheStatus())
}
