// 단일 소스(global.ktoolsCache) 비우기
// 데이터 소스 관리 화면의 [캐시 비우기] 버튼에서 호출
import { NextRequest, NextResponse } from 'next/server'
import { clearCache, getCacheStatus } from '@/lib/cache'

export async function DELETE(request: NextRequest) {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) {
    return NextResponse.json({ error: '로그인 필요' }, { status: 401 })
  }

  clearCache()
  return NextResponse.json({ success: true, status: getCacheStatus() })
}
