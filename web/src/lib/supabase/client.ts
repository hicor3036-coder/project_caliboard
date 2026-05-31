// Supabase 클라이언트 (서버사이드 전용, 싱글톤)
// ─ service_role 키 사용 → RLS 우회 (anon 키 클라이언트 노출 경로 차단)
// ─ HMR 대응: global 객체에 인스턴스 보관

import { createClient, SupabaseClient } from '@supabase/supabase-js'

declare global {
  // eslint-disable-next-line no-var
  var supabaseAdmin: SupabaseClient | undefined
}

function build(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('SUPABASE_URL 환경변수가 설정되지 않았습니다')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getSupabase(): SupabaseClient {
  if (!global.supabaseAdmin) {
    global.supabaseAdmin = build()
  }
  return global.supabaseAdmin
}
