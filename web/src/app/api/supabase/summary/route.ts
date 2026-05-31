// 아토믹 엔드포인트: 대시보드 상단 KPI 4종 + 마지막 동기화 시각
// ─ 도메인 규칙: Supabase 클라이언트만 호출
//
// GET /api/supabase/summary
//   응답:
//   {
//     total:              전체 건수
//     unprocessed:        pgst_nm LIKE '%미처리%' 건수
//     upcoming30:         차기교정일 D-30 이내 건수 (오늘 ≤ nxtr_exrs_ymd ≤ 오늘+30)
//     avgDurationDays:    (exrs_wrtn_ymd - rcpn_ymd) 평균 (둘 다 있는 row만)
//     lastSyncedAt:       sync_runs 최신 success.finished_at (없으면 null)
//   }
//
// 주의: avg는 Postgres에서 계산해야 정확. supabase-js 직접 쿼리로는 어려우므로
// 마이그레이션 0002에서 RPC 함수를 추가. 본 atom은 RPC 호출 + 단순 count 조합.

import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

export async function GET() {
  const supabase = getSupabase()
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  // 총건수
  const totalQ = supabase
    .from('ktools_items')
    .select('*', { count: 'exact', head: true })

  // 미처리 건수
  const unprocessedQ = supabase
    .from('ktools_items')
    .select('*', { count: 'exact', head: true })
    .ilike('pgst_nm', '%미처리%')

  // D-30 이내 임박 건수
  const upcomingQ = supabase
    .from('ktools_items')
    .select('*', { count: 'exact', head: true })
    .gte('nxtr_exrs_ymd', today)
    .lte('nxtr_exrs_ymd', in30)

  // 평균 소요일 — RPC (avg_duration_days)
  const avgQ = supabase.rpc('avg_duration_days')

  // 최신 sync 시각
  const lastSyncQ = supabase
    .from('sync_runs')
    .select('finished_at')
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const [totalR, unprocR, upcomR, avgR, lastR] = await Promise.all([
    totalQ, unprocessedQ, upcomingQ, avgQ, lastSyncQ,
  ])

  for (const [name, r] of [
    ['total', totalR], ['unprocessed', unprocR], ['upcoming30', upcomR],
    ['avgDurationDays', avgR], ['lastSyncedAt', lastR],
  ] as const) {
    if (r.error) {
      console.error(`[supabase/summary] ${name} 조회 실패:`, r.error)
      return NextResponse.json({ error: r.error.message, where: name }, { status: 500 })
    }
  }

  return NextResponse.json({
    total: totalR.count ?? 0,
    unprocessed: unprocR.count ?? 0,
    upcoming30: upcomR.count ?? 0,
    avgDurationDays: typeof avgR.data === 'number' ? Math.round(avgR.data) : 0,
    lastSyncedAt: lastR.data?.finished_at ?? null,
  })
}
