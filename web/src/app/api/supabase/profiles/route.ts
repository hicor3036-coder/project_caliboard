// 아토믹 엔드포인트: 장비 사전정보(profiles) CRUD — Supabase 기반
// ─ 도메인 규칙: Supabase 클라이언트만 호출
// ─ 옛 /api/profiles 인터페이스 그대로 (manufacturer+model 키 호환)
// ─ 키 정규화: profile-cache.ts의 normalizeForKey()와 동일 규칙 — 대소문자/공백/특수문자 무시
//
// GET    /api/supabase/profiles
//   응답: { profiles: EquipmentProfile[], summary: { total, collected } }
//
// GET    /api/supabase/profiles?manufacturer=X&model=Y
//   응답: EquipmentProfile 단건 (없으면 404)
//
// PUT    /api/supabase/profiles
//   body: EquipmentProfile (manufacturer/model 필수)
//   동작: upsert (manufacturer_key, model_key 충돌 시 UPDATE)
//   응답: { ok: true, profile }
//
// DELETE /api/supabase/profiles?manufacturer=X&model=Y
//   응답: { ok: true } | 404

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase/client'

// profile-cache.ts와 동일한 정규화 규칙 (대소문자/공백/특수문자 제거)
function normalizeForKey(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[\s\-_/\\.,()[\]{}'"+:;#!@&*~`]/g, '')
}

// EquipmentProfile 타입은 옛 lib/profile-cache.ts와 동일
// (UI 컴포넌트가 그 타입을 import해서 쓰므로 형 호환 필수)
type EquipmentProfile = {
  manufacturer: string
  model: string
  [key: string]: unknown
}

// =====================================================================
// GET — 전체 목록 또는 단건
// =====================================================================
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const manufacturer = sp.get('manufacturer')?.trim()
  const model = sp.get('model')?.trim()
  const supabase = getSupabase()

  // 단건 조회
  if (manufacturer && model) {
    const { data, error } = await supabase
      .from('equipment_profiles')
      .select('profile_json')
      .eq('manufacturer_key', normalizeForKey(manufacturer))
      .eq('model_key', normalizeForKey(model))
      .maybeSingle()

    if (error) {
      console.error('[supabase/profiles GET single] 조회 실패:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: '프로필 없음' }, { status: 404 })
    }
    return NextResponse.json(data.profile_json)
  }

  // 전체 목록 + summary
  const { data, error } = await supabase
    .from('equipment_profiles')
    .select('profile_json')
    .order('manufacturer', { ascending: true })
    .range(0, 99999)

  if (error) {
    console.error('[supabase/profiles GET all] 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const profiles = (data ?? []).map(row => row.profile_json as EquipmentProfile)
  return NextResponse.json({
    profiles,
    summary: { total: profiles.length, collected: profiles.length },
  })
}

// =====================================================================
// PUT — upsert (단건)
// =====================================================================
export async function PUT(request: NextRequest) {
  let body: EquipmentProfile
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 })
  }

  if (!body.manufacturer || !body.model) {
    return NextResponse.json({ error: '제조사/모델 필수' }, { status: 400 })
  }

  // updated_at 갱신
  const updatedAt = new Date().toISOString().slice(0, 10)
  const profile: EquipmentProfile = { ...body, updated_at: updatedAt }

  const row = {
    manufacturer_key: normalizeForKey(body.manufacturer),
    model_key:        normalizeForKey(body.model),
    manufacturer:     body.manufacturer,
    model:            body.model,
    profile_json:     profile,
    updated_at:       new Date().toISOString(),
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('equipment_profiles')
    .upsert([row], { onConflict: 'manufacturer_key,model_key' })

  if (error) {
    console.error('[supabase/profiles PUT] upsert 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, profile })
}

// =====================================================================
// DELETE — 단건
// =====================================================================
export async function DELETE(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const manufacturer = sp.get('manufacturer')?.trim()
  const model = sp.get('model')?.trim()
  if (!manufacturer || !model) {
    return NextResponse.json({ error: '제조사/모델 필수' }, { status: 400 })
  }

  const supabase = getSupabase()
  const mfrKey = normalizeForKey(manufacturer)
  const modelKey = normalizeForKey(model)

  // 존재 확인 (없으면 404 반환 — 옛 인터페이스 호환)
  const { data: existing, error: checkErr } = await supabase
    .from('equipment_profiles')
    .select('manufacturer_key')
    .eq('manufacturer_key', mfrKey)
    .eq('model_key', modelKey)
    .maybeSingle()

  if (checkErr) {
    console.error('[supabase/profiles DELETE check] 실패:', checkErr)
    return NextResponse.json({ error: checkErr.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: '프로필 없음' }, { status: 404 })
  }

  const { error } = await supabase
    .from('equipment_profiles')
    .delete()
    .eq('manufacturer_key', mfrKey)
    .eq('model_key', modelKey)

  if (error) {
    console.error('[supabase/profiles DELETE] 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
