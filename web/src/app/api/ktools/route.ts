// API Route: 데이터 수집 + 분석 + 메모리 캐싱
// 동시 수집 방어는 fetchAll 내부에서 처리 (단일 진실)
// 수집 성공 시 인증 쿠키 maxAge 갱신 → 데이터 신선도와 세션 만료가 함께 움직임
import { NextRequest, NextResponse } from 'next/server'
import { fetchAll } from '@/lib/ktools-fetch'
import { analyzeAll } from '@/lib/ktools-analyze'
import { getCache, setCache, getCacheStatus, getSessionId } from '@/lib/cache'
import { AUTH_COOKIE, refreshAuthCookie } from '@/lib/auth-session'

function getCredentials(request: NextRequest): { userId: string; userPwd: string; raw: string } | null {
  const auth = request.cookies.get(AUTH_COOKIE)?.value
  if (!auth) return null
  try {
    const parsed = JSON.parse(Buffer.from(auth, 'base64').toString())
    return { ...parsed, raw: auth }
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
    const cached = !refresh ? getCache() : null

    let items, fetchedAt: Date
    let didFetch = false

    if (cached) {
      items = cached.items
      fetchedAt = cached.fetchedAt
      console.log(`캐시 사용: ${items.length}건`)
    } else {
      console.log('데이터 수집 시작...')
      const result = await fetchAll(creds.userId, creds.userPwd, undefined, getSessionId())
      items = result.items
      fetchedAt = result.fetchedAt
      setCache(items, fetchedAt, result.sessionId)
      didFetch = true
      console.log(`수집 완료 + 캐시 저장: ${items.length}건`)
    }

    const analysis = analyzeAll(items, fetchedAt)
    const res = NextResponse.json({
      ...analysis,
      cache: getCacheStatus(),
    })
    // 데이터를 새로 수집한 경우 세션 쿠키 만료 시각 연장
    if (didFetch) refreshAuthCookie(res, creds.raw)
    return res
  } catch (error) {
    console.error('API 오류:', error)

    const msg = error instanceof Error ? error.message : '알 수 없는 오류'
    if (msg.includes('로그인 실패')) {
      return NextResponse.json({ error: '세션이 만료되었습니다. 다시 로그인하세요.' }, { status: 401 })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
