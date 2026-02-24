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
  maxTokens = 2400,
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
- **결론 먼저**: headline 한 줄만 읽어도 뭘 해야 하는지 알 수 있게
- 추상적 표현("주의 필요", "모니터링 권장") 대신 **구체적 수치와 행동**을 지시
- 마치 현장에서 직접 설명해주듯 **자연스러운 구어체**로 작성
- 숫자를 인용할 때는 반드시 입력 데이터의 실제 값 사용 (절대 변경 금지)
- **시급도순 정렬**: points 배열을 시급한 순서(yearsToLimit 작은 순)로 정렬할 것

## 입력 데이터 해석
- **usageRatio**: 허용오차 대비 현재 오차 비율(%). **사용자에게는 "여유"(= 100 - usageRatio)%로** 뒤집어 표현. 예: usageRatio=74 → "여유 26%". "사용률"이라는 표현 사용 금지!
- **significant**: true면 오차에 통계적 추세 있음 (p < 0.05)
- **slope**: 오차의 연간 변화율. 양수=악화, 음수=개선
- **pValue**: 통계적 신뢰도. 직접 p값을 쓰지 말고 아래처럼 자연어로 번역할 것:
  - p < 0.01 → "확실한 추세"
  - p < 0.05 → "추세가 보임"
  - p < 0.1  → "추세 가능성 있음"
  - p ≥ 0.1  → "뚜렷한 추세 아님"
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
      "headline": "핵심 결론 1줄. 10~25자. 가장 중요한 판단을 짧게",
      "reason": "수치 근거 1~2문장. headline의 배경 설명",
      "action": "구체적으로 무엇을 해야 하는지. 1~2문장"
    }
  ],
  "schedule": [
    { "label": "포인트명", "timing": "시점", "reason": "판단 기준 포함" }
  ],
  "environmentNotes": ["장비 종류에 맞는 구체적 주의사항 0~2개, 해당 없으면 빈 배열"]
}

## 분류 기준
- **정밀교정(precision, high)**: significant=true + (usageRatio>70[여유<30%] 또는 yearsToLimit<3)
- **표준교정(standard, medium)**: significant=true이나 여유 있음, 또는 usageRatio>50[여유<50%]
- **관찰(observation, low)**: significant=false + usageRatio≤50[여유≥50%]. 안정적

## 작성 예시 (이 톤과 구체성을 따라할 것!)

### 정밀교정 (precision, high)
headline: "1.3년 후 허용한계 초과 예상"
reason: "여유 26%, 매년 -0.184%p씩 커지는 확실한 추세. 최근 오차 0.37%로 변동 증가."
action: "0.05/0.1/0.15 N·m 3포인트 세분화 측정. 상승/하강 양방향, 반복 3회."

### 표준교정 (standard, medium)
headline: "추세는 있으나 여유 충분"
reason: "매년 +0.12%p 변화 중, 추세가 보임. 여유 62%로 당장 문제 없음."
action: "표준 절차 교정 후 이전 결과와 비교 확인."

### 관찰 (observation, low)
headline: "안정"
reason: "4년간 ±0.5% 이내, 여유 92%."
action: "기본 절차 수행."

### schedule (중간점검 필요 시)
label: "300 N·m", timing: "6개월 후", reason: "추세 지속 시 여유 10% 이하 가능. 점검 시 여유 20% 이상이면 OK."

### environmentNotes (해당될 때만)
- "워밍업 필수. 고토크 편차 원인 중 하나."
- "실내 20±2℃ 유지. 온도 민감 장비."

## 중요 규칙
- **한글만 사용**: 한자(漢字) 절대 금지. "변화", "증가" 등 반드시 한글로 작성. 한자 섞인 응답은 불합격
- **headline이 가장 중요**: 엔지니어가 이것만 읽어도 시급도를 판단할 수 있어야 함
- reason은 headline의 수치 근거. 간결하게
- action은 **구체적 행동** 포함 (측정 포인트 수, 반복 횟수, 비교 대상 등)
- p값(0.005 등)을 직접 쓰지 말고 "확실한 추세" 등 자연어로 번역
- "사용률", "모니터링", "주시" 같은 추상적 표현 금지
- **정렬**: precision → standard → observation 순서, 같은 레벨 내에서는 yearsToLimit 작은(시급한) 순
- schedule은 yearsToLimit < currentCycle×2인 포인트만 포함
- observation(low) 포인트는 최대한 간결하게`

// ─── POST 핸들러 ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.details || !Array.isArray(body.details)) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 })
    }

    // 디버그: 입력 데이터 요약
    const qLabel = body.quantityLabel ? ` [${body.quantityLabel}]` : ''
    const detailLabels = (body.details ?? []).map((d: { label: string; usageRatio: number | null; significant: boolean }) =>
      `${d.label}(여유도${d.usageRatio != null ? 100 - d.usageRatio : '?'}%${d.significant ? ',추세有' : ''})`
    ).join(', ')
    console.log(`[cal-instruction] 입력: ${body.equipmentName ?? '?'}${qLabel} | 포인트=${body.details.length}개 | ${detailLabels}`)

    const quantityContext = body.quantityLabel ? `\n측정 물리량: ${body.quantityLabel}\n` : ''
    const userPrompt = `아래는 교정장비의 통계 분석 결과입니다. 포인트별 교정 지시서를 작성해주세요.${quantityContext}\n${JSON.stringify(body)}`
    const startTime = Date.now()

    // LLM fallback 호출
    for (const provider of getLlmProviders()) {
      const providerStart = Date.now()
      try {
        const content = await callLlm(provider, userPrompt, SYSTEM_PROMPT)

        // JSON 파싱 (토큰 초과로 잘린 JSON 복구 포함)
        let parsed: { points?: unknown[]; schedule?: unknown[]; environmentNotes?: unknown[] }
        try {
          parsed = JSON.parse(content)
        } catch {
          const firstBrace = content.indexOf('{')
          if (firstBrace < 0) throw new Error('JSON 파싱 실패')
          let json = content.slice(firstBrace)

          // 방법 1: 마지막 완전한 }까지만 잘라서 brackets 닫기 시도
          const lastBrace = json.lastIndexOf('}')
          if (lastBrace > 0) {
            const trimmed = json.slice(0, lastBrace + 1)
            // 닫히지 않은 [ ] 보완
            let openBrackets = 0
            for (const ch of trimmed) {
              if (ch === '[') openBrackets++
              else if (ch === ']') openBrackets--
            }
            const repaired = trimmed + ']'.repeat(Math.max(0, openBrackets))
            try {
              parsed = JSON.parse(repaired)
            } catch {
              // 방법 2: 불완전한 마지막 항목 제거 후 재시도
              const lastComma = json.lastIndexOf('},')
              if (lastComma > 0) {
                const cutJson = json.slice(0, lastComma + 1) + ']}'.repeat(3)
                try { parsed = JSON.parse(cutJson) } catch { throw new Error('JSON 파싱 실패 (복구 불가)') }
              } else {
                throw new Error('JSON 파싱 실패')
              }
            }
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
              headline: String(p.headline || ''),
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
