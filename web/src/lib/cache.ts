// k-tools 원천 데이터의 단일 소스 (Single Source of Truth)
// ─ 저장 백엔드:
//    • Vercel (서버리스): Upstash Redis (KV) — 람다 인스턴스 간 공유
//    • 로컬 dev / KV 환경변수 없음: Node.js global 객체 (메모리 폴백)
// ─ 갱신 규칙: ① 비어있음 → 수집  ② 수집 후 6시간 경과 → 수집  ③ 수동 새로고침 → 수집
// HMR(Hot Module Replacement) 시에도 유지되도록 global 객체 사용 (메모리 모드)

import { Redis } from '@upstash/redis'
import { KtoolsItem } from './ktools-fetch'

interface CacheData {
  items: KtoolsItem[]
  fetchedAt: Date
  dataExpiresAt: Date  // 데이터 신선도 만료 시각 (수집 후 6시간)
  sessionId?: string   // k-tools JSESSIONID 재사용 (별개 개념)
}

// KV 직렬화 포맷 (Date → ISO 문자열)
interface SerializedCache {
  items: KtoolsItem[]
  fetchedAt: string
  dataExpiresAt: string
  sessionId?: string
}

// 데이터 신선도 TTL: 6시간
export const DATA_TTL_MS = 6 * 60 * 60 * 1000
const TTL_SECONDS = DATA_TTL_MS / 1000

// KV 키
const KEY_CACHE = 'ktools:cache'
const KEY_SESSION = 'ktools:session'

// KV 클라이언트 (환경변수 자동 인식: KV_REST_API_URL / KV_REST_API_TOKEN)
// 환경변수 없으면 null → 메모리 폴백
const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
const redis = hasKV ? Redis.fromEnv() : null

if (typeof window === 'undefined') {
  // 서버에서만 로그 (빌드 타임 무소음)
  console.log(`[cache] backend: ${hasKV ? 'Upstash Redis (KV)' : 'in-memory global'}`)
}

// ─── 메모리 폴백 (KV 없을 때) ───
declare global {
  // eslint-disable-next-line no-var
  var ktoolsCache: CacheData | null | undefined
  // eslint-disable-next-line no-var
  var ktoolsSessionId: string | null | undefined
}
if (global.ktoolsCache === undefined) global.ktoolsCache = null
if (global.ktoolsSessionId === undefined) global.ktoolsSessionId = null

// ─── 직렬화 helpers ───
function serialize(cache: CacheData): SerializedCache {
  return {
    items: cache.items,
    fetchedAt: cache.fetchedAt.toISOString(),
    dataExpiresAt: cache.dataExpiresAt.toISOString(),
    sessionId: cache.sessionId,
  }
}

function deserialize(raw: SerializedCache): CacheData {
  return {
    items: raw.items,
    fetchedAt: new Date(raw.fetchedAt),
    dataExpiresAt: new Date(raw.dataExpiresAt),
    sessionId: raw.sessionId,
  }
}

// ─── 캐시 조회 (유효한 경우에만 반환, 만료 시 null) ───
export async function getCache(): Promise<CacheData | null> {
  if (redis) {
    const raw = await redis.get<SerializedCache>(KEY_CACHE)
    if (!raw) return null
    const cache = deserialize(raw)
    if (new Date() > cache.dataExpiresAt) {
      console.log('[cache] 데이터 만료 (6시간 경과)')
      return null
    }
    return cache
  }
  // 메모리 폴백
  const cache = global.ktoolsCache ?? null
  if (!cache) return null
  if (new Date() > cache.dataExpiresAt) {
    console.log('[cache] 데이터 만료 (6시간 경과)')
    return null
  }
  return cache
}

// ─── 만료 여부와 무관하게 원본 캐시 반환 (관리 화면용) ───
export async function peekCache(): Promise<CacheData | null> {
  if (redis) {
    const raw = await redis.get<SerializedCache>(KEY_CACHE)
    return raw ? deserialize(raw) : null
  }
  return global.ktoolsCache ?? null
}

export async function setCache(items: KtoolsItem[], fetchedAt: Date, sessionId?: string): Promise<void> {
  const cache: CacheData = {
    items,
    fetchedAt,
    dataExpiresAt: new Date(fetchedAt.getTime() + DATA_TTL_MS),
    sessionId,
  }
  if (redis) {
    await redis.set(KEY_CACHE, serialize(cache), { ex: TTL_SECONDS })
    if (sessionId) await redis.set(KEY_SESSION, sessionId, { ex: TTL_SECONDS })
    return
  }
  global.ktoolsCache = cache
  if (sessionId) global.ktoolsSessionId = sessionId
}

// ─── 세션 ID 조회 — 데이터 캐시(items)와 독립적으로 살아있음 ───
export async function getSessionId(): Promise<string | null> {
  if (redis) {
    const sid = await redis.get<string>(KEY_SESSION)
    if (sid) return sid
    // 세션 슬롯이 비었으면 데이터 캐시에 묻혀있는 sessionId라도 반환
    const raw = await redis.get<SerializedCache>(KEY_CACHE)
    return raw?.sessionId ?? null
  }
  return global.ktoolsSessionId ?? global.ktoolsCache?.sessionId ?? null
}

// ─── 세션 ID 저장 — 데이터 캐시는 건드리지 않음 ───
// 로그인 직후나 detail/cert 라우트의 재로그인 시 사용 → 다음 수집에서 재사용
export async function setSessionId(sessionId: string): Promise<void> {
  if (redis) {
    await redis.set(KEY_SESSION, sessionId, { ex: TTL_SECONDS })
    // 데이터 캐시에도 sessionId만 갱신 (있을 때만)
    const raw = await redis.get<SerializedCache>(KEY_CACHE)
    if (raw) {
      raw.sessionId = sessionId
      // TTL 유지: 남은 시간만큼만 다시 저장
      const remainingMs = new Date(raw.dataExpiresAt).getTime() - Date.now()
      if (remainingMs > 0) {
        await redis.set(KEY_CACHE, raw, { ex: Math.ceil(remainingMs / 1000) })
      }
    }
    return
  }
  global.ktoolsSessionId = sessionId
  if (global.ktoolsCache) global.ktoolsCache.sessionId = sessionId
}

export async function clearCache(): Promise<void> {
  console.log('[cache] 캐시 비움')
  if (redis) {
    await redis.del(KEY_CACHE)
    // 세션 ID는 보존 — k-tools 재로그인 비용 절감
    return
  }
  global.ktoolsCache = null
}

// ─── 캐시 상태 메타데이터 (관리 화면용 — 만료된 캐시도 표시) ───
export async function getCacheStatus() {
  let cache: CacheData | null = null
  if (redis) {
    const raw = await redis.get<SerializedCache>(KEY_CACHE)
    if (raw) cache = deserialize(raw)
  } else {
    cache = global.ktoolsCache ?? null
  }

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
