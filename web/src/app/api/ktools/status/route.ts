// 캐시 상태만 빠르게 확인 (데이터 수집 없음)
import { NextRequest, NextResponse } from 'next/server'
import { getCacheStatus } from '@/lib/cache'

export async function GET(request: NextRequest) {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) {
    return NextResponse.json({ error: '로그인 필요' }, { status: 401 })
  }

  return NextResponse.json(getCacheStatus())
}
