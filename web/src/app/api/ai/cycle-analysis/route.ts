// 아토믹 엔드포인트: 교정주기 5단계 분석에 대한 LLM 종합 평가
// ─ 도메인 규칙: LLM 워커 풀(llm-worker-pool)만 호출 — 다른 도메인 결합 없음
// ─ 입력: cycle-analysis lib의 step1~3 + step5 결과 (요약 형태)
// ─ 출력: 자연어 종합 평가 + 우려 사항 + 추가 권고 + 규칙 동의 여부
//
// POST /api/ai/cycle-analysis
//   body: CycleAnalysisLlmInput
//   응답: CycleAnalysisLlmResult

import { NextRequest, NextResponse } from 'next/server'
import { llmPool, parseLlmJson } from '@/lib/llm-worker-pool'

interface CycleAnalysisLlmInput {
  equipment: {
    name: string
    manufacturer: string
    model: string
  }
  step1: {
    baseMonths: number
    source: string            // sourceLabel (예: "제조사 권장 주기")
    profileCategory: string | null
    profileStandards: string[]
  }
  step2: {
    adjustment: number
    confidence: 'high' | 'medium' | 'low'
    urgentPointCount: number
    watchPointCount: number
    safePointCount: number
    acceleratingCount: number
    maxLatestRatio: number | null
    dangerPoints: Array<{
      label: string
      latestRatio: number | null
      nearLimitCount: number
      totalCount: number
      accelerating: boolean
      accelerationRatio: number | null
      trend: 'rising' | 'falling' | 'stable' | 'volatile'
    }>
  }
  step3: {
    adjustment: number
    confidence: 'high' | 'medium' | 'low'
    pointsWithRecentDanger: number
    pointsWithHighUtRatio: number
    maxUtRatioOverall: number | null
    conditionalPassRatio: number
    hasGuardBandData: boolean
    overallDistribution: {
      conformant: number
      conditionalPass: number
      conditionalFail: number
      nonConformant: number
      unknown: number
      total: number
    }
  }
  step5: {
    finalMonths: number
    direction: 'shorten' | 'maintain' | 'extend'
    confidence: 'high' | 'medium' | 'low'
    breakdown: { base: number; trendAdj: number; riskAdj: number; sum: number }
    clamped: boolean
  }
}

interface CycleAnalysisLlmResult {
  verdict: string                        // 한 줄 종합 평가 (1~2문장 한국어)
  concerns: string[]                     // 우려 사항 (각 1줄, 최대 4개)
  recommendations: string[]              // 추가 권고 (각 1줄, 최대 4개)
  agreesWithRule: boolean                // 규칙 결정과 AI 동의 여부
  contraryReason: string | null          // 동의 안 하면 이유 (1문장)
}

const SYSTEM_PROMPT = `당신은 측정장비 교정주기 분석 결과를 검토하고 자연어로 종합 평가하는 한국어 전문가입니다.

입력: 5단계 규칙 기반 분석 결과 (JSON)
출력: 다음 형식의 JSON 객체만 반환 — 다른 설명/마크다운 금지

{
  "verdict": "전체 상황을 1~2문장 한국어로 요약 (기준 주기, 측정 추세, 불확도 위험, 최종 권고가 어떻게 연결되는지)",
  "concerns": ["우려 사항 1줄", "..."],
  "recommendations": ["추가 권고 1줄", "..."],
  "agreesWithRule": true | false,
  "contraryReason": "agreesWithRule=false면 1문장 이유, 아니면 null"
}

규칙:
- verdict는 사용자가 "왜 이 주기인지" 즉시 이해하는 데 집중. 숫자 인용 가능
- concerns는 0~4개. 데이터에 명시된 위험 신호만 인용 (추측 금지)
- recommendations는 0~4개. 측정 관행 / 환경 점검 / 다음 교정 시 확인 등 실무적 조치
- 의학적·법적 단언 표현 금지 ("반드시 ~해야 한다" 류 회피)
- ISO 10012 / KOLAS / ILAC 조항 번호 직접 인용 금지 (원문 미확인이라 추측 위험)
- agreesWithRule: 데이터에 비춰볼 때 규칙의 finalMonths 결정이 합리적이면 true
  - 예: 모든 신호가 안정인데 규칙이 단축 결정 → false + contraryReason
  - 예: 모든 신호가 위험인데 규칙이 유지 결정 → false + contraryReason
- 데이터 부족(step2/3 confidence='low')일 때는 verdict에 "데이터 부족" 언급, recommendations에 "추가 이력 수집" 포함
- 한국어, 친절한 어조, 1~2문장 단위`

export async function POST(request: NextRequest) {
  let input: CycleAnalysisLlmInput
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 })
  }

  const userPrompt = `장비: ${input.equipment.name} (${input.equipment.manufacturer} ${input.equipment.model})\n\n` +
    `5단계 분석 결과:\n${JSON.stringify(input, null, 2)}\n\n` +
    `위 결과를 종합 평가하고, 규칙 결정의 합리성을 판단하세요.`

  try {
    const { content, model, elapsed } = await llmPool.submit(userPrompt, SYSTEM_PROMPT, 1500)
    console.log(`[ai/cycle-analysis] ${model} ${(elapsed / 1000).toFixed(1)}s`)
    const parsed = parseLlmJson<CycleAnalysisLlmResult>(content)

    // 응답 형식 검증
    if (typeof parsed.verdict !== 'string') {
      return NextResponse.json({ error: 'LLM 응답 형식 불일치 (verdict 누락)' }, { status: 502 })
    }
    // 배열 기본값 보정
    parsed.concerns = Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 4) : []
    parsed.recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 4) : []
    if (typeof parsed.agreesWithRule !== 'boolean') parsed.agreesWithRule = true
    if (typeof parsed.contraryReason !== 'string') parsed.contraryReason = null

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[ai/cycle-analysis] LLM 호출 실패:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'LLM 호출 실패' },
      { status: 502 },
    )
  }
}
