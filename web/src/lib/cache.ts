// 서버 메모리 캐시 — 수집된 데이터를 유지하여 매번 재수집 방지
// HMR(Hot Module Replacement) 시에도 유지되도록 global 객체 사용
// Vercel 서버리스에서는 인스턴스별 캐시 (cold start 시 초기화)

import { KtoolsItem } from './ktools-fetch'

interface CacheData {
  items: KtoolsItem[]
  fetchedAt: Date
  sessionExpiresAt: Date  // 로그인 후 약 2시간
  sessionId?: string      // k-tools JSESSIONID 재사용
}

// HMR 대응: global 객체에 캐시 저장
declare global {
  // eslint-disable-next-line no-var
  var ktoolsCache: CacheData | null | undefined
}

// 초기화 (global 객체 사용)
if (global.ktoolsCache === undefined) {
  global.ktoolsCache = null
}

const getInternalCache = (): CacheData | null => global.ktoolsCache ?? null
const setInternalCache = (data: CacheData | null): void => {
  global.ktoolsCache = data
}

const SESSION_TTL_MS = 110 * 60 * 1000  // 110분 (2시간 만료 전 여유)

export function getCache(): CacheData | null {
  const cache = getInternalCache()
  if (!cache) return null

  // 세션 만료 체크
  if (new Date() > cache.sessionExpiresAt) {
    console.log('캐시 만료 (세션 TTL 초과)')
    setInternalCache(null)
    return null
  }

  return cache
}

export function setCache(items: KtoolsItem[], fetchedAt: Date, sessionId?: string): void {
  setInternalCache({
    items,
    fetchedAt,
    sessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS),
    sessionId,
  })
}

export function getSessionId(): string | null {
  const cache = getInternalCache()
  if (!cache?.sessionId) return null
  if (new Date() > cache.sessionExpiresAt) return null
  return cache.sessionId
}

export function setSessionId(sessionId: string): void {
  const cache = getInternalCache()
  if (cache) {
    cache.sessionId = sessionId
    setInternalCache(cache)
  }
}

export function clearCache(): void {
  setInternalCache(null)
}

export function getCacheStatus() {
  const cache = getInternalCache()
  if (!cache) return { cached: false as const }
  return {
    cached: true as const,
    itemCount: cache.items.length,
    fetchedAt: cache.fetchedAt.toISOString(),
    expiresAt: cache.sessionExpiresAt.toISOString(),
    remainingMs: cache.sessionExpiresAt.getTime() - Date.now(),
  }
}
