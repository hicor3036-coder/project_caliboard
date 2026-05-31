// 일회성 마이그레이션: data/equipment-profiles.json → Supabase equipment_profiles
//
// 실행 (web 디렉토리에서, Node 22+):
//   node --env-file=.env.local scripts/migrate-profiles-to-supabase.mjs
//
// 전제:
//   - 0005_equipment_profiles.sql 적용 완료
//   - .env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정
//   - Node 22+ (--env-file 지원)
//
// 동작:
//   1. data/equipment-profiles.json 읽기
//   2. profile-cache.ts의 normalizeForKey()와 동일 규칙으로 키 생성
//   3. Supabase upsert (manufacturer_key, model_key) PK 충돌 시 UPDATE
//   4. 검증: 전체 count 비교

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 필수')
  process.exit(1)
}

// profile-cache.ts와 동일한 정규화 규칙
function normalizeForKey(s) {
  return (s || '')
    .toUpperCase()
    .replace(/[\s\-_/\\.,()[\]{}'"+:;#!@&*~`]/g, '')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const JSON_PATH = 'data/equipment-profiles.json'

console.log(`[migrate] reading ${JSON_PATH}...`)
const raw = readFileSync(JSON_PATH, 'utf-8')
const profiles = JSON.parse(raw)
console.log(`[migrate] ${profiles.length} profiles loaded`)

// 키 충돌 사전 검사 (정규화 결과 동일한 게 있는지)
const seenKeys = new Map()
for (const p of profiles) {
  const k = `${normalizeForKey(p.manufacturer)}|${normalizeForKey(p.model)}`
  if (seenKeys.has(k)) {
    console.warn(`[migrate] WARNING 키 충돌: "${p.manufacturer}/${p.model}" ↔ "${seenKeys.get(k)}"`)
  } else {
    seenKeys.set(k, `${p.manufacturer}/${p.model}`)
  }
}

// upsert (충돌 시 마지막 것이 이김)
const rows = profiles.map(p => ({
  manufacturer_key: normalizeForKey(p.manufacturer),
  model_key:        normalizeForKey(p.model),
  manufacturer:     p.manufacturer,
  model:            p.model,
  profile_json:     p,
  updated_at:       p.updated_at
    ? new Date(p.updated_at).toISOString()
    : new Date().toISOString(),
}))

console.log(`[migrate] upserting ${rows.length} rows...`)

// 500건씩 청크 (소량이라 사실 한 번에 가능하지만 안전하게)
const CHUNK = 500
let upserted = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK)
  const { error } = await supabase
    .from('equipment_profiles')
    .upsert(chunk, { onConflict: 'manufacturer_key,model_key' })
  if (error) {
    console.error(`[migrate] upsert 실패 (chunk ${i}~${i + chunk.length}):`, error)
    process.exit(1)
  }
  upserted += chunk.length
  console.log(`[migrate] ${upserted}/${rows.length}`)
}

// 검증
const { count, error: countErr } = await supabase
  .from('equipment_profiles')
  .select('*', { count: 'exact', head: true })

if (countErr) {
  console.error('[migrate] count 검증 실패:', countErr)
  process.exit(1)
}

console.log(`[migrate] done. supabase row count = ${count}, expected ≥ ${rows.length}`)
if (count < rows.length) {
  console.error('[migrate] WARNING — Supabase count가 JSON 수보다 적음. 키 충돌이 있었을 수 있음')
  process.exit(1)
}
console.log('[migrate] ✅ 검증 완료')
