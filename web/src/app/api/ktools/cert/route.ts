// SSE API: 교정성적서 다운로드 + 파싱 (건별 스트리밍)
//
// GET /api/ktools/cert?groupNm=XXX
//
// SSE 이벤트:
//   progress:    { current, total, acptNo, status }
//   cert:        { acptNo, result }  (개별 건 완료)
//   cert_error:  { acptNo, error }   (개별 건 실패)
//   complete:    { total, success, fail }
//   error:       { message }         (전체 에러)

import { NextRequest } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'
import { getSessionId, setSessionId } from '@/lib/cache'
import { getCert, setCert, deleteCert } from '@/lib/cert-cache'
import { downloadAndParseCert, ensureSpmAccess } from '@/lib/cert-download'

const DETAIL_API = 'https://k-tools.ktl.re.kr/spm/api/spm0907_getConsignPrjcDtlEquipGroupList.ajax'
const PRJC_CD_LIST = '[KL151000, KL161020, KL171020, KL171140, KL180940, KL181200, KL211420, KL221490, KL231360, KL241520, KL251650]'
const DELAY_BETWEEN_MS = 300 // k-tools 부하 방지

function getCredentials(request: NextRequest): { userId: string; userPwd: string } | null {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) return null
  try {
    return JSON.parse(Buffer.from(auth, 'base64').toString())
  } catch {
    return null
  }
}

// 장비 상세 이력에서 완료 건의 acptNo 목록 추출
async function fetchCompletedAcceptNos(
  sessionId: string,
  groupNm: string,
): Promise<string[]> {
  const body = new URLSearchParams({
    page: '0',
    pageCount: '100',
    cnsnClsIdx: '32',
    groupNm,
    prjcCdList: PRJC_CD_LIST,
  })

  const res = await fetch(DETAIL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': `KTOOLS_JSESSIONID=${sessionId}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`detail API HTTP ${res.status}`)
  }

  const json = await res.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (json.data?.list ?? []) as Record<string, any>[]

  // 완료 건만 필터링
  return list
    .filter(item => (item.pgstNm ?? '').includes('완료'))
    .map(item => item.acptNo as string)
    .filter(Boolean)
}

export async function GET(request: NextRequest) {
  const groupNm = request.nextUrl.searchParams.get('groupNm')
  if (!groupNm) {
    return new Response(JSON.stringify({ error: 'groupNm 필요' }), { status: 400 })
  }
  const refresh = request.nextUrl.searchParams.get('refresh') === 'true'

  const creds = getCredentials(request)
  if (!creds) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      function send(event: string, data: unknown) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      try {
        // 1. 세션 확보
        let sessionId = getSessionId()
        if (!sessionId) {
          sessionId = await ktoolsLogin(creds.userId, creds.userPwd)
          setSessionId(sessionId)
        }

        // 2. spm0907.do 접근 (API 전제조건)
        await ensureSpmAccess(sessionId)

        // 3. 완료 건 acptNo 목록
        let acptNos = await fetchCompletedAcceptNos(sessionId, groupNm)

        // 세션 만료 시 재로그인
        if (acptNos.length === 0) {
          sessionId = await ktoolsLogin(creds.userId, creds.userPwd)
          setSessionId(sessionId)
          await ensureSpmAccess(sessionId)
          acptNos = await fetchCompletedAcceptNos(sessionId, groupNm)
        }

        const total = acptNos.length
        if (total === 0) {
          send('complete', { total: 0, success: 0, fail: 0 })
          closed = true
          controller.close()
          return
        }

        let success = 0
        let fail = 0

        // 4. refresh 시 해당 건 캐시 삭제
        if (refresh) {
          for (const acptNo of acptNos) deleteCert(acptNo)
        }

        // 5. 건별 순차 처리
        for (let i = 0; i < total; i++) {
          const acptNo = acptNos[i]

          // 캐시 확인
          const cached = getCert(acptNo)
          if (cached) {
            send('progress', { current: i + 1, total, acptNo, status: 'cached' })
            send('cert', { acptNo, result: cached })
            success++
            continue
          }

          // 다운로드 + 파싱
          send('progress', { current: i + 1, total, acptNo, status: 'downloading' })

          try {
            const result = await downloadAndParseCert(sessionId, acptNo)
            if (result) {
              setCert(acptNo, result)
              send('cert', { acptNo, result })
              success++
            } else {
              send('cert_error', { acptNo, error: '다운로드 실패' })
              fail++
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : '파싱 실패'
            send('cert_error', { acptNo, error: msg })
            fail++
          }

          // k-tools 부하 방지
          if (i < total - 1) {
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS))
          }
        }

        send('complete', { total, success, fail })
      } catch (error) {
        console.error('[cert] SSE 에러:', error)
        const msg = error instanceof Error ? error.message : '알 수 없는 오류'
        try { send('error', { message: msg }) } catch { /* 컨트롤러 닫힌 경우 무시 */ }
      } finally {
        if (!closed) {
          try { controller.close() } catch { /* 이미 닫힌 경우 무시 */ }
          closed = true
        }
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
