// task: k-tools 데이터 풀 동기화
// ─ 역할: k-tools에서 prjcCdList에 해당하는 모든 데이터를 받아 Supabase에 동기화
// ─ 도메인: 여러 도메인(ktools, supabase)을 합법적으로 조합하는 유일한 계층
// ─ 입력: { sessionId, prjcCdList[], pageCount? }
// ─ 세션 유효성은 호출자 책임 — task는 SESSION_EXPIRED 시 분기처리만
// ─ Phase D: equipment-detail용 12개 컬럼 매핑 추가 (mappers.ts 갱신 반영)
// ─ Phase D2: 페이지 단위 POST를 500건씩 분할 (3000건 단일 POST에서 30건 silent loss 발생 이력)
// ─ 응답: SSE 스트림 (진행률 + 결과)
//
// 흐름:
//   1. items atom 호출 (page=0)
//   2. supabase items POST (upsert, syncedAt=startedAt)
//   3. while 누적 < totalCount: items + supabase items 반복
//   4. supabase items DELETE (?syncedBefore=startedAt) — orphan 정리
//   5. sync-runs POST — 결과 기록
//
// SSE 이벤트:
//   event: progress  data: { stage, current, total, message }
//   event: done      data: { upserted, deleted, durationMs }
//   event: error     data: { stage, message, sessionExpired }

import { NextRequest } from 'next/server'

interface RefreshRequest {
  sessionId: string
  prjcCdList: string[]
  pageCount?: number
}

// k-tools가 요구하는 포맷: "[KL230640, KL251650]"
function formatPrjcCdList(codes: string[]): string {
  return `[${codes.join(', ')}]`
}

// SSE 헬퍼: 한 줄 이벤트
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: NextRequest) {
  // 본문 파싱
  let body: RefreshRequest
  try {
    body = await request.json()
  } catch {
    return new Response('JSON 파싱 실패', { status: 400 })
  }

  if (!body.sessionId) return new Response('sessionId 필수', { status: 400 })
  if (!Array.isArray(body.prjcCdList) || body.prjcCdList.length === 0) {
    return new Response('prjcCdList 배열이 비어있습니다', { status: 400 })
  }

  const sessionId = body.sessionId
  const prjcCdList = formatPrjcCdList(body.prjcCdList)
  const pageCount = body.pageCount ?? 3000
  const origin = request.nextUrl.origin
  const startedAt = new Date()                       // sync 기준 시각 (orphan 판정 기준)
  const startedAtIso = startedAt.toISOString()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      let totalUpserted = 0
      let totalCount = 0
      let lastError: { stage: string; message: string; sessionExpired: boolean } | null = null

      try {
        // ──────────────────────────────────────────────────────────────
        // 1~3. 페이지 순회: items atom → supabase items POST 반복
        // ──────────────────────────────────────────────────────────────
        let page = 0
        let firstFetched = false

        while (true) {
          // [3-a] items atom 호출
          send('progress', {
            stage: 'fetch',
            current: totalUpserted,
            total: totalCount,
            message: `${totalUpserted.toLocaleString()} / ${totalCount.toLocaleString()}건 — 페이지 요청 중 (page=${page})`,
          })

          const itemsUrl = new URL(`${origin}/api/ktools/items`)
          itemsUrl.searchParams.set('sessionId', sessionId)
          itemsUrl.searchParams.set('page', String(page))
          itemsUrl.searchParams.set('pageCount', String(pageCount))
          itemsUrl.searchParams.set('prjcCdList', prjcCdList)

          const itemsRes = await fetch(itemsUrl.toString())
          if (!itemsRes.ok) {
            const isAuth = itemsRes.status === 401
            const errBody = await itemsRes.text().catch(() => '')
            lastError = {
              stage: 'fetch',
              message: `items atom 실패 (status=${itemsRes.status}): ${errBody}`,
              sessionExpired: isAuth,
            }
            break
          }

          const itemsJson = await itemsRes.json() as { list: unknown[]; totalCount: number }
          if (!firstFetched) {
            totalCount = itemsJson.totalCount
            firstFetched = true
          }
          const list = itemsJson.list ?? []
          if (list.length === 0) break

          // [3-b] supabase items POST (upsert, syncedAt=startedAt)
          // 페이지(3000건)를 500건 단위로 분할 POST — Next.js route body 한도 회피 +
          // sub-MB JSON으로 안전. supabase/items 라우트도 정합성 검증(사후 SELECT) 보유.
          const SUB_CHUNK = 500
          let pageUpserted = 0
          let pageUpsertFailed = false
          for (let s = 0; s < list.length; s += SUB_CHUNK) {
            const slice = list.slice(s, s + SUB_CHUNK)
            send('progress', {
              stage: 'upsert',
              current: totalUpserted + pageUpserted,
              total: totalCount,
              message: `${slice.length}건 DB 저장 중... (page=${page}, offset=${s})`,
            })

            const upsertRes = await fetch(`${origin}/api/supabase/items`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: slice, syncedAt: startedAtIso }),
            })
            if (!upsertRes.ok) {
              const errBody = await upsertRes.text().catch(() => '')
              lastError = {
                stage: 'upsert',
                message: `supabase upsert 실패 (page=${page}, offset=${s}): ${errBody}`,
                sessionExpired: false,
              }
              pageUpsertFailed = true
              break
            }
            const upsertJson = await upsertRes.json() as { upserted: number }
            pageUpserted += upsertJson.upserted
          }
          if (pageUpsertFailed) break
          totalUpserted += pageUpserted

          // 진행률 갱신
          send('progress', {
            stage: 'fetch',
            current: totalUpserted,
            total: totalCount,
            message: `${totalUpserted.toLocaleString()} / ${totalCount.toLocaleString()}건 누적`,
          })

          // 종료 조건
          if (totalUpserted >= totalCount) break
          page += pageCount
        }

        // 에러 분기처리 (세션 만료 등)
        if (lastError) {
          send('error', lastError)
          // sync-runs에 실패 기록
          await recordSyncRun(origin, {
            startedAt: startedAtIso,
            finishedAt: new Date().toISOString(),
            itemCount: totalUpserted,
            status: 'failed',
            errorMessage: lastError.message,
            triggeredBy: 'user',
          })
          controller.close()
          return
        }

        // ──────────────────────────────────────────────────────────────
        // 4. orphan 삭제 (synced_at < startedAt)
        // ──────────────────────────────────────────────────────────────
        send('progress', {
          stage: 'cleanup',
          current: totalUpserted,
          total: totalCount,
          message: 'orphan 정리 중...',
        })

        let deleted = 0
        const delUrl = new URL(`${origin}/api/supabase/items`)
        delUrl.searchParams.set('syncedBefore', startedAtIso)
        // 방어선 3 (최소 10초 이전) 통과 보장 — task가 10초 미만에 끝났으면 sleep
        const elapsedMs = Date.now() - startedAt.getTime()
        if (elapsedMs < 11_000) {
          await new Promise(r => setTimeout(r, 11_000 - elapsedMs))
        }
        const delRes = await fetch(delUrl.toString(), { method: 'DELETE' })
        if (!delRes.ok) {
          const errBody = await delRes.text().catch(() => '')
          // orphan 삭제 실패는 치명적이지 않음 — 경고만 보내고 진행
          send('progress', {
            stage: 'cleanup',
            current: totalUpserted,
            total: totalCount,
            message: `orphan 정리 실패 (무시): ${errBody}`,
          })
        } else {
          const delJson = await delRes.json() as { deleted: number; sampleAcptNos?: string[] }
          deleted = delJson.deleted
        }

        // ──────────────────────────────────────────────────────────────
        // 5. sync-runs 기록
        // ──────────────────────────────────────────────────────────────
        await recordSyncRun(origin, {
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          itemCount: totalUpserted,
          status: 'success',
          triggeredBy: 'user',
        })

        const durationMs = Date.now() - startedAt.getTime()
        send('done', { upserted: totalUpserted, deleted, durationMs })
      } catch (err) {
        const msg = err instanceof Error ? err.message : '알 수 없는 오류'
        send('error', { stage: 'unknown', message: msg, sessionExpired: false })
        await recordSyncRun(origin, {
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          itemCount: totalUpserted,
          status: 'failed',
          errorMessage: msg,
          triggeredBy: 'user',
        }).catch(() => { /* 로깅 실패는 무시 */ })
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

// sync-runs atom 호출 (best-effort 로깅)
async function recordSyncRun(
  origin: string,
  payload: {
    startedAt: string
    finishedAt: string
    itemCount: number
    status: 'success' | 'failed'
    errorMessage?: string
    triggeredBy: string
  }
): Promise<void> {
  try {
    await fetch(`${origin}/api/supabase/sync-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[task/ktools-refresh] sync-runs 기록 실패:', err)
  }
}
