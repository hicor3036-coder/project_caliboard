// API Route: 장비 상세 이력 조회 (groupNm 기반)
import { NextRequest, NextResponse } from 'next/server'
import { ktoolsLogin } from '@/lib/ktools-login'

const API_URL = 'https://k-tools.ktl.re.kr/spm/api/spm0907_getConsignPrjcDtlEquipGroupList.ajax'
const PRJC_CD_LIST = '[KL151000, KL161020, KL171020, KL171140, KL180940, KL181200, KL211420, KL221490, KL231360, KL241520, KL251650]'

function getCredentials(request: NextRequest): { userId: string; userPwd: string } | null {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) return null
  try {
    return JSON.parse(Buffer.from(auth, 'base64').toString())
  } catch {
    return null
  }
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
    const sessionId = await ktoolsLogin(creds.userId, creds.userPwd)

    const body = new URLSearchParams({
      page: '0',
      pageCount: '100',
      cnsnClsIdx: '32',
      groupNm,
      prjcCdList: PRJC_CD_LIST,
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

    if (json.code === 401) {
      return NextResponse.json({ error: '세션 만료' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (json.data?.list ?? []) as Record<string, any>[]

    // 필요한 필드만 정리해서 반환
    const items = list.map(item => ({
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
    }))

    return NextResponse.json({ items })
  } catch (error) {
    console.error('상세 조회 오류:', error)
    const msg = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
