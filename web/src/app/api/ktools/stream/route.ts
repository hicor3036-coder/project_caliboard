// SSE 스트리밍 API: 수집 진행 상황을 실시간으로 전달
// 응답 시작 시점에 인증 쿠키 maxAge를 갱신 (데이터 신선도와 세션을 함께 연장)
import { NextRequest } from 'next/server'
import { fetchAll } from '@/lib/ktools-fetch'
import { analyzeAll } from '@/lib/ktools-analyze'
import { setCache, getCacheStatus, getSessionId } from '@/lib/cache'
import { AUTH_COOKIE, AUTH_COOKIE_MAX_AGE_SEC } from '@/lib/auth-session'

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

// SSE Response 헤더용 Set-Cookie 문자열 (NextResponse.cookies가 아닌 raw Response를 쓰므로 수동 구성)
function buildAuthCookieHeader(encodedAuth: string): string {
  const parts = [
    `${AUTH_COOKIE}=${encodedAuth}`,
    'Path=/',
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SEC}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

export async function GET(request: NextRequest) {
  const creds = getCredentials(request)
  if (!creds) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const cachedSession = getSessionId()
        const result = await fetchAll(creds.userId, creds.userPwd, (info) => {
          send('progress', info)
        }, cachedSession)

        send('progress', { stage: 'analyze', current: 0, total: 0, message: '데이터 분석 중...' })
        const analysis = analyzeAll(result.items, result.fetchedAt)
        setCache(result.items, result.fetchedAt, result.sessionId)

        send('complete', { ...analysis, cache: getCacheStatus() })
      } catch (error) {
        const msg = error instanceof Error ? error.message : '알 수 없는 오류'
        send('error', { message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      // 응답 시작 시점에 쿠키 만료 시각 연장 (데이터 신선도와 세션을 동일 시계로)
      'Set-Cookie': buildAuthCookieHeader(creds.raw),
    },
  })
}
