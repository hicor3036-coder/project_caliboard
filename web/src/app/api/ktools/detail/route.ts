// API Route: 장비 상세 이력 조회 (groupNm 기반)
import { NextRequest, NextResponse } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'
import { getSessionId, setSessionId } from '@/lib/cache'

const API_URL = 'https://k-tools.ktl.re.kr/spm/api/spm0907_getConsignPrjcDtlEquipGroupList.ajax'
const PRJC_CD_LIST = '[KL230640, KL251650]'

function getCredentials(request: NextRequest): { userId: string; userPwd: string } | null {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) return null
  try {
    return JSON.parse(Buffer.from(auth, 'base64').toString())
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItem(item: Record<string, any>) {
  return {
    prjcCd: item.prjcCd ?? '',
    acptNo: item.acptNo ?? '',
    rcpnYmd: item.rcpnYmd ?? '',
    exrsWrtnYmd: item.exrsWrtnYmd ?? '',
    fnshScdlYmd: item.fnshScdlYmd ?? '',
    snctYmd: item.snctYmd ?? '',
    isncYmd: item.isncYmd ?? '',
    smplOutDate: item.smplOutDate ?? '',
    pgstNm: item.pgstNm ?? '',
    gyeoljeStatus: item.gyeoljeStatus ?? '',
    mngmRsprNm: item.mngmRsprNm ?? '',
    mngmDvsnNm: item.mngmDvsnNm ?? '',
    entpPrdNm: item.entpPrdNm ?? '',
    prdnCmpnNm: item.prdnCmpnNm ?? '',
    stszNm: item.stszNm ?? '',
    prdNm: item.prdNm ?? '',
    mctlNo: item.mctlNo ?? '',
    custEqpmSrno: item.custEqpmSrno ?? '',
    affcCyclCd: item.affcCyclCd ?? '',
    nxtrExrsYmd: item.nxtrExrsYmd ?? '',
    totalFee: item.totalFee ?? 0,
    totalVat: item.totalVat ?? 0,
    totalSum: item.totalSum ?? 0,
    apcnCmnm: item.apcnCmnm ?? '',
    apcnNm: item.apcnNm ?? '',
    apcnTlno: item.apcnTlno ?? '',
    apcnEmlAdrs: item.apcnEmlAdrs ?? '',
  }
}

async function fetchDetail(sessionId: string, body: URLSearchParams) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': `KTOOLS_JSESSIONID=${sessionId}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  })
  return res.json()
}

export async function GET(request: NextRequest) {
  const groupNm = request.nextUrl.searchParams.get('groupNm')
  if (!groupNm) {
    return NextResponse.json({ error: 'groupNm 파라미터가 필요합니다' }, { status: 400 })
  }

  const creds = getCredentials(request)
  if (!creds) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  try {
    // 캐시된 세션 재사용, 없으면 로그인
    let sessionId = getSessionId()
    if (!sessionId) {
      sessionId = await ktoolsLogin(creds.userId, creds.userPwd)
      setSessionId(sessionId)
    }

    const body = new URLSearchParams({
      page: '0',
      pageCount: '100',
      cnsnClsIdx: '32',
      groupNm,
      prjcCdList: PRJC_CD_LIST,
    })

    let json = await fetchDetail(sessionId, body)

    // 세션 만료 시 재로그인 후 재시도
    if (json.code === 401) {
      sessionId = await ktoolsLogin(creds.userId, creds.userPwd)
      setSessionId(sessionId)
      json = await fetchDetail(sessionId, body)
      if (json.code === 401) {
        return NextResponse.json({ error: '세션 만료' }, { status: 401 })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (json.data?.list ?? []) as Record<string, any>[]
    return NextResponse.json({ items: list.map(mapItem) })
  } catch (error) {
    console.error('상세 조회 오류:', error)
    const msg = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
