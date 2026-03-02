// API Route: 데이터 수집 + 분석 + 메모리 캐싱
import { NextRequest, NextResponse } from 'next/server'
import { fetchAll, type FetchAllResult } from '@/lib/ktools-fetch'
import { analyzeAll } from '@/lib/ktools-analyze'
import { getCache, setCache, getCacheStatus, getSessionId } from '@/lib/cache'

// 동시 수집 방지: 진행 중인 fetchAll Promise를 공유
let activeFetch: Promise<FetchAllResult> | null = null

// 쿠키에서 자격증명 추출
function getCredentials(request: NextRequest): { userId: string; userPwd: string } | null {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) return null
  try {
    return JSON.parse(Buffer.from(auth, 'base64').toString())
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === 'true'

  const creds = getCredentials(request)
  if (!creds) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  try {
    // 캐시 확인
    const cached = !refresh ? getCache() : null

    let items, fetchedAt: Date

    if (cached) {
      items = cached.items
      fetchedAt = cached.fetchedAt
      console.log(`캐시 사용: ${items.length}건`)
    } else if (activeFetch) {
      // 이미 수집 중 → 같은 Promise 대기
      console.log('수집 진행 중 — 기존 요청 대기...')
      const result = await activeFetch
      items = result.items
      fetchedAt = result.fetchedAt
    } else {
      console.log('데이터 수집 시작...')
      const cachedSession = getSessionId()
      activeFetch = fetchAll(creds.userId, creds.userPwd, undefined, cachedSession)
      try {
        const result = await activeFetch
        items = result.items
        fetchedAt = result.fetchedAt
        setCache(items, fetchedAt, result.sessionId)
        console.log(`수집 완료 + 캐시 저장: ${items.length}건`)
      } finally {
        activeFetch = null
      }
    }

    // 분석
    const analysis = analyzeAll(items, fetchedAt)
    const cacheStatus = getCacheStatus()

    return NextResponse.json({
      ...analysis,
      cache: cacheStatus,
    })
  } catch (error) {
    console.error('API 오류:', error)

    // 세션 만료로 인한 로그인 실패 시 401 반환
    const msg = error instanceof Error ? error.message : '알 수 없는 오류'
    if (msg.includes('로그인 실패')) {
      return NextResponse.json({ error: '세션이 만료되었습니다. 다시 로그인하세요.' }, { status: 401 })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
