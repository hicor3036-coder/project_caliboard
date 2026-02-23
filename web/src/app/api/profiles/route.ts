// 장비 사전정보 CRUD API
// GET  /api/profiles              → 전체 목록 (+ 통계)
// GET  /api/profiles?manufacturer=X&model=Y → 단건 조회
// PUT  /api/profiles              → 수동 편집/업데이트
// DELETE /api/profiles?manufacturer=X&model=Y → 삭제

import { NextRequest, NextResponse } from 'next/server'
import {
  getAllProfiles,
  getProfile,
  setProfile,
  deleteProfile,
  getProfileSummary,
  type EquipmentProfile,
} from '@/lib/profile-cache'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const manufacturer = searchParams.get('manufacturer')
  const model = searchParams.get('model')

  // 단건 조회
  if (manufacturer && model) {
    const profile = getProfile(manufacturer, model)
    if (!profile) {
      return NextResponse.json({ error: '프로필 없음' }, { status: 404 })
    }
    return NextResponse.json(profile)
  }

  // 전체 목록 + 통계
  const profiles = getAllProfiles()
  const summary = getProfileSummary()
  return NextResponse.json({ profiles, summary })
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as EquipmentProfile
    if (!body.manufacturer || !body.model) {
      return NextResponse.json({ error: '제조사/모델 필수' }, { status: 400 })
    }

    // updated_at 갱신
    body.updated_at = new Date().toISOString().slice(0, 10)

    setProfile(body)
    return NextResponse.json({ ok: true, profile: body })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '저장 실패'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const manufacturer = searchParams.get('manufacturer')
  const model = searchParams.get('model')

  if (!manufacturer || !model) {
    return NextResponse.json({ error: '제조사/모델 필수' }, { status: 400 })
  }

  const deleted = deleteProfile(manufacturer, model)
  if (!deleted) {
    return NextResponse.json({ error: '프로필 없음' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
