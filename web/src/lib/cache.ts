// k-tools 원천 데이터의 단일 소스 (Single Source of Truth)
// ─ 저장 위치: Node.js 서버 프로세스 메모리 (global 객체)
// ─ 공유 범위: 같은 프로세스 안의 모든 API 라우트
// ─ 갱신 규칙: ① 비어있음 → 수집  ② 수집 후 6시간 경과 → 수집  ③ 수동 새로고침 → 수집
// HMR(Hot Module Replacement) 시에도 유지되도록 global 객체 사용

import { KtoolsItem } from './ktools-fetch'

interface CacheData {
  items: KtoolsItem[]
  fetchedAt: Date
  dataExpiresAt: Date  // 데이터 신선도 만료 시각 (수집 후 6시간)
  sessionId?: string   // k-tools JSESSIONID 재사용 (별개 개념)
}

// HMR 대응: global 객체에 캐시 저장
declare global {
  // eslint-disable-next-line no-var
  var ktoolsCache: CacheData | null | undefined
}

if (global.ktoolsCache === undefined) {
  global.ktoolsCache = null
}

const getInternalCache = (): CacheData | null => global.ktoolsCache ?? null
const setInternalCache = (data: CacheData | null): void => {
  global.ktoolsCache = data
}

// 데이터 신선도 TTL: 6시간
export const DATA_TTL_MS = 6 * 60 * 60 * 1000

// 캐시 조회 (유효한 경우에만 반환, 만료 시 null)
export function getCache(): CacheData | null {
  const cache = getInternalCache()
  if (!cache) return null

  if (new Date() > cache.dataExpiresAt) {
    console.log('[cache] 데이터 만료 (6시간 경과)')
    return null
  }

  return cache
}

// 만료 여부와 무관하게 원본 캐시 반환 (관리 화면용)
export function peekCache(): CacheData | null {
  return getInternalCache()
}

export function setCache(items: KtoolsItem[], fetchedAt: Date, sessionId?: string): void {
  setInternalCache({
    items,
    fetchedAt,
    dataExpiresAt: new Date(fetchedAt.getTime() + DATA_TTL_MS),
    sessionId,
  })
}

export function getSessionId(): string | null {
  const cache = getInternalCache()
  return cache?.sessionId ?? null
}

export function setSessionId(sessionId: string): void {
  const cache = getInternalCache()
  if (cache) {
    cache.sessionId = sessionId
    setInternalCache(cache)
  }
}

export function clearCache(): void {
  console.log('[cache] 캐시 비움')
  setInternalCache(null)
}

// 캐시 상태 메타데이터 (관리 화면용 — 만료된 캐시도 표시)
export function getCacheStatus() {
  const cache = getInternalCache()
  if (!cache) {
    return {
      cached: false as const,
      ttlMs: DATA_TTL_MS,
    }
  }
  const now = Date.now()
  const remainingMs = cache.dataExpiresAt.getTime() - now
  const ageMs = now - cache.fetchedAt.getTime()
  return {
    cached: true as const,
    itemCount: cache.items.length,
    fetchedAt: cache.fetchedAt.toISOString(),
    expiresAt: cache.dataExpiresAt.toISOString(),
    ageMs,
    remainingMs,
    expired: remainingMs <= 0,
    hasSession: !!cache.sessionId,
    ttlMs: DATA_TTL_MS,
  }
}
