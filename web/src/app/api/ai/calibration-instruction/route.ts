// AI 교정 지시서 API
// 포인트별 교정 전략 + 재점검 스케줄 + 환경 주의사항 생성
// Groq(3모델) → Mistral fallback, JSON 응답

import { NextRequest, NextResponse } from 'next/server'

// ─── LLM 설정 (health-reasoning 패턴 동일) ───

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
  maxTokens = 1600,
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

const SYSTEM_PROMPT = `당신은 교정 현장 20년 경력의 기술자이며, 후배 엔지니어에게 교정 전 브리핑을 해주는 역할입니다.
교정 이력 통계 분석 결과를 받아, **현장 엔지니어가 바로 행동할 수 있는** 교정 지시서를 작성합니다.

## 핵심 원칙
- 추상적 표현("주의 필요", "모니터링 권장") 대신 **구체적 수치와 행동**을 지시
- 마치 현장에서 직접 설명해주듯 **자연스러운 구어체**로 작성
- 숫자를 인용할 때는 반드시 입력 데이터의 실제 값 사용 (절대 변경 금지)

## 입력 데이터 해석
- **usageRatio**: 허용오차 대비 현재 오차 비율(%). **사용자에게는 "오차 여유도"(= 100 - usageRatio)로** 뒤집어 표현. 예: usageRatio=8 → "오차 여유도 92%". "사용률"이라는 표현 사용 금지!
- **significant**: true면 오차에 통계적 추세 있음 (p < 0.05)
- **slope**: 오차의 연간 변화율. 양수=악화, 음수=개선
- **pValue**: t-검정 p-value
- **yearsToLimit**: 현 추세로 허용한계 도달까지 남은 연수. null이면 한계 도달 불가
- **recentErrors**: 최근 교정 시 실측 오차 값들
- **currentCycle**: 현재 교정주기(개월)

## 출력 형식 (JSON만, 다른 텍스트 금지)
{
  "points": [
    {
      "label": "포인트명 (입력 그대로 복사)",
      "level": "precision | standard | observation",
      "levelLabel": "정밀교정 | 표준교정 | 관찰",
      "priority": "high | medium | low",
      "reason": "2~3문장. 왜 이런 판단인지 데이터 근거를 자연스럽게 설명",
      "action": "1~2문장. 구체적으로 무엇을 해야 하는지"
    }
  ],
  "schedule": [
    { "label": "포인트명", "timing": "시점", "reason": "판단 기준 포함" }
  ],
  "environmentNotes": ["장비 종류에 맞는 구체적 주의사항 0~2개, 해당 없으면 빈 배열"]
}

## 분류 기준
- **정밀교정(precision, high)**: significant=true + (usageRatio>70[여유도<30%] 또는 yearsToLimit<3)
- **표준교정(standard, medium)**: significant=true이나 여유 있음, 또는 usageRatio>50[여유도<50%]
- **관찰(observation, low)**: significant=false + usageRatio≤50[여유도≥50%]. 안정적

## 작성 예시 (이 톤과 구체성을 따라할 것!)

### 정밀교정 (precision, high)
reason: "최근 4년간 오차가 꾸준히 올라가고 있습니다(연 +0.47%, p=0.02). 지금 속도면 다음 교정 때 오차 여유도가 7%까지 떨어집니다."
action: "이 구간을 세분화해서 200/250/300/350 4포인트로 나눠서 어디서 틀어지는지 확인하세요. 3회 반복, 상승·하강 양방향 측정 필요합니다."

### 표준교정 (standard, medium)
reason: "오차 변화 추세가 있긴 하지만(연 +0.12%, p=0.04), 오차 여유도가 아직 62%로 당장 문제는 아닙니다."
action: "표준 절차대로 교정하되, 결과가 이전보다 나빠졌는지 꼭 비교해보세요."

### 관찰 (observation, low)
reason: "4년간 편차 변동이 ±0.5% 이내로 안정적입니다. 오차 여유도 92%로 여유 충분합니다."
action: "기본 절차대로 교정하시면 됩니다."

### schedule (중간점검 필요 시)
label: "300 N·m", timing: "6개월 후", reason: "현재 추세가 꺾이지 않으면 정기교정 전에 오차 여유도가 10% 이하로 떨어질 수 있습니다. 점검 시 오차 여유도 20% 이상 유지되면 괜찮고, 아니면 조정이 필요합니다."

### environmentNotes (해당될 때만)
- "이 장비는 워밍업을 꼭 지켜주세요. 고토크 영역에서 편차가 올라가는 원인 중 하나가 워밍업 미실시입니다."
- "교정 시 실내온도 20±2℃ 유지하세요. 온도 변화에 민감한 장비입니다."

## 중요 규칙
- reason은 **2~3문장**으로 쓰되, 첫 문장에 핵심 판단, 나머지에 수치 근거
- action은 **구체적 행동** 포함 (측정 포인트 수, 반복 횟수, 비교 대상 등)
- "사용률", "모니터링", "주시" 같은 추상적 표현 대신 구체적으로 무엇을 확인하라고 지시
- schedule은 yearsToLimit < currentCycle×2인 포인트만 포함
- observation(low) 포인트는 간결하게 — reason 1~2문장, action 1문장으로 충분`

// ─── POST 핸들러 ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.details || !Array.isArray(body.details)) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 })
    }

    // 디버그: 입력 데이터 요약
    const detailLabels = (body.details ?? []).map((d: { label: string; usageRatio: number | null; significant: boolean }) =>
      `${d.label}(여유도${d.usageRatio != null ? 100 - d.usageRatio : '?'}%${d.significant ? ',추세有' : ''})`
    ).join(', ')
    console.log(`[cal-instruction] 입력: ${body.equipmentName ?? '?'} | 포인트=${body.details.length}개 | ${detailLabels}`)

    const userPrompt = `아래는 교정장비의 통계 분석 결과입니다. 포인트별 교정 지시서를 작성해주세요.\n\n${JSON.stringify(body)}`
    const startTime = Date.now()

    // LLM fallback 호출
    for (const provider of getLlmProviders()) {
      const providerStart = Date.now()
      try {
        const content = await callLlm(provider, userPrompt, SYSTEM_PROMPT)

        // JSON 파싱
        let parsed: { points?: unknown[]; schedule?: unknown[]; environmentNotes?: unknown[] }
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

        if (!Array.isArray(parsed.points)) {
          throw new Error('응답 형식 불일치: points 배열 없음')
        }

        // points 정규화
        const validLevels = new Set(['precision', 'standard', 'observation'])
        const validPriorities = new Set(['high', 'medium', 'low'])
        const levelLabels: Record<string, string> = { precision: '정밀교정', standard: '표준교정', observation: '관찰' }

        const points = parsed.points
          .filter((p: unknown): p is Record<string, unknown> =>
            typeof p === 'object' && p !== null && 'label' in p
          )
          .map(p => {
            const level = validLevels.has(p.level as string) ? p.level as string : 'standard'
            return {
              label: String(p.label),
              level,
              levelLabel: levelLabels[level] || '표준교정',
              priority: validPriorities.has(p.priority as string) ? p.priority as string : 'medium',
              reason: String(p.reason || ''),
              action: String(p.action || ''),
            }
          })

        const schedule = Array.isArray(parsed.schedule)
          ? parsed.schedule
              .filter((s: unknown): s is Record<string, unknown> =>
                typeof s === 'object' && s !== null && 'label' in s
              )
              .map(s => ({
                label: String(s.label),
                timing: String(s.timing || ''),
                reason: String(s.reason || ''),
              }))
          : []

        const environmentNotes = Array.isArray(parsed.environmentNotes)
          ? parsed.environmentNotes.map(String)
          : []

        const elapsed = ((Date.now() - providerStart) / 1000).toFixed(1)
        const summary = points.map((p: { label: string; priority: string; level: string }) => `${p.label}(${p.priority}/${p.level})`).join(', ')
        console.log(`[cal-instruction] ${provider.name} 성공 (${elapsed}s) | ${summary}`)

        return NextResponse.json({
          points,
          schedule,
          environmentNotes,
          provider: provider.name,
        })
      } catch (e) {
        const elapsed = ((Date.now() - providerStart) / 1000).toFixed(1)
        console.log(`[cal-instruction] ${provider.name} 실패 (${elapsed}s): ${e instanceof Error ? e.message : e}`)
        continue
      }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[cal-instruction] 모든 provider 실패 (총 ${totalElapsed}s)`)
    return NextResponse.json({ error: 'LLM 서비스 일시 불가' }, { status: 503 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    )
  }
}
