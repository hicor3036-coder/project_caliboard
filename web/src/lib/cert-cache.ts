// 교정성적서 파싱 결과 메모리 캐시 (acptNo 단위)
// - 성적서는 불변 데이터이므로 TTL 없이 영구 캐싱
// - 서버 재시작 시 초기화됨 (허용 가능)
// - HMR 대응: global 객체 사용 (cache.ts 패턴 동일)

export interface MeasurementPoint {
  // 기존 (규칙기반 파싱, 하위호환)
  원본데이터: string[]
  숫자값: number[]
  판정: 'PASS' | 'FAIL'
  셀: string[]

  // LLM 구조화 파싱
  기준값?: string | null
  기준단위?: string | null
  지시값?: string | null
  지시단위?: string | null
  오차?: string | null
  오차단위?: string | null
  허용오차?: string | null
  허용오차단위?: string | null

  // 물리량 그룹 (복수 물리량 장비용, 예: "Temperature", "Humidity")
  물리량?: string | null

  // 측정불확도 (을지에서 추출, ISO 10012 §7.3.1)
  불확도?: string | null           // 확장불확도 U 값 (k=2)
  불확도단위?: string | null       // "mT", "%"
  불확도k?: number | null          // 포함인자 k (보통 2)
}

// 기준기 (Reference Standard) 1건
export interface ReferenceStandard {
  장비명: string | null
  제조사모델: string | null
  시리얼: string | null
  유효일: string | null       // 정규화된 날짜
  교정기관: string | null
}

export interface CertResult {
  성적서번호: string | null
  고객명: string | null
  장비명: string | null
  제조사: string | null
  모델: string | null
  시리얼: string | null
  관리번호: string | null
  교정일: string | null
  차기교정일: string | null
  적합성검토: boolean
  전체판정: 'PASS' | 'FAIL' | null
  측정포인트수: number
  측정헤더: string[]     // 적합성검토서 측정 테이블의 컬럼 헤더
  측정결과: MeasurementPoint[]
  불일치: { 항목: string; 갑지: string; 적합성검토: string }[]
  측정요약: string | null
  _llm_보강: string[]
  _llm_provider: string | null
  시트수: number
  시트목록: string[]

  // 갑지 확장 (ISO 10012 소급성/환경/기준기)
  온도: string | null
  습도: string | null
  교정장소: string | null
  교정방법: string | null
  기술지원코드: string | null       // "40508" (숫자만)
  기술지원코드원본: string | null   // "CP801-40508-1"
  기준기: ReferenceStandard[]
  교정자: string | null
  승인자: string | null
  승인자직위: string | null

  // 을지 불확도 파싱 여부
  을지파싱: boolean
}

interface CertCacheEntry {
  result: CertResult
  parsedAt: Date
}

declare global {
  // eslint-disable-next-line no-var
  var certCache: Map<string, CertCacheEntry> | undefined
}

if (!global.certCache) {
  global.certCache = new Map()
}

export function getCert(acptNo: string): CertResult | null {
  return global.certCache?.get(acptNo)?.result ?? null
}

export function setCert(acptNo: string, result: CertResult): void {
  global.certCache!.set(acptNo, { result, parsedAt: new Date() })
}

export function deleteCert(acptNo: string): void {
  global.certCache?.delete(acptNo)
}

export function getCertBulk(acptNos: string[]): Map<string, CertResult> {
  const map = new Map<string, CertResult>()
  for (const no of acptNos) {
    const entry = global.certCache?.get(no)
    if (entry) map.set(no, entry.result)
  }
  return map
}

export function getAllCachedCerts(): Map<string, CertResult> {
  const map = new Map<string, CertResult>()
  if (!global.certCache) return map
  for (const [acptNo, entry] of global.certCache) {
    map.set(acptNo, entry.result)
  }
  return map
}

export function getCertCacheStats() {
  const size = global.certCache?.size ?? 0
  return { size }
}
