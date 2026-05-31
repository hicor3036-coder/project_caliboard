// k-tools 단일 페이지 조회 — atom 1회 호출에 대응
// ─ 페이지 순회, 자동 재로그인, 동시 수집 방어는 모두 task 책임 (이 파일에 없음)
// ─ 검색 파라미터 전부 외부 노출

const BASE_URL = 'https://k-tools.ktl.re.kr'
const API_URL = `${BASE_URL}/spm/api/spm0907_getConsignPrjcDtlEquipList.ajax`
const GROUP_API_URL = `${BASE_URL}/spm/api/spm0907_getConsignPrjcDtlEquipGroupList.ajax`
const SPM_PAGE_URL = `${BASE_URL}/spm/contents/spm0907.do?cnsnClsIdx=32`

// k-tools 응답 1건의 타입 — 실제 응답은 ~110개 필드라 [key: string]: unknown 유지
// equipment-detail용 12개 필드도 명시 (Phase D — 2026-05-31)
export interface KtoolsItem {
  acptNo: string
  rcpnYmd: string | null
  exrsWrtnYmd: string | null
  fnshScdlYmd: string | null
  nxtrExrsYmd: string | null
  prdNm: string | null
  entpPrdNm: string | null
  prdnCmpnNm: string | null
  stszNm: string | null
  pgstNm: string | null
  prjcCd: string | null
  mngmRsprNm: string | null
  totalSum: number
  custEqpmSrno: string | null
  mctlNo: string | null

  // equipment-detail용 (Phase D)
  snctYmd?: string | null
  isncYmd?: string | null
  smplOutDate?: string | null
  gyeoljeStatus?: string | null
  mngmDvsnNm?: string | null
  affcCyclCd?: string | null
  totalFee?: number | null
  totalVat?: number | null
  apcnCmnm?: string | null
  apcnNm?: string | null
  apcnTlno?: string | null
  apcnEmlAdrs?: string | null

  [key: string]: unknown
}

// k-tools API 검색 파라미터 — 전부 노출 (atom의 입력)
// 빈 문자열은 "조건 없음" 의미 (k-tools 측 약속)
export interface FetchPageParams {
  // 페이지
  page: number
  pageCount: number

  // 날짜 범위
  startDt?: string
  endDt?: string
  exrsWrtnYmdStart?: string
  exrsWrtnYmdEnd?: string

  // 텍스트 검색
  entpPrdNm?: string
  prdnCmpnNm?: string
  stszNm?: string
  mctlNo?: string
  mctlNoTwo?: string
  acptNo?: string
  exrsCmnm?: string
  pgstNm?: string
  custEqpmSrno?: string

  // 분류/필터
  cnsnClsIdx?: string         // 기본 '32'
  prjcCdList?: string         // 콤마 구분 과제코드
  apcnNmList?: string
  apcnDvsnNmList?: string
  prjcCdFList?: string
  filterCol?: string          // 기본 'PRJC_CD'
}

export interface FetchPageResult {
  list: KtoolsItem[]
  totalCount: number
}

// k-tools 세션 전제조건: spm0907.do 페이지 1회 방문 → 세션에 cnsnClsIdx 설정
// atom이 매 호출마다 부르면 됨 (k-tools는 idempotent)
export async function ensureSpmAccess(sessionId: string): Promise<void> {
  await fetch(SPM_PAGE_URL, {
    headers: { 'Cookie': `KTOOLS_JSESSIONID=${sessionId}` },
  })
}

// k-tools API 1회 호출 — 단일 페이지 조회
// 세션 만료 시 SESSION_EXPIRED 에러 throw (재로그인은 호출자 책임)
export async function fetchPage(
  sessionId: string,
  params: FetchPageParams,
): Promise<FetchPageResult> {
  const body = new URLSearchParams({
    page: String(params.page),
    pageCount: String(params.pageCount),
    startDt: params.startDt ?? '',
    endDt: params.endDt ?? '',
    exrsWrtnYmdStart: params.exrsWrtnYmdStart ?? '',
    exrsWrtnYmdEnd: params.exrsWrtnYmdEnd ?? '',
    entpPrdNm: params.entpPrdNm ?? '',
    prdnCmpnNm: params.prdnCmpnNm ?? '',
    stszNm: params.stszNm ?? '',
    mctlNo: params.mctlNo ?? '',
    mctlNoTwo: params.mctlNoTwo ?? '',
    acptNo: params.acptNo ?? '',
    exrsCmnm: params.exrsCmnm ?? '',
    pgstNm: params.pgstNm ?? '',
    custEqpmSrno: params.custEqpmSrno ?? '',
    cnsnClsIdx: params.cnsnClsIdx ?? '32',
    prjcCdList: params.prjcCdList ?? '',
    apcnNmList: params.apcnNmList ?? '',
    apcnDvsnNmList: params.apcnDvsnNmList ?? '',
    prjcCdFList: params.prjcCdFList ?? '',
    filterCol: params.filterCol ?? 'PRJC_CD',
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
    console.error('[fetchPage] JSON 파싱 실패, 응답:', text.slice(0, 300))
    throw new Error('SESSION_EXPIRED')
  }

  if (json.code === 401) {
    throw new Error('SESSION_EXPIRED')
  }

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

// k-tools 그룹 단위 상세 조회 — 한 group_nm의 전체 이력 (과거 포함)
// ─ 기본 fetchPage는 그룹 대표 1건씩만 반환 (group_cnt=N 정보만)
// ─ 이 호출로 실제 N건 받음
export async function fetchGroupEquip(
  sessionId: string,
  groupNm: string,
  prjcCdListParam: string,
): Promise<KtoolsItem[]> {
  const body = new URLSearchParams({
    page: '0',
    pageCount: '500',
    cnsnClsIdx: '32',
    groupNm,
    prjcCdList: prjcCdListParam,
  })

  const res = await fetch(GROUP_API_URL, {
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
    console.error('[fetchGroupEquip] JSON 파싱 실패, 응답:', text.slice(0, 300))
    throw new Error('SESSION_EXPIRED')
  }

  if (json.code === 401) {
    throw new Error('SESSION_EXPIRED')
  }

  const data = json.data as { list?: KtoolsItem[] } | undefined
  if (!data || !Array.isArray(data.list)) {
    console.error('[fetchGroupEquip] 예상치 못한 응답 구조:', JSON.stringify(json).slice(0, 500))
    throw new Error('SESSION_EXPIRED')
  }

  return data.list
}
