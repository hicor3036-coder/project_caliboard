// 아토믹 엔드포인트: 장비 건강 분석 LLM 추론
// ─ 도메인 규칙: LLM 워커 풀(llm-worker-pool)만 호출 — 다른 도메인 결합 없음
// ─ 입력: HealthReasoningInput (equipment-health.ts의 buildHealthReasoningInput 결과)
// ─ 출력: { reasoning: string, prescriptions: Array<{priority, category, title, description}> }
//
// POST /api/ai/health-reasoning
//   body: HealthReasoningInput
//   응답: { reasoning, prescriptions }

import { NextRequest, NextResponse } from 'next/server'
import { llmPool, parseLlmJson } from '@/lib/llm-worker-pool'

interface HealthReasoningInputPayload {
  currentCycle: number
  recommended: number | null
  direction: 'shorten' | 'extend' | 'maintain' | 'insufficient'
  totalPoints: number
  details: Array<{
    label: string
    slope: number
    pValue: number
    significant: boolean
    usageRatio: number | null
    yearsToLimit: number | null
    latestGuardBand: string | null
    latestUtRatio: number | null
  }>
  currentRatio: number | null
  ratioSlope: number | null
  certCount: number
  healthGrade: string
  healthTotal: number
  components: Record<string, unknown>
  guardBandSummary: {
    conformant: number
    conditionalPass: number
    conditionalFail: number
    nonConformant: number
  }
}

interface LlmReasoningResult {
  reasoning: string
  prescriptions: Array<{
    priority: 'high' | 'medium' | 'low'
    category: 'cycle' | 'replacement' | 'focus' | 'data' | 'general'
    title: string
    description: string
  }>
}

const SYSTEM_PROMPT = `당신은 측정장비 교정 데이터를 분석해 한국어로 진단을 작성하는 전문가입니다.

입력: 장비 건강도 분석 결과 (JSON)
출력: 다음 형식의 JSON 객체만 반환 — 다른 설명/마크다운 금지

{
  "reasoning": "건강도 점수(healthGrade/healthTotal), 측정 추세(direction, details의 slope/significant), Guard Band 분포, 사용률(usageRatio), 한계 도달 예상(yearsToLimit)을 종합한 2~4문장의 한국어 진단",
  "prescriptions": [
    {
      "priority": "high" | "medium" | "low",
      "category": "cycle" | "replacement" | "focus" | "data" | "general",
      "title": "조치 제목 (10자 이내)",
      "description": "구체 조치 설명 (1~2문장)"
    }
  ]
}

규칙:
- reasoning: 숫자를 직접 인용하되 추측하지 말 것. 모르면 일반 표현 사용
- prescriptions: 1~5개. 우선순위 순서 (high 먼저)
- category 의미:
  - cycle: 교정주기 조정 권고
  - replacement: 장비 교체/폐기 권고
  - focus: 특정 측정점 집중 관리
  - data: 데이터 추가 수집 권고
  - general: 일반 관리 권고
- direction이 'insufficient'면 prescriptions는 data 카테고리 1개만
- direction이 'shorten'이고 healthGrade가 D 이하면 high 우선순위 항목 필수
- 의학/법적 단언 표현 금지 ("반드시 ~해야 한다" 류 회피)
- ISO 10012 조항 직접 인용 금지 (원문 미확인 시)`

export async function POST(request: NextRequest) {
  let input: HealthReasoningInputPayload
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 })
  }

  if (input.direction === 'insufficient') {
    // 데이터 부족 시 LLM 호출 없이 즉시 응답
    return NextResponse.json({
      reasoning: '데이터가 부족하여 추세 분석이 어렵습니다. 측정점을 추가로 수집한 후 재분석을 권장합니다.',
      prescriptions: [{
        priority: 'medium',
        category: 'data',
        title: '데이터 추가 수집',
        description: '최소 3회 이상의 측정 이력 확보 후 건강도 재평가를 수행하세요.',
      }],
    } satisfies LlmReasoningResult)
  }

  const userPrompt = `다음 장비 건강 분석 결과를 진단하세요:\n\n${JSON.stringify(input, null, 2)}`

  try {
    const { content, model, elapsed } = await llmPool.submit(userPrompt, SYSTEM_PROMPT, 1500)
    console.log(`[ai/health-reasoning] ${model} ${(elapsed / 1000).toFixed(1)}s`)
    const parsed = parseLlmJson<LlmReasoningResult>(content)

    if (typeof parsed.reasoning !== 'string' || !Array.isArray(parsed.prescriptions)) {
      return NextResponse.json({ error: 'LLM 응답 형식 불일치' }, { status: 502 })
    }
    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[ai/health-reasoning] LLM 호출 실패:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'LLM 호출 실패' },
      { status: 502 },
    )
  }
}
