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

        // [diagnostic] 데이터 크기 측정 (KV 캐시 재시도 전략 결정용)
        const itemsJson = JSON.stringify(result.items)
        const itemsBytes = Buffer.byteLength(itemsJson, 'utf8')
        const analysis = analyzeAll(result.items, result.fetchedAt)
        const analysisJson = JSON.stringify(analysis)
        const analysisBytes = Buffer.byteLength(analysisJson, 'utf8')
        console.log(`[size] items: ${(itemsBytes/1024/1024).toFixed(2)}MB (${result.items.length}건), analysis: ${(analysisBytes/1024).toFixed(1)}KB`)

        // [diagnostic] gzip 압축 후 크기 측정 (KV 한도 10MB 통과 가능 여부 확인)
        const { gzipSync } = await import('zlib')
        const t0 = Date.now()
        const itemsGzipped = gzipSync(itemsJson)
        const compressMs = Date.now() - t0
        const itemsB64 = itemsGzipped.toString('base64')
        console.log(`[gzip] items: ${itemsBytes} → ${itemsGzipped.length}bytes (${(itemsGzipped.length/1024/1024).toFixed(2)}MB), base64: ${(itemsB64.length/1024/1024).toFixed(2)}MB, compress: ${compressMs}ms`)

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
