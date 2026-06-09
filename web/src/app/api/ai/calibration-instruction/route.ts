// 아토믹 엔드포인트: 장비별 교정 지시서 LLM 생성
// ─ 도메인 규칙: LLM 워커 풀(llm-worker-pool)만 호출 — 다른 도메인 결합 없음
// ─ 입력: CalibrationInstructionInput (equipment-health.ts의 buildCalibrationInstructionInput 결과)
// ─ 출력: { points: PointInstruction[], schedule: [...], environmentNotes: string[] }
//
// POST /api/ai/calibration-instruction
//   body: CalibrationInstructionInput
//   응답: { points, schedule, environmentNotes }

import { NextRequest, NextResponse } from 'next/server'
import { llmPool, parseLlmJson } from '@/lib/llm-worker-pool'

interface CalibrationInstructionInputPayload {
  equipmentName: string
  manufacturer: string
  model: string
  currentCycleMonths: number
  direction: 'shorten' | 'extend' | 'maintain' | 'insufficient'
  healthGrade: string
  healthTotal: number
  quantityLabel?: string
  details: Array<{
    label: string
    recentYears: string[]
    recentErrors: number[]
    slope: number
    pValue: number
    significant: boolean
    usageRatio: number | null
    yearsToLimit: number | null
    latestGuardBand: string | null
    latestUtRatio: number | null
  }>
}

interface PointInstruction {
  label: string
  level: 'precision' | 'standard' | 'observation'
  levelLabel: string
  priority: 'high' | 'medium' | 'low'
  instruction: string
  evidence: string[]
}

interface LlmInstructionResult {
  points: PointInstruction[]
  schedule: Array<{ label: string; timing: string; reason: string }>
  environmentNotes: string[]
}

const SYSTEM_PROMPT = `당신은 측정장비 교정 작업을 지시하는 한국어 기술문서 작성자입니다.

입력: 특정 장비의 측정점(details)별 추세/사용률/Guard Band 데이터
출력: 다음 형식의 JSON 객체만 반환 — 다른 설명/마크다운 금지

{
  "points": [
    {
      "label": "측정점 라벨 (입력 details[].label 그대로)",
      "level": "precision" | "standard" | "observation",
      "levelLabel": "정밀교정" | "표준교정" | "관찰",
      "priority": "high" | "medium" | "low",
      "instruction": "이 측정점에서 수행할 구체 교정 작업 (1~2문장, 한국어)",
      "evidence": ["판단 근거 1", "판단 근거 2", ...]
    }
  ],
  "schedule": [
    { "label": "측정점", "timing": "재점검 시점", "reason": "이유" }
  ],
  "environmentNotes": ["환경 주의사항 1", ...]
}

level 분류 규칙:
- precision (정밀교정): significant=true AND (usageRatio>70 OR yearsToLimit<3), 또는 latestGuardBand='conditional-fail'/'non-conformant'
- standard (표준교정): significant=true OR usageRatio>50, 또는 latestGuardBand='conditional-pass'
- observation (관찰): 그 외

priority 매핑: precision→high, standard→medium, observation→low

evidence는 details 입력의 숫자값을 직접 인용 — 예: "기울기 +0.025/년 (p=0.012)", "허용오차 대비 78% 사용", "U/T 비율 12%"

schedule:
- yearsToLimit < (currentCycleMonths/12 * 2)인 측정점만 포함
- timing 예시: "${'${개월수}'}개월 후 중간점검" (currentCycleMonths의 절반)

environmentNotes:
- healthTotal < 55: "교정 환경(온도/습도) 재확인 필요" 포함
- usageRatio > 90인 측정점 존재: "측정 불확도 재검증 권장" 포함
- 그 외 입력이 시사하는 환경 이슈가 있으면 추가

규칙:
- points는 입력 details 순서대로 — 임의로 정렬하거나 누락 금지
- 의학/법적 단언 표현 금지
- ISO 10012 조항 직접 인용 금지 (원문 미확인 시)
- quantityLabel이 있으면 해당 물리량 맥락(예: 토크/길이/온도)을 반영한 표현 사용`

export async function POST(request: NextRequest) {
  let input: CalibrationInstructionInputPayload
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 })
  }

  if (input.direction === 'insufficient' || input.details.length === 0) {
    return NextResponse.json({
      points: [],
      schedule: [],
      environmentNotes: ['측정 이력이 부족하여 정밀한 지시 생성이 어렵습니다. 데이터를 추가로 수집한 후 재시도하세요.'],
    } satisfies LlmInstructionResult)
  }

  const userPrompt = `장비: ${input.equipmentName} (${input.manufacturer} ${input.model})\n` +
    `현재 교정주기: ${input.currentCycleMonths}개월, 권고 방향: ${input.direction}\n` +
    `건강도: ${input.healthGrade} (${input.healthTotal}/100)\n` +
    (input.quantityLabel ? `물리량: ${input.quantityLabel}\n` : '') +
    `\n측정점 데이터:\n${JSON.stringify(input.details, null, 2)}\n\n` +
    `위 데이터를 바탕으로 교정 지시서 JSON을 생성하세요.`

  try {
    const { content, model, elapsed } = await llmPool.submit(userPrompt, SYSTEM_PROMPT, 3000)
    console.log(`[ai/calibration-instruction] ${model} ${(elapsed / 1000).toFixed(1)}s`)
    const parsed = parseLlmJson<LlmInstructionResult>(content)

    if (!Array.isArray(parsed.points)) {
      return NextResponse.json({ error: 'LLM 응답 형식 불일치 (points 배열 누락)' }, { status: 502 })
    }
    // schedule / environmentNotes 기본값 보정
    parsed.schedule = Array.isArray(parsed.schedule) ? parsed.schedule : []
    parsed.environmentNotes = Array.isArray(parsed.environmentNotes) ? parsed.environmentNotes : []

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[ai/calibration-instruction] LLM 호출 실패:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'LLM 호출 실패' },
      { status: 502 },
    )
  }
}
