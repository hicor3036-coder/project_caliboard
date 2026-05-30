// AI Chat API: Text-to-SQL 기반 SSE 스트리밍
import { NextRequest } from 'next/server'
import { getCache } from '@/lib/cache'
import { getSqlSchema, COLUMN_LABELS } from '@/lib/ai-sql-schema'
import {
  executeSQL,
  generateErrorContext,
  filterColumns,
  formatResultForLLM,
} from '@/lib/ai-sql-executor'

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'
const MODEL = 'mistral-small-latest'

// SQL 집계 별칭 → 한글 라벨
const AGGREGATE_LABELS: Record<string, string> = {
  'count': '건수',
  'cnt': '건수',
  'total': '합계',
  'sum': '합계',
  'avg': '평균',
  'min': '최소',
  'max': '최대',
}

// 대화 히스토리 메시지 타입
interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// 요청 바디 타입
interface ChatRequest {
  message: string
  history?: Message[]
}

// Mistral SQL 생성 응답 타입
interface SqlGenerationResponse {
  sql: string
  needsResult: boolean
  reasoning: string
  columnsNeeded?: string[]
  localProcessing?: string
}

// 인증 확인
function getCredentials(request: NextRequest) {
  const auth = request.cookies.get('ktools_auth')?.value
  if (!auth) return null
  try {
    return JSON.parse(Buffer.from(auth, 'base64').toString())
  } catch {
    return null
  }
}

// Mistral API 호출 (SQL 생성)
async function generateSQL(
  userMessage: string,
  history: Message[] = [],
  apiKey: string,
  schema: string
): Promise<SqlGenerationResponse> {
  const messages: Message[] = [
    { role: 'system', content: schema },
    ...history.slice(-6), // 최근 6개 메시지만 유지
    { role: 'user', content: userMessage },
  ]

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3, // 정확한 SQL 생성을 위해 낮은 온도
      max_tokens: 1000,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mistral API 오류 (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('Mistral 응답이 비어있습니다')
  }

  // JSON 추출 (코드 블록 제거)
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`JSON 파싱 실패: ${content}`)
  }

  const jsonText = jsonMatch[1] || jsonMatch[0]
  return JSON.parse(jsonText)
}

// Mistral API 호출 (자연어 요약, SSE 스트리밍)
async function streamSummary(
  userMessage: string,
  sqlResult: string,
  history: Message[],
  apiKey: string,
  controller: ReadableStreamDefaultController
) {
  const encoder = new TextEncoder()

  // SSE 전송 헬퍼
  function send(token: string) {
    controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token })}\n\n`))
  }

  const messages: Message[] = [
    {
      role: 'system',
      content: `당신은 교정장비 관리 데이터 분석 도우미입니다. 주어진 SQL 실행 결과를 바탕으로 사용자 질문에 친절하고 정확하게 답변하세요. 한국어로 답변하고, 핵심을 먼저 말하세요.

답변 마지막에 반드시 아래 형식으로 연관 질문 2~3개를 추가하세요:
[추천] 미처리 건 몇 개야? | 안도영 담당 장비 보여줘 | Fluke 제조 장비 몇 개?

추천 질문 규칙:
- 반드시 데이터베이스에서 조회 가능한 질문만 (건수, 목록, 순위, 필터링 등)
- "왜", "어떻게 개선", "상관관계", "분석 방법" 같은 추상적 질문 금지
- "질문1", "질문2" 같은 번호 붙이지 말고 질문 내용만 작성
- 짧고 구체적으로 (예: "박수진 담당 미처리 건 보여줘", "이번 달 접수 건수")`
    },
    ...history.slice(-6),
    { role: 'user', content: userMessage },
    { role: 'assistant', content: `SQL 실행 결과:\n${sqlResult}` },
    { role: 'user', content: '위 결과를 자연어로 요약해주세요.' }
  ]

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 2000,
      stream: true, // SSE 스트리밍
    }),
  })

  if (!response.ok) {
    throw new Error(`Mistral API 오류 (${response.status})`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('스트림 읽기 실패')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const token = parsed.choices?.[0]?.delta?.content
          if (token) {
            send(token)
          }
        } catch {
          // JSON 파싱 실패 무시
        }
      }
    }
  }
}

// POST /api/ai/chat
export async function POST(request: NextRequest) {
  const creds = getCredentials(request)
  if (!creds) {
    return new Response('Unauthorized', { status: 401 })
  }

  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) {
    return new Response('MISTRAL_API_KEY not configured', { status: 500 })
  }

  // 캐시 확인 (데이터 필요)
  const cached = getCache()
  if (!cached) {
    return new Response('데이터를 먼저 수집해주세요', { status: 400 })
  }

  const { message, history = [] }: ChatRequest = await request.json()

  if (!message || !message.trim()) {
    return new Response('메시지가 비어있습니다', { status: 400 })
  }

  // SSE 스트림 생성
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      // SSE 전송 헬퍼
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      function sendToken(token: string) {
        controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token })}\n\n`))
      }

      try {
        // 스키마 1회 생성 (실제 데이터 메타데이터 포함)
        const schema = getSqlSchema(cached.items)

        // 1단계: SQL 생성
        send('status', { stage: 'generating_sql', message: 'SQL 생성 중...' })

        let sqlResponse: SqlGenerationResponse | undefined
        let retryCount = 0
        const MAX_RETRIES = 2

        while (retryCount <= MAX_RETRIES) {
          try {
            sqlResponse = await generateSQL(message, history, apiKey, schema)
            break
          } catch (error) {
            if (retryCount === MAX_RETRIES) throw error
            retryCount++
            send('status', { stage: 'retry_sql', message: `SQL 재생성 중 (${retryCount}/${MAX_RETRIES})...` })
          }
        }

        if (!sqlResponse) {
          throw new Error('SQL 생성 실패')
        }

        // 2단계: SQL 실행
        console.log('[AI Chat] User question:', message)
        console.log('[AI Chat] Generated SQL:', sqlResponse.sql)
        console.log('[AI Chat] Cache item count:', cached.items.length)
        send('status', { stage: 'executing_sql', message: 'SQL 실행 중...', sql: sqlResponse.sql })

        const sqlResult = await executeSQL(sqlResponse.sql, cached.items)
        console.log('[AI Chat] SQL result:', sqlResult.success ? `Success, ${sqlResult.rowCount} rows` : `Error: ${sqlResult.error}`)

        // SQL 실행 실패 → 에러 컨텍스트와 함께 재시도
        if (!sqlResult.success && retryCount < MAX_RETRIES) {
          const errorContext = generateErrorContext(sqlResult.error!, cached.items)
          send('status', { stage: 'retry_sql_error', message: 'SQL 수정 후 재시도 중...' })

          try {
            sqlResponse = await generateSQL(
              `${message}\n\n이전 시도 오류:\n${errorContext}`,
              history,
              apiKey,
              schema
            )
            const retryResult = await executeSQL(sqlResponse.sql, cached.items)

            if (!retryResult.success) {
              throw new Error(`SQL 재실행 실패: ${retryResult.error}`)
            }

            // 재시도 성공
            sqlResult.success = true
            sqlResult.data = retryResult.data
            sqlResult.rowCount = retryResult.rowCount
          } catch (retryError) {
            throw new Error(`SQL 생성/실행 실패: ${retryError instanceof Error ? retryError.message : retryError}`)
          }
        }

        if (!sqlResult.success) {
          throw new Error(`SQL 실행 실패: ${sqlResult.error}`)
        }

        // 테이블 데이터 전송 헬퍼 (2행 이상일 때)
        function sendTable(rows: unknown[], columns?: string[]) {
          if (rows.length < 2) return
          const firstRow = rows[0] as Record<string, unknown> | undefined
          if (!firstRow) return
          const cols = columns || Object.keys(firstRow)
          const labels: Record<string, string> = {}
          for (const col of cols) {
            if (COLUMN_LABELS[col]) {
              labels[col] = COLUMN_LABELS[col].split(' (')[0]
            } else {
              const lower = col.toLowerCase()
              if (AGGREGATE_LABELS[lower]) labels[col] = AGGREGATE_LABELS[lower]
            }
          }
          send('table', { columns: cols, labels, rows: rows.slice(0, 200) })
        }

        // 3단계: 결과 처리 분기
        const data = sqlResult.data!

        if (!sqlResponse.needsResult) {
          // 로컬 처리 (LLM 요약 불필요 → API 1회로 끝)
          send('status', { stage: 'local_processing', message: '결과 처리 중...' })

          let answer = ''

          if (data.length === 0) {
            answer = '결과가 없습니다.'
          } else if (data.length === 1 && typeof data[0] === 'object') {
            const row = data[0] as Record<string, unknown>
            const keys = Object.keys(row)

            if (keys.length === 1) {
              const value = row[keys[0]]
              if (typeof value === 'number') {
                answer = `${value.toLocaleString()}건입니다.`
              } else {
                answer = `${value}`
              }
            } else {
              answer = JSON.stringify(row, null, 2)
            }
          } else {
            // 여러 행 → 테이블 + 건수 안내
            sendTable(data)
            answer = `총 ${data.length.toLocaleString()}건입니다.`
          }

          for (const char of answer) {
            sendToken(char)
            await new Promise(resolve => setTimeout(resolve, 10))
          }

          send('done', { answer })
        } else {
          // LLM 요약 필요 (순위, 비교, 분석 등 → API 2회)
          send('status', { stage: 'summarizing', message: '답변 준비 중...' })

          const filtered = sqlResponse.columnsNeeded
            ? filterColumns(data, sqlResponse.columnsNeeded)
            : data

          sendTable(filtered, sqlResponse.columnsNeeded)

          const resultText = formatResultForLLM(filtered, 50)

          await streamSummary(message, resultText, history, apiKey, controller)

          send('done', {})
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '알 수 없는 오류'
        send('error', { message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
