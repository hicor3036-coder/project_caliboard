// AI 건강검진 reasoning + 처방 생성 API
// 규칙 기반 통계 분석 결과를 받아 LLM으로 자연어 진단 소견 생성
// Groq(3모델) → Mistral fallback, JSON 응답

import { NextRequest, NextResponse } from 'next/server'

// ─── LLM 설정 (cert-download.ts 패턴 동일) ───

interface LlmProvider {
  name: string
  url: string
  key: string
  model: string
  retries: number
}

// Groq-Mistral 교차 배치: 한쪽 호스팅이 전체 rate limit 걸려도 빠르게 다른 쪽으로 전환
function getLlmProviders(): LlmProvider[] {
  return [
    {
      name: 'Groq-llama3.3-70b',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'llama-3.3-70b-versatile',
      retries: 0,
    },
    {
      name: 'Mistral',
      url: 'https://api.mistral.ai/v1/chat/completions',
      key: process.env.MISTRAL_API_KEY ?? '',
      model: 'mistral-small-latest',
      retries: 0,
    },
    {
      name: 'Groq-maverick',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
      retries: 0,
    },
    {
      name: 'Groq-scout',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      retries: 0,
    },
  ]
}

async function callLlm(
  provider: LlmProvider,
  prompt: string,
  systemPrompt: string,
  maxTokens = 800,
): Promise<string> {
  if (!provider.key) throw new Error(`${provider.name} API 키 없음`)

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  for (let attempt = 0; attempt <= provider.retries; attempt++) {
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    })

    if (res.status === 429) {
      const wait = Math.pow(2, attempt) + 1
      await new Promise(r => setTimeout(r, wait * 1000))
      continue
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${provider.name} ${res.status}: ${text.slice(0, 200)}`)
    }

    const data = await res.json()
    return data.choices[0].message.content
  }

  throw new Error(`${provider.name} rate limit 초과`)
}

// ─── 시스템 프롬프트 ───

const SYSTEM_PROMPT = `당신은 산업용 계측장비 교정 분야 20년 경력의 전문 컨설턴트입니다.
장비의 교정 이력 통계 분석 결과를 받아, 전문적이면서도 비전문가가 즉시 납득할 수 있는 진단 소견과 조치 권고사항을 작성합니다.

## 톤 가이드 — direction 필드가 최우선 기준
- **direction이 "maintain" 또는 "extend"이면**: 절대 긴박한 톤을 사용하지 마세요. "즉각 조치", "긴급", "시급" 같은 표현은 금지입니다. 일부 포인트에서 변화가 감지되더라도 현행 교정주기를 유지/연장해도 안전하다고 판단된 것이므로, 안심을 주면서 주의할 점을 알려주는 톤이어야 합니다.
- **direction이 "shorten"이면**: 단축 권고는 했지만, 긴박함의 정도는 아래 "교정주기 대비 위험도" 기준으로 조절하세요.

### 교정주기 대비 위험도 판단 (매우 중요!)
yearsToLimit(한계 도달까지 남은 연수)은 반드시 currentCycle(현재 교정주기)과 비교하여 해석하세요:
- **남은 교정 횟수 = yearsToLimit ÷ (currentCycle / 12)**
- 남은 교정 횟수 ≥ 4회: 여유 충분. "현재 교정주기 내에서 충분히 관리 가능", "추이를 모니터링하면서 대응할 수 있습니다"
- 남은 교정 횟수 2~3회: 주의 필요. "향후 2~3회 교정 내에 한계에 근접할 수 있으므로 주시가 필요합니다"
- 남은 교정 횟수 ≤ 1회: 긴급. "다음 교정 시점 전에 한계를 초과할 우려가 있어 즉각적인 대응이 필요합니다"
- 예시: 교정주기 6개월, yearsToLimit 2.2년 → 남은 교정 약 4.4회 → 여유 충분 (긴급 아님!)

### 톤 세부 가이드
- **위험 상황** (D/F등급 + direction=shorten + 남은 교정 ≤ 1회): 긴박하고 단호하게.
- **안전 상황** (A등급, direction=maintain/extend): 확신과 안심. "매우 안정적인 상태입니다", "전 측정포인트에서 일관된 성능을 유지하고 있습니다" 등.
- **주의 상황** (B/C등급, 일부 변화 있으나 여유 있음): 균형잡힌 관찰자. "전반적으로 양호하나 일부 포인트에서 변화 징후가 관찰됩니다", "현재는 허용 범위 내이나 추이를 주시할 필요가 있습니다" 등.
- **경미한 주의** (변화 감지되었으나 남은 교정 ≥ 4회): 안심 위주. "변화가 감지되었으나 현재 교정주기로 충분히 관리 가능한 수준입니다" 등.

## 입력 데이터 해석
- **currentCycle**: 현재 교정주기(개월). 위험도 판단의 기준축. yearsToLimit과 반드시 비교할 것!
- **direction**: shorten(단축 권고), maintain(현행 유지), extend(연장 가능), insufficient(데이터 부족). 규칙 기반 시스템이 이미 판단한 결론이므로 이를 존중하세요.
- **details[].slope**: 오차의 연간 변화율. 양수=오차 증가(악화), 음수=오차 감소
- **details[].pValue**: t-검정 p-value. 0.05 미만이면 통계적으로 유의미한 변화 (추세가 있다)
- **details[].significant**: p < 0.05 여부
- **details[].usageRatio**: 허용오차 대비 현재 오차 비율(%). 이 숫자는 내부 계산용이며, **사용자에게 설명할 때는 반드시 "오차 여유도"로 뒤집어서** 표현하세요. 변환: 오차 여유도 = 100 - usageRatio. 예: usageRatio=8 → "오차 여유도 92%" (허용범위의 92%가 남아있음). usageRatio=70 → "오차 여유도 30%" (여유 적음). "사용률"이라는 표현은 사용하지 마세요!
- **details[].yearsToLimit**: 현 기울기로 허용한계 도달까지 남은 연수. null이면 계산 불가. **반드시 currentCycle과 비교하여 남은 교정 횟수로 해석할 것**
- **currentRatio**: 전체 포인트 중 최대 usageRatio(%). 이것도 "오차 여유도"로 변환하여 표현. 예: currentRatio=8 → "전체 오차 여유도 92%"
- **components**: 세부 점수 — toleranceProximity(허용오차여유), longTermStability(장기안정도), shortTermStability(단기안정도), failHistory(적합이력), dataAvailability(데이터충분성)

## 출력 형식
반드시 아래 JSON으로만 응답하세요. 다른 텍스트를 추가하지 마세요.
{
  "reasoning": "줄바꿈(\\n)으로 구분된 3~5줄 진단 소견",
  "prescriptions": [
    {
      "priority": "high 또는 medium 또는 low",
      "category": "cycle 또는 replacement 또는 focus 또는 data 또는 general",
      "title": "10~30자 제목",
      "description": "구체적 행동 지침 포함 40~100자 설명"
    }
  ]
}

## reasoning 작성 규칙
**중요**: UI에 이미 "판단 근거"(유의미 추세 건수, 최단 한계도달 포인트, 위험 건수)와 "주기별 시뮬레이션 테이블"이 표시되어 있습니다. 이 수치를 반복하지 마세요. reasoning은 **해석과 결론**에 집중합니다.

1줄: 종합 등급과 핵심 진단 요약 (예: "건강등급 A(96점), 전반적으로 매우 안정적인 상태입니다.")
2줄: 가장 주목할 포인트와 그 이유 — 단순 수치 나열이 아니라 "왜 이 포인트가 문제인지" 맥락 설명. 이미 표시된 usageRatio, yearsToLimit 값을 그대로 반복하지 말 것.
3줄: 교정주기 결론 한 문장. "~하여 ~개월로 단축/유지/연장을 권고합니다." 형식.

GOOD 예시: "모든 포인트에서 오차 여유도 92% 이상으로 매우 안정적입니다."
GOOD 예시: "300 N·m 포인트에서 오차 여유도가 30%로 줄어들고 있어 주의가 필요합니다."
BAD 예시: "허용오차 사용률 8%" ← "사용률"이라는 표현은 이해하기 어려우므로 절대 사용 금지!

## prescriptions 작성 규칙
- 최소 2개, 최대 5개
- 반드시 교정주기 관련 항목 1개 포함 (category: "cycle")
- priority는 등급과 direction에 맞게: direction=maintain/extend이면 high 사용 금지(medium 이하만). F/D등급 + direction=shorten이면 high 필수. A등급은 low 위주
- description에 구체적 행동 포함 ("다음 교정 시 ○○ 포인트 중점 점검", "○○ 환경 조건 재확인" 등)
- category 설명: cycle(교정주기), replacement(장비 교체/수리), focus(특정 포인트 집중), data(데이터/이력 관리), general(종합 관리)`

// ─── POST 핸들러 ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // 최소 유효성 검증
    if (!body.direction || body.totalPoints == null) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 })
    }

    // 디버그: LLM에 전달되는 데이터 확인
    console.log(`[health-reasoning] input: currentRatio=${body.currentRatio}, details usageRatios=[${(body.details ?? []).map((d: { label: string; usageRatio: number | null }) => `${d.label}:${d.usageRatio}`).join(', ')}]`)

    const userPrompt = `아래는 교정장비의 건강검진 통계 분석 결과입니다. 진단 소견과 조치 권고사항을 작성해주세요.\n\n${JSON.stringify(body)}`

    // LLM fallback 호출
    for (const provider of getLlmProviders()) {
      try {
        const content = await callLlm(provider, userPrompt, SYSTEM_PROMPT)

        // JSON 파싱 (부분 추출 포함)
        let parsed: { reasoning?: string; prescriptions?: unknown[] }
        try {
          parsed = JSON.parse(content)
        } catch {
          const start = content.indexOf('{')
          const end = content.lastIndexOf('}') + 1
          if (start >= 0 && end > start) {
            parsed = JSON.parse(content.slice(start, end))
          } else {
            throw new Error('JSON 파싱 실패')
          }
        }

        // 응답 유효성 검증
        if (!parsed.reasoning || !Array.isArray(parsed.prescriptions)) {
          throw new Error('응답 형식 불일치')
        }

        // prescriptions 정규화
        const validPriorities = new Set(['high', 'medium', 'low'])
        const validCategories = new Set(['cycle', 'replacement', 'focus', 'data', 'general'])
        const prescriptions = parsed.prescriptions
          .filter((p: unknown): p is Record<string, unknown> =>
            typeof p === 'object' && p !== null && 'title' in p && 'description' in p
          )
          .map(p => ({
            priority: validPriorities.has(p.priority as string) ? p.priority as string : 'medium',
            category: validCategories.has(p.category as string) ? p.category as string : 'general',
            title: String(p.title),
            description: String(p.description),
          }))

        console.log(`[health-reasoning] ${provider.name} 응답: ${parsed.reasoning.slice(0, 200)}`)

        return NextResponse.json({
          reasoning: parsed.reasoning,
          prescriptions,
          provider: provider.name,
        })
      } catch (e) {
        console.log(`[health-reasoning] ${provider.name} 실패: ${e instanceof Error ? e.message : e}`)
        continue
      }
    }

    return NextResponse.json({ error: 'LLM 서비스 일시 불가' }, { status: 503 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    )
  }
}
