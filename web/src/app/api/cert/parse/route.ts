// 아토믹 엔드포인트: 교정성적서 Excel 파싱 (cert 도메인)
// ─ 도메인 규칙: k-tools 호출 없음. Excel buffer만 받아서 파싱 → CertResult
// ─ 의존 라이브러리: lib/cert-parser.ts (규칙기반), lib/cert-download.ts (LLM 보강)
//
// POST /api/cert/parse
//   ─ Content-Type: application/octet-stream
//     body: Excel binary
//     query: ?acptNo=Y (로깅용, optional)
//   ─ Content-Type: application/json
//     body: { base64: "...", acptNo?: "Y" }
//   ─ 응답: CertResult (JSON)
//   ─ 동작:
//     1. Excel buffer 추출
//     2. parseCertExcel() — 규칙기반 파싱 (시트 구조 인식)
//     3. llmEnhanceCert() — LLM 워커풀로 적합성검토서/을지 구조화
//
// 일괄 처리는 task (cert-batch) — k-tools 호출 + 이 atom을 N번 결합

import { NextRequest, NextResponse } from 'next/server'
import { parseCertExcel } from '@/lib/cert-parser'
import { llmEnhanceCert } from '@/lib/cert-download'

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('Content-Type') ?? ''
  let buffer: Buffer
  let acptNo: string | undefined

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json() as { base64?: string; acptNo?: string }
      if (!body.base64) {
        return NextResponse.json({ error: 'JSON body에 base64 필드가 필요합니다' }, { status: 400 })
      }
      buffer = Buffer.from(body.base64, 'base64')
      acptNo = body.acptNo
    } else {
      // 기본: binary stream
      const ab = await request.arrayBuffer()
      if (ab.byteLength === 0) {
        return NextResponse.json({ error: 'request body가 비어있습니다' }, { status: 400 })
      }
      buffer = Buffer.from(ab)
      acptNo = request.nextUrl.searchParams.get('acptNo') ?? undefined
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '본문 파싱 실패'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  try {
    // 1) 규칙기반 파싱
    const ruleResult = await parseCertExcel(buffer)

    // 2) LLM 보강 (적합성검토서/을지 구조화)
    const result = await llmEnhanceCert({ result: ruleResult, buffer }, acptNo)

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '파싱 실패'
    console.error(`[cert/parse] ${acptNo ?? ''} 실패:`, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
