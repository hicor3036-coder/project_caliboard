// 서버 메모리 캐시 — 수집된 데이터를 유지하여 매번 재수집 방지
// Vercel 서버리스에서는 인스턴스별 캐시 (cold start 시 초기화)

import { KtoolsItem } from './ktools-fetch'

interface CacheData {
  items: KtoolsItem[]
  fetchedAt: Date
  sessionExpiresAt: Date  // 로그인 후 약 2시간
}

let cache: CacheData | null = null

const SESSION_TTL_MS = 110 * 60 * 1000  // 110분 (2시간 만료 전 여유)

export function getCache(): CacheData | null {
  if (!cache) return null

  // 세션 만료 체크
  if (new Date() > cache.sessionExpiresAt) {
    console.log('캐시 만료 (세션 TTL 초과)')
    cache = null
    return null
  }

  return cache
}

export function setCache(items: KtoolsItem[], fetchedAt: Date): void {
  cache = {
    items,
    fetchedAt,
    sessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS),
  }
}

export function clearCache(): void {
  cache = null
}

export function getCacheStatus() {
  if (!cache) return { cached: false as const }
  return {
    cached: true as const,
    itemCount: cache.items.length,
    fetchedAt: cache.fetchedAt.toISOString(),
    expiresAt: cache.sessionExpiresAt.toISOString(),
    remainingMs: cache.sessionExpiresAt.getTime() - Date.now(),
  }
}
