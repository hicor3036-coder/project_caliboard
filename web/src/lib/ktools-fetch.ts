// k-tools 데이터 수집 (페이지네이션)

import { ktoolsLogin } from './ktools-login'

const BASE_URL = 'https://k-tools.ktl.re.kr'
const API_URL = `${BASE_URL}/spm/api/spm0907_getConsignPrjcDtlEquipList.ajax`

// spm0907.do 페이지 접근 (API 호출 전제조건 — 세션에 cnsnClsIdx 설정)
async function ensureSpmAccess(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/spm/contents/spm0907.do?cnsnClsIdx=32`, {
    headers: { 'Cookie': `KTOOLS_JSESSIONID=${sessionId}` },
  })
}

// KAI 과제코드 목록
const PRJC_CD_LIST = '[KL151000, KL161020, KL171020, KL171140, KL180940, KL181200, KL211420, KL221490, KL231360, KL241520, KL251650]'

export interface KtoolsItem {
  acptNo: string
  rcpnYmd: string | null
  exrsWrtnYmd: string | null
  fnshScdlYmd: string | null
  nxtrExrsYmd: string | null
  snctYmd: string | null
  isncYmd: string | null
  smplOutDate: string | null
  rectYmd: string | null
  prdNm: string | null
  entpPrdNm: string | null
  prdnCmpnNm: string | null
  stszNm: string | null
  pgstNm: string | null
  prjcCd: string | null
  mngmDvsnNm: string | null
  mngmRsprNm: string | null
  mngmRsprTel: string | null
  apcnCmnm: string | null
  apcnNm: string | null
  totalFee: number
  totalSum: number
  affcCyclCd: string | null
  gyeoljeStatus: string | null
  sieDsncCd: string | null
  custEqpmSrno: string | null
  mctlNo: string | null
  [key: string]: unknown
}

// 단일 페이지 조회
async function fetchPage(
  sessionId: string,
  page: number = 0,
  pageCount: number = 3000
): Promise<{ list: KtoolsItem[]; totalCount: number }> {
  const body = new URLSearchParams({
    page: String(page),
    pageCount: String(pageCount),
    startDt: '',
    endDt: '',
    exrsWrtnYmdStart: '',
    exrsWrtnYmdEnd: '',
    entpPrdNm: '',
    prdnCmpnNm: '',
    stszNm: '',
    mctlNo: '',
    mctlNoTwo: '',
    acptNo: '',
    exrsCmnm: '',
    pgstNm: '',
    custEqpmSrno: '',
    cnsnClsIdx: '32',
    prjcCdList: PRJC_CD_LIST,
    apcnNmList: '',
    apcnDvsnNmList: '',
    prjcCdFList: '',
    filterCol: 'PRJC_CD',
  })

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': `KTOOLS_JSESSIONID=${sessionId}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  })

  const text = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text)
  } catch {
    // JSON 파싱 실패 → HTML 리다이렉트(로그인 페이지) 등
    console.error('[fetchPage] JSON 파싱 실패, 응답:', text.slice(0, 300))
    throw new Error('SESSION_EXPIRED')
  }

  // 세션 만료 체크
  if (json.code === 401) {
    throw new Error('SESSION_EXPIRED')
  }

  // 응답 구조 체크
  const data = json.data as { list?: KtoolsItem[]; totalCount?: number } | undefined
  if (!data || !Array.isArray(data.list)) {
    console.error('[fetchPage] 예상치 못한 응답 구조:', JSON.stringify(json).slice(0, 500))
    throw new Error('SESSION_EXPIRED')
  }

  return {
    list: data.list,
    totalCount: data.totalCount ?? 0,
  }
}

// 진행 상황 콜백 타입
export type ProgressCallback = (info: {
  stage: 'login' | 'fetch' | 'analyze' | 'done'
  current: number
  total: number
  message: string
}) => void

// 전체 데이터 수집 (페이지네이션 + 자동 재로그인)
export type FetchAllResult = { items: KtoolsItem[]; fetchedAt: Date; sessionId: string }

export async function fetchAll(
  userId: string,
  userPwd: string,
  onProgress?: ProgressCallback,
  existingSessionId?: string | null,
): Promise<FetchAllResult> {

  // 로그인 or 세션 재사용
  let sessionId: string
  if (existingSessionId) {
    console.log('기존 세션 재사용')
    sessionId = existingSessionId
  } else {
    onProgress?.({ stage: 'login', current: 0, total: 0, message: 'k-tools 로그인 중...' })
    sessionId = await ktoolsLogin(userId, userPwd)
  }

  // spm0907.do 페이지 접근 (API 호출 전제조건)
  await ensureSpmAccess(sessionId)

  const allItems: KtoolsItem[] = []
  const pageCount = 3000
  let page = 0

  while (true) {
    let result: { list: KtoolsItem[]; totalCount: number }

    try {
      result = await fetchPage(sessionId, page, pageCount)
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        console.log('세션 만료 - 재로그인')
        onProgress?.({ stage: 'login', current: 0, total: 0, message: '세션 만료 - 재로그인 중...' })
        sessionId = await ktoolsLogin(userId, userPwd)
        await ensureSpmAccess(sessionId)
        result = await fetchPage(sessionId, page, pageCount)
      } else {
        throw e
      }
    }

    // 첫 페이지에서 0건 → 세션 만료로 간주, 재로그인 시도
    if (page === 0 && result.totalCount === 0 && existingSessionId) {
      console.log('첫 페이지 0건 — 세션 만료로 판단, 재로그인')
      onProgress?.({ stage: 'login', current: 0, total: 0, message: '세션 만료 - 재로그인 중...' })
      sessionId = await ktoolsLogin(userId, userPwd)
      await ensureSpmAccess(sessionId)
      result = await fetchPage(sessionId, page, pageCount)
    }

    allItems.push(...result.list)
    console.log(`  page=${page}, 수신=${result.list.length}건, 누적=${allItems.length}/${result.totalCount}건`)
    onProgress?.({
      stage: 'fetch',
      current: allItems.length,
      total: result.totalCount,
      message: `${allItems.length.toLocaleString()} / ${result.totalCount.toLocaleString()}건 수집`,
    })

    if (result.list.length === 0 || allItems.length >= result.totalCount) {
      break
    }

    page += pageCount
  }

  console.log(`수집 완료: 총 ${allItems.length}건`)
  return { items: allItems, fetchedAt: new Date(), sessionId }
}
