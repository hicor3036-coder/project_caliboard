// API Route: Serper Image Search — 장비 사진 검색
import { NextRequest, NextResponse } from 'next/server'

const SERPER_API_KEY = '62ec848f45789141e4b822057ae20cf41041551f'
const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000 // 24시간
const BROWSER_CACHE_SEC = 86400 // 브라우저 캐시 24시간

interface ImageCacheEntry {
  imageUrl: string | null
  thumbnailUrl: string | null
  cachedAt: number
}

interface SerperImage {
  imageUrl: string
  thumbnailUrl: string
  title: string
  imageWidth: number
  imageHeight: number
  domain: string
}

// HMR 대응: global 캐시
declare global {
  // eslint-disable-next-line no-var
  var imageSearchCache: Map<string, ImageCacheEntry> | undefined
}

if (!global.imageSearchCache) {
  global.imageSearchCache = new Map()
}

// 이미지 품질 스코어링 — 제조사 공식 이미지 최우선
function scoreImage(img: SerperImage, searchTerms: string[], manufacturer: string): number {
  let score = 0
  const title = img.title.toLowerCase()
  const domain = img.domain.toLowerCase()
  const url = img.imageUrl.toLowerCase()
  const mfr = manufacturer.toLowerCase().replace(/[^a-z0-9]/g, '')

  // 1) 제조사 공식 도메인 — 최우선 (+50)
  const domainNorm = domain.replace(/[^a-z0-9]/g, '')
  if (mfr.length >= 2 && domainNorm.includes(mfr)) score += 50

  // 2) 모델명이 제목에 포함 (+20 per term)
  for (const term of searchTerms) {
    if (term.length >= 2 && title.includes(term.toLowerCase())) score += 20
  }

  // 3) 모델명이 URL에 포함 (+15)
  for (const term of searchTerms) {
    if (term.length >= 3 && url.includes(term.toLowerCase())) score += 15
  }

  // 4) 적절한 크기
  const w = img.imageWidth
  const h = img.imageHeight
  if (w >= 300 && w <= 2000 && h >= 300 && h <= 2000) score += 10
  if (w < 100 || h < 100) score -= 30

  // 5) 정방형에 가까울수록 제품 사진 가능성 높음
  const ratio = Math.max(w, h) / Math.max(Math.min(w, h), 1)
  if (ratio <= 1.5) score += 5

  // 6) 신뢰할 수 있는 쇼핑/장비 도메인
  const trustedDomains = ['amazon', 'ebay', 'aliexpress', 'grainger', 'indiamart']
  if (trustedDomains.some(d => domain.includes(d))) score += 10

  return score
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')
  if (!q || !q.trim()) {
    return NextResponse.json({ error: '검색어가 필요합니다' }, { status: 400 })
  }

  const baseQuery = q.trim()
  const cacheKey = baseQuery.toLowerCase()
  const noCache = request.nextUrl.searchParams.get('nocache') === '1'

  // 캐시 확인
  if (!noCache) {
    const cached = global.imageSearchCache!.get(cacheKey)
    if (cached && Date.now() - cached.cachedAt < IMAGE_CACHE_TTL) {
      return NextResponse.json(
        { imageUrl: cached.imageUrl, thumbnailUrl: cached.thumbnailUrl, cached: true },
        { headers: { 'Cache-Control': `public, max-age=${BROWSER_CACHE_SEC}` } },
      )
    }
  }

  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: baseQuery, num: 10 }),
    })

    if (!res.ok) {
      throw new Error(`Serper API HTTP ${res.status}`)
    }

    const data = await res.json()
    const images: SerperImage[] = data.images ?? []

    // 검색어를 토큰으로 분리 — 첫 토큰은 제조사명
    const searchTerms = baseQuery.split(/\s+/).filter(t => t.length >= 2)
    const manufacturer = searchTerms[0] ?? ''

    // 스코어링 후 최적 이미지 선택
    let imageUrl: string | null = null
    let thumbnailUrl: string | null = null
    if (images.length > 0) {
      const scored = images
        .map(img => ({ ...img, score: scoreImage(img, searchTerms, manufacturer) }))
        .sort((a, b) => b.score - a.score)
      const best = scored[0]
      imageUrl = best.imageUrl
      thumbnailUrl = best.thumbnailUrl || null
    }

    // 서버 메모리 캐시 저장
    global.imageSearchCache!.set(cacheKey, { imageUrl, thumbnailUrl, cachedAt: Date.now() })

    // 오래된 캐시 정리 (100개 초과 시)
    if (global.imageSearchCache!.size > 100) {
      const now = Date.now()
      for (const [key, entry] of global.imageSearchCache!) {
        if (now - entry.cachedAt > IMAGE_CACHE_TTL) {
          global.imageSearchCache!.delete(key)
        }
      }
    }

    return NextResponse.json(
      { imageUrl, thumbnailUrl, cached: false },
      { headers: { 'Cache-Control': `public, max-age=${BROWSER_CACHE_SEC}` } },
    )
  } catch (error) {
    console.error('이미지 검색 오류:', error)
    return NextResponse.json({ imageUrl: null, error: '이미지 검색 실패' })
  }
}
