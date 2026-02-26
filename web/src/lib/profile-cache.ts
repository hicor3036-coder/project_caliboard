// 장비 사전정보 메모리 캐시 + JSON 파일 영구 저장
// - 제조사+모델 단위로 저장 (장비 N대 → 고유 모델 1건)
// - cert-cache.ts와 동일한 global 캐시 패턴 (HMR 대응)
// - 서버 시작 시 JSON 파일에서 자동 로딩

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// ─── 타입 정의 ───

export interface EquipmentProfile {
  manufacturer: string
  model: string
  category: string | null
  source: 'web_search' | 'manual_pdf' | 'manual_input'
  verified: boolean
  source_urls: string[]

  spec: {
    range: string | null
    accuracy: string | null
    resolution: string | null
    units: string[] | null
    overload_limit: string | null
    // 구 필드 (런타임 마이그레이션 후 null)
    manual_tolerance: {
      value: number
      unit: string
      type: 'absolute' | 'percentage'
      note: string | null
    } | null
    // 신규: 장비 대표 허용오차 (절대값)
    tolerance: { value: number; unit: string; note: string | null } | null
    // 신규: MPE = 허용오차의 X%. null이면 기본 100%
    mpe_percent: number | null
  }

  environment: {
    operating_temp: string | null
    storage_temp: string | null
    operating_humidity: string | null
    ip_rating: string | null
    warmup_time: string | null
  }

  power: {
    type: string | null
    battery: string | null
    battery_life: string | null
    charge_time: string | null
  }

  interface: {
    output: string[] | null
    software: string | null
    wireless: string | null
    memory: string | null
  }

  calibration: {
    recommended_cycle: string | null
    self_calibration: boolean | null
    standards: string[] | null
    stability_spec: string | null
    drift_spec: string | null
  }

  maintenance: { cycle: string; task: string }[]

  cautions: string[]

  meta: {
    country: string | null
    discontinued: boolean | null
    successor_model: string | null
    alternatives: string[]
    approx_price: string | null
    support_url: string | null
    manual_url: string | null
  }

  updated_at: string
}

// ─── JSON 파일 경로 ───

const DATA_PATH = join(process.cwd(), 'data', 'equipment-profiles.json')

// ─── Global 캐시 ───

declare global {
  // eslint-disable-next-line no-var
  var profileCache: Map<string, EquipmentProfile> | undefined
}

// 퍼지 매칭: 대소문자, 공백, 특수문자 무시
function normalizeForKey(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[\s\-_/\\.,()[\]{}'"+:;#!@&*~`]/g, '')
}

function makeKey(manufacturer: string, model: string): string {
  return `${normalizeForKey(manufacturer)}|${normalizeForKey(model)}`
}

// manual_tolerance → tolerance + mpe_percent 자동 마이그레이션
function migrateProfile(p: EquipmentProfile): EquipmentProfile {
  const mt = p.spec.manual_tolerance
  if (mt && p.spec.tolerance === undefined && p.spec.mpe_percent === undefined) {
    if (mt.type === 'absolute') {
      p.spec.tolerance = { value: mt.value, unit: mt.unit, note: mt.note ?? null }
      p.spec.mpe_percent = 100
    } else {
      // percentage → MPE%로 이전, tolerance는 미설정
      p.spec.tolerance = null
      p.spec.mpe_percent = mt.value
    }
    p.spec.manual_tolerance = null
  }
  // 필드 누락 보정 (구 데이터)
  if (p.spec.tolerance === undefined) p.spec.tolerance = null
  if (p.spec.mpe_percent === undefined) p.spec.mpe_percent = null
  return p
}

// JSON 파일 → Map 로딩
function loadFromFile(): Map<string, EquipmentProfile> {
  const map = new Map<string, EquipmentProfile>()
  try {
    if (existsSync(DATA_PATH)) {
      const raw = readFileSync(DATA_PATH, 'utf-8')
      const arr: EquipmentProfile[] = JSON.parse(raw)
      for (const p of arr) {
        map.set(makeKey(p.manufacturer, p.model), migrateProfile(p))
      }
    }
  } catch (e) {
    console.error('[profile-cache] JSON 파일 로딩 실패:', e)
  }
  return map
}

// Map → JSON 파일 저장
function saveToFile(map: Map<string, EquipmentProfile>): void {
  try {
    const arr = Array.from(map.values())
    writeFileSync(DATA_PATH, JSON.stringify(arr, null, 2), 'utf-8')
  } catch (e) {
    console.error('[profile-cache] JSON 파일 저장 실패:', e)
  }
}

// 캐시 초기화 (서버 시작 시 자동)
function ensureCache(): Map<string, EquipmentProfile> {
  if (!global.profileCache) {
    global.profileCache = loadFromFile()
    console.log(`[profile-cache] ${global.profileCache.size}건 로딩됨`)
  }
  return global.profileCache
}

// ─── 공개 함수 ───

export function getProfile(manufacturer: string, model: string): EquipmentProfile | null {
  const cache = ensureCache()
  return cache.get(makeKey(manufacturer, model)) ?? null
}

export function setProfile(profile: EquipmentProfile): void {
  const cache = ensureCache()
  cache.set(makeKey(profile.manufacturer, profile.model), profile)
  saveToFile(cache)
}

export function deleteProfile(manufacturer: string, model: string): boolean {
  const cache = ensureCache()
  const key = makeKey(manufacturer, model)
  if (!cache.has(key)) return false
  cache.delete(key)
  saveToFile(cache)
  return true
}

export function getAllProfiles(): EquipmentProfile[] {
  const cache = ensureCache()
  return Array.from(cache.values())
}

export function getProfileStats() {
  const cache = ensureCache()
  return { total: cache.size }
}

// 전체 통계 (UI용)
export function getProfileSummary() {
  const profiles = getAllProfiles()
  return { total: profiles.length, collected: profiles.length }
}

// 캐시 강제 리로드 (파일 수동 수정 후)
export function reloadProfiles(): void {
  global.profileCache = loadFromFile()
  console.log(`[profile-cache] 리로드: ${global.profileCache.size}건`)
}
