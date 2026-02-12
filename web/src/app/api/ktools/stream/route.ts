// SSE 스트리밍 API: 수집 진행 상황을 실시간으로 전달
import { NextRequest } from 'next/server'
import { fetchAll } from '@/lib/ktools-fetch'
import { analyzeAll } from '@/lib/ktools-analyze'
import { setCache, getCacheStatus, getSessionId } from '@/lib/cache'

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
  const creds = getCredentials(request)
  if (!creds) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // SSE 이벤트 전송 헬퍼
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // 기존 세션 재사용 시도
        const cachedSession = getSessionId()
        const result = await fetchAll(creds.userId, creds.userPwd, (info) => {
          send('progress', info)
        }, cachedSession)

        // 분석
        send('progress', { stage: 'analyze', current: 0, total: 0, message: '데이터 분석 중...' })
        const analysis = analyzeAll(result.items, result.fetchedAt)
        setCache(result.items, result.fetchedAt, result.sessionId)

        // 완료 — 분석 결과 전송
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
    },
  })
}
