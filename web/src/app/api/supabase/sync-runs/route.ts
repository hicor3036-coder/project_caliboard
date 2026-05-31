// 아토믹 엔드포인트: sync_runs 테이블에 실행 로그 기록
// ─ 도메인 규칙: Supabase 클라이언트만 호출
// ─ 입력: { startedAt, finishedAt, itemCount, status, errorMessage?, triggeredBy? }
// ─ 동작: INSERT 1건 (성공/실패 결과를 한 번에 기록)
// ─ 출력: { id: number }
//
// 호출 예 (task/ktools-refresh 에서 사용):
//   POST /api/supabase/sync-runs
//   {
//     startedAt: "2026-05-31T10:00:00Z",
//     finishedAt: "2026-05-31T10:01:00Z",
//     itemCount: 9311,
//     status: "success",
//     triggeredBy: "manual"
//   }

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

interface CreateSyncRunBody {
  startedAt: string          // ISO timestamp
  finishedAt?: string | null // ISO timestamp (실패 시 null 가능)
  itemCount?: number | null
  status: 'running' | 'success' | 'failed'
  errorMessage?: string | null
  triggeredBy?: string | null
}

export async function POST(request: NextRequest) {
  let body: CreateSyncRunBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 })
  }

  if (!body.startedAt || !body.status) {
    return NextResponse.json({ error: 'startedAt, status는 필수입니다' }, { status: 400 })
  }
  if (!['running', 'success', 'failed'].includes(body.status)) {
    return NextResponse.json({ error: 'status는 running/success/failed 중 하나' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('sync_runs')
    .insert({
      started_at: body.startedAt,
      finished_at: body.finishedAt ?? null,
      item_count: body.itemCount ?? null,
      status: body.status,
      error_message: body.errorMessage ?? null,
      triggered_by: body.triggeredBy ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[supabase/sync-runs] INSERT 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id: data.id })
}
