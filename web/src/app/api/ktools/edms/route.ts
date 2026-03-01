// 마크애니(MarkAny) 성적서 뷰어 EDMS 정보 조회
//
// GET /api/ktools/edms?acptNo=26-010119-02-012
//
// k-tools spm1105 팝업에서 EDMS_ID를 파싱하여 MarkAny 뷰어 URL을 구성한다.
// 인증 불필요 (공개 API).

import { NextRequest } from 'next/server'
import { makeApiAcceptNo } from '@/lib/cert-download'

const BASE_URL = 'https://k-tools.ktl.re.kr'

export async function GET(request: NextRequest) {
  const acptNo = request.nextUrl.searchParams.get('acptNo')
  if (!acptNo) {
    return Response.json({ error: 'acptNo 필요' }, { status: 400 })
  }

  const apiNo = makeApiAcceptNo(acptNo)

  try {
    const res = await fetch(
      `${BASE_URL}/spm/module/popContents/spm1105_spmMyReceiptCertificateCertPop.do?acpt_no=${apiNo}`,
      { next: { revalidate: 0 } },
    )
    if (!res.ok) {
      return Response.json({ error: `k-tools 응답 ${res.status}` }, { status: 502 })
    }

    const html = await res.text()

    const edmsId = html.match(/var\s+temp3\s*=\s*'(\d+)'/)?.[1]
    const edmsNm = html.match(/var\s+temp4\s*=\s*'([^']+)'/)?.[1]
    const edmsSize = html.match(/var\s+temp5\s*=\s*'(\d+)'/)?.[1]

    if (!edmsId) {
      return Response.json({ error: '성적서 EDMS 정보 없음' }, { status: 404 })
    }

    // acptNo → INCS_RCPN_SRNO + RCPN_ARTC_SRNO 분리
    const lastDash = apiNo.lastIndexOf('-')
    const incsRcpnSrno = apiNo.slice(0, lastDash)
    const rcpnArtcSrno = apiNo.slice(lastDash + 1)

    const url = `https://customer.ktl.re.kr/ktl/markany_new/jsp/MaMdmServerMain.jsp?GBN=N`
      + `&INCS_RCPN_SRNO=${incsRcpnSrno}`
      + `&RCPN_ARTC_SRNO=${rcpnArtcSrno}`
      + `&EDMS_ID=${edmsId}`
      + `&EDMS_SIZE=${edmsSize ?? ''}`
      + `&EDMS_NM=${encodeURIComponent(edmsNm ?? '')}`
      + `&USER_ID=&NEW_YN=Y&prt=1&save=1&nowm=0&reprt=0`
      + `&wonbon_incsRcpnSrno=${incsRcpnSrno}`
      + `&wonbon_rcpnArtcSrno=${rcpnArtcSrno}`

    return Response.json({ url, edmsId, edmsNm, edmsSize })
  } catch (e) {
    return Response.json({ error: `EDMS 조회 실패: ${e instanceof Error ? e.message : e}` }, { status: 500 })
  }
}
