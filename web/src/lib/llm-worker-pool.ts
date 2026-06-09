// LLM 워커 풀 — Groq + Mistral + Cerebras 9개 워커 병렬 호출
//
// 도메인 중립 인프라: cert 도메인뿐 아니라 ai 도메인도 공유 사용.
// 글로벌 싱글턴 (HMR 대응) — process 전체에서 단일 풀.
//
// 사용:
//   import { llmPool, parseLlmJson } from '@/lib/llm-worker-pool'
//   const res = await llmPool.submit(prompt, systemPrompt, maxTokens)
//   const obj = parseLlmJson<T>(res.content)
//
// rate limit(429) 시 해당 워커 쿨다운, 작업은 다른 워커에 재할당.
// 413 TPM 초과 시 해당 워커 영구 제외 후 재시도.

// ─── 워커 정의 ───

export interface LlmProvider {
  name: string
  url: string
  key: string
  model: string
}

// Groq-Mistral 교차 배치: 한쪽 호스팅 rate limit 걸려도 다른 쪽으로 빠르게 전환
function getLlmWorkers(): LlmProvider[] {
  return [
    {
      name: 'Groq-70B',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'llama-3.3-70b-versatile',
    },
    {
      name: 'Mistral-S',
      url: 'https://api.mistral.ai/v1/chat/completions',
      key: process.env.MISTRAL_API_KEY ?? '',
      model: 'mistral-small-latest',
    },
    {
      name: 'Groq-Llama3.1-8B',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'llama-3.1-8b-instant',
    },
    {
      name: 'Mistral-M',
      url: 'https://api.mistral.ai/v1/chat/completions',
      key: process.env.MISTRAL_API_KEY ?? '',
      model: 'mistral-medium-latest',
    },
    {
      name: 'Mistral-L',
      url: 'https://api.mistral.ai/v1/chat/completions',
      key: process.env.MISTRAL_API_KEY ?? '',
      model: 'mistral-large-latest',
    },
    {
      name: 'Cerebras-GPT-120B',
      url: 'https://api.cerebras.ai/v1/chat/completions',
      key: process.env.CEREBRAS_API_KEY ?? '',
      model: 'gpt-oss-120b',
    },
    {
      name: 'Groq-Scout',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    },
    {
      name: 'Cerebras-Llama-8B',
      url: 'https://api.cerebras.ai/v1/chat/completions',
      key: process.env.CEREBRAS_API_KEY ?? '',
      model: 'llama3.1-8b',
    },
    {
      name: 'Groq-Qwen3-32B',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'qwen/qwen3-32b',
    },
  ]
}

// ─── 응답 타입 ───

export interface LlmResponse {
  content: string
  model: string
  elapsed: number // ms
}

// ─── 에러 클래스 ───

export class RateLimitError extends Error {
  constructor(public provider: string, public waitMs: number) {
    super(`${provider} 429 rate limit`)
  }
}

export class TpmExceededError extends Error {
  constructor(public provider: string) {
    super(`${provider} 413 TPM 초과 — 요청이 모델 한도보다 큼`)
  }
}

// ─── 워커 풀 ───

interface LlmTask {
  prompt: string
  systemPrompt?: string
  maxTokens: number
  retries: number
  failedWorkers: Set<string>
  resolve: (r: LlmResponse) => void
  reject: (e: Error) => void
}

interface WorkerState {
  provider: LlmProvider
  busy: boolean
  cooldownUntil: number
}

const MAX_RETRIES = 3

class LlmWorkerPool {
  private workers: WorkerState[] = []
  private queue: LlmTask[] = []
  private initialized = false

  private init() {
    if (this.initialized) return
    this.workers = getLlmWorkers()
      .filter(p => !!p.key)
      .map(p => ({ provider: p, busy: false, cooldownUntil: 0 }))
    this.initialized = true
    console.log(`[pool] 워커 ${this.workers.length}개 초기화: ${this.workers.map(w => w.provider.name).join(', ')}`)
  }

  private getIdleWorker(failedWorkers?: Set<string>): WorkerState | null {
    const now = Date.now()
    const idle = this.workers.find(w =>
      !w.busy && w.cooldownUntil <= now && (!failedWorkers || !failedWorkers.has(w.provider.name))
    )
    if (idle) return idle
    return this.workers.find(w => !w.busy && w.cooldownUntil <= now) ?? null
  }

  submit(prompt: string, systemPrompt?: string, maxTokens = 2000): Promise<LlmResponse> {
    this.init()
    return new Promise<LlmResponse>((resolve, reject) => {
      this.queue.push({
        prompt, systemPrompt, maxTokens,
        retries: MAX_RETRIES,
        failedWorkers: new Set(),
        resolve, reject,
      })
      this.dispatch()
    })
  }

  private dispatch() {
    while (this.queue.length > 0) {
      const task = this.queue[0]
      const worker = this.getIdleWorker(task.failedWorkers)
      if (!worker) break

      this.queue.shift()
      worker.busy = true
      this.execute(worker, task)
    }
  }

  private async execute(worker: WorkerState, task: LlmTask) {
    try {
      const result = await this.callSingle(worker.provider, task)
      worker.busy = false
      task.resolve(result)
    } catch (err) {
      worker.busy = false
      const errMsg = err instanceof Error ? err.message : String(err)

      if (err instanceof TpmExceededError) {
        task.failedWorkers.add(worker.provider.name)
        console.log(`[pool] ${worker.provider.name} TPM 초과 → 제외 (재시도 차감 없음)`)
      } else if (err instanceof RateLimitError) {
        task.retries--
        const cooldownUntil = Date.now() + err.waitMs
        // Groq/Cerebras: 모델별 독립 rate limit → 같은 모델만 쿨다운
        // Mistral: 조직 단위 공유 rate limit → 같은 키 전체 쿨다운
        const isPerModel = worker.provider.url.includes('groq.com') || worker.provider.url.includes('cerebras.ai')
        const affectedWorkers = isPerModel
          ? this.workers.filter(w => w.provider.model === worker.provider.model)
          : this.workers.filter(w => w.provider.key === worker.provider.key)
        for (const w of affectedWorkers) w.cooldownUntil = Math.max(w.cooldownUntil, cooldownUntil)
        const names = affectedWorkers.map(w => w.provider.name).join('+')
        console.log(`[pool] ${names} 429 → ${(err.waitMs / 1000).toFixed(0)}s 쿨다운 (남은 재시도: ${task.retries})`)
      } else {
        task.retries--
        task.failedWorkers.add(worker.provider.name)
        console.log(`[pool] ${worker.provider.name} 실패: ${errMsg} (남은 재시도: ${task.retries})`)
      }

      if (task.retries <= 0) {
        task.reject(new Error(`모든 재시도 소진: ${errMsg}`))
        this.dispatch()
        return
      }

      this.queue.unshift(task)

      if (this.getIdleWorker(task.failedWorkers)) {
        this.dispatch()
      } else {
        const earliest = Math.min(...this.workers.map(w =>
          w.busy ? Date.now() + 30000 : w.cooldownUntil
        ))
        const wait = Math.max(earliest - Date.now(), 1000)
        setTimeout(() => this.dispatch(), Math.min(wait, 10000))
      }
      return
    }
    this.dispatch()
  }

  private async callSingle(provider: LlmProvider, task: LlmTask): Promise<LlmResponse> {
    if (!provider.key) throw new Error(`${provider.name} API 키 없음`)

    const messages: { role: string; content: string }[] = []
    if (task.systemPrompt) messages.push({ role: 'system', content: task.systemPrompt })
    messages.push({ role: 'user', content: task.prompt })

    const t0 = Date.now()
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.0,
        max_tokens: task.maxTokens,
        response_format: { type: 'json_object' },
      }),
    })

    if (res.status === 429) {
      throw new RateLimitError(provider.name, 5000)
    }

    if (res.status === 413) {
      throw new TpmExceededError(provider.name)
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${provider.name} ${res.status}: ${text.slice(0, 200)}`)
    }

    const data = await res.json()
    return {
      content: data.choices[0].message.content,
      model: provider.model,
      elapsed: Date.now() - t0,
    }
  }
}

// 글로벌 싱글턴 (HMR 대응)
const g = globalThis as unknown as { _llmPool?: LlmWorkerPool }
if (!g._llmPool) g._llmPool = new LlmWorkerPool()
export const llmPool = g._llmPool

// ─── JSON 파싱 헬퍼 ───
// LLM 응답에서 JSON 추출 + 토큰 한도로 잘린 JSON 자동 복구

export function parseLlmJson<T>(content: string): T {
  try {
    return JSON.parse(content)
  } catch {
    // 1차: JSON 부분만 추출
    const start = content.indexOf('{')
    if (start < 0) throw new Error('JSON 파싱 실패')
    const end = content.lastIndexOf('}') + 1
    if (end > start) {
      try { return JSON.parse(content.slice(start, end)) } catch { /* fall through */ }
    }

    // 2차: 토큰 한도로 잘린 JSON 복구
    let json = content.slice(start)
    const lastComplete = Math.max(json.lastIndexOf('},'), json.lastIndexOf('null,'), json.lastIndexOf('",'))
    if (lastComplete > 0) {
      json = json.slice(0, lastComplete + 1)
      json = json.replace(/,\s*$/, '')
    }
    const opens: string[] = []
    let inStr = false
    let escape = false
    for (const ch of json) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{') opens.push('}')
      else if (ch === '[') opens.push(']')
      else if (ch === '}' || ch === ']') opens.pop()
    }
    json += opens.reverse().join('')
    try { return JSON.parse(json) } catch { /* fall through */ }

    throw new Error('JSON 파싱 실패')
  }
}
