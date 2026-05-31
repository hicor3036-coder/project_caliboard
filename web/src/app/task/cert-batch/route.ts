// task: 장비 그룹의 교정성적서 일괄 파싱 (SSE)
// ─ 도메인: ktools + cert + supabase 합법적 조합 — task만 가능
// ─ 호출처: equipment-detail-page → useCertData 훅 (EventSource)
//
// GET /task/cert-batch?groupNm=X[&refresh=1]
//   SSE 이벤트:
//     event: progress    data: { total, acptNo, status }
//     event: cert        data: { acptNo, result: CertResult }
//     event: cert_error  data: { acptNo, error }
//     event: complete    data: { totalProcessed, totalErrors }
//
// 흐름:
//   1. /api/ktools/session POST → sessionId (자격증명 쿠키 사용)
//   2. /api/ktools/group-equip?sessionId=...&groupNm=X → acptNo 목록 (그룹 전체 이력)
//   3. 각 acptNo에 대해:
//      a) /api/ktools/cert-excel?sessionId=...&acptNo=Y → Excel buffer (또는 204)
//      b) buffer 있으면 /api/cert/parse → CertResult
//      c) SSE cert/cert_error 이벤트로 발송
//   4. complete
//
// ⚠️ Vercel Hobby plan 30초 timeout — 그룹에 PDF 많으면 부족할 수 있음.
//    이 atom은 로컬 dev에서 정상 동작. Vercel 대응은 후속 작업.

import { NextRequest } from 'next/server'

interface DetailItemMinimal {
  acptNo: string
  pgstNm: string  // "완료" 같은 상태로 성적서 존재 여부 추정
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(request: NextRequest) {
  const groupNm = request.nextUrl.searchParams.get('groupNm')?.trim()
  if (!groupNm) {
    return new Response('groupNm 필수', { status: 400 })
  }

  const origin = request.nextUrl.origin
  const cookieHeader = request.headers.get('cookie') ?? ''
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      let processed = 0
      let errors = 0

      try {
        // 초기 진행률
        send('progress', { total: 0, acptNo: '', status: '세션 발급 중...' })

        // ── 1. ktools 세션 발급 (자격증명 쿠키 → sessionId)
        const sessionRes = await fetch(`${origin}/api/ktools/session`, {
          method: 'POST',
          headers: { cookie: cookieHeader },
        })
        if (!sessionRes.ok) {
          send('cert_error', { acptNo: '', error: `session 발급 실패: ${sessionRes.status}` })
          send('complete', { totalProcessed: 0, totalErrors: 1 })
          controller.close()
          return
        }
        const { sessionId } = await sessionRes.json() as { sessionId: string }

        // ── 2. group-equip atom으로 그룹의 acptNo 목록 받기 (k-tools 실시간, 전체 이력)
        send('progress', { total: 0, acptNo: '', status: '그룹 이력 조회 중...' })
        const detailRes = await fetch(
          `${origin}/api/ktools/group-equip?sessionId=${encodeURIComponent(sessionId)}&groupNm=${encodeURIComponent(groupNm)}`,
        )
        if (!detailRes.ok) {
          send('cert_error', { acptNo: '', error: `group-equip 실패: ${detailRes.status}` })
          send('complete', { totalProcessed: 0, totalErrors: 1 })
          controller.close()
          return
        }
        const { items } = await detailRes.json() as { items: DetailItemMinimal[] }
        const acptNos = items.map(i => i.acptNo).filter(Boolean)

        if (acptNos.length === 0) {
          send('complete', { totalProcessed: 0, totalErrors: 0 })
          controller.close()
          return
        }

        // ── 3. 각 acptNo에 대해 cert-excel + cert/parse (순차)
        //   — Vercel timeout 회피 위해 청크 병렬도 가능하지만 LLM 워커풀이 이미 병렬화하니 순차로 충분
        for (const acptNo of acptNos) {
          processed++
          send('progress', { total: acptNos.length, acptNo, status: `[${processed}/${acptNos.length}] 다운로드 중...` })

          try {
            // 3-a) Excel 다운로드
            const excelRes = await fetch(
              `${origin}/api/ktools/cert-excel?sessionId=${encodeURIComponent(sessionId)}&acptNo=${encodeURIComponent(acptNo)}`,
            )

            if (excelRes.status === 204) {
              // PDF 없음 — 에러가 아니라 skip
              send('cert_error', { acptNo, error: 'PDF 없음 (성적서 미발급)' })
              errors++
              continue
            }

            if (excelRes.status === 401) {
              send('cert_error', { acptNo, error: 'SESSION_EXPIRED' })
              errors++
              break  // 세션 만료면 이후 호출 다 실패 — 중단
            }

            if (!excelRes.ok) {
              const text = await excelRes.text().catch(() => '')
              send('cert_error', { acptNo, error: `cert-excel ${excelRes.status}: ${text.slice(0, 100)}` })
              errors++
              continue
            }

            const excelBuffer = await excelRes.arrayBuffer()

            // 3-b) cert/parse 호출 (binary stream)
            send('progress', { total: acptNos.length, acptNo, status: `[${processed}/${acptNos.length}] 파싱 중...` })

            const parseRes = await fetch(
              `${origin}/api/cert/parse?acptNo=${encodeURIComponent(acptNo)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: excelBuffer,
              },
            )

            if (!parseRes.ok) {
              const text = await parseRes.text().catch(() => '')
              send('cert_error', { acptNo, error: `cert/parse ${parseRes.status}: ${text.slice(0, 100)}` })
              errors++
              continue
            }

            const result = await parseRes.json()
            send('cert', { acptNo, result })

          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            send('cert_error', { acptNo, error: msg })
            errors++
          }
        }

        send('complete', { totalProcessed: processed, totalErrors: errors })
      } catch (err) {
        const msg = err instanceof Error ? err.message : '알 수 없는 오류'
        send('cert_error', { acptNo: '', error: msg })
        send('complete', { totalProcessed: processed, totalErrors: errors + 1 })
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
