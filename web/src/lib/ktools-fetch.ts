// k-tools 데이터 수집 (페이지네이션)

import { ktoolsLogin } from './ktools-login'

const API_URL = 'https://k-tools.ktl.re.kr/spm/api/spm0907_getConsignPrjcDtlEquipList.ajax'

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

  const json = await res.json()

  // 세션 만료 체크
  if (json.code === 401) {
    throw new Error('SESSION_EXPIRED')
  }

  return {
    list: json.data.list as KtoolsItem[],
    totalCount: json.data.totalCount as number,
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
export async function fetchAll(
  userId: string,
  userPwd: string,
  onProgress?: ProgressCallback,
  existingSessionId?: string | null,
): Promise<{ items: KtoolsItem[]; fetchedAt: Date; sessionId: string }> {

  let sessionId: string
  if (existingSessionId) {
    console.log('기존 세션 재사용')
    sessionId = existingSessionId
  } else {
    onProgress?.({ stage: 'login', current: 0, total: 0, message: 'k-tools 로그인 중...' })
    sessionId = await ktoolsLogin(userId, userPwd)
  }

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
        result = await fetchPage(sessionId, page, pageCount)
      } else {
        throw e
      }
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
