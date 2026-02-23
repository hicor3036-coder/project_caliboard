// 교정성적서 다운로드 + LLM 워커 풀 파싱
//
// === 전체 흐름 ===
// 1. acptNo 변환 (DB zero-padded → API unpadded)
// 2. 보안 토큰 발급 (getSecToken)
// 3. PDF→Excel 변환 요청 (서버에서 DRM 해제 + 변환)
// 4. Excel 다운로드
// 5. 규칙기반 파싱 (cert-parser.ts)
// 6. [필요 시] LLM 워커 풀 파싱 (Groq, Mistral-S, Mistral-M 병렬)
//
// === LLM 워커 풀 ===
// 3개 워커(Groq, Mistral Small, Mistral Medium)가 유휴 상태에서 작업을 가져감.
// rate limit(429) 시 해당 워커 쿨다운, 작업은 다른 워커에 재할당.
// 여러 성적서 동시 처리 시 최대 3배 속도 향상.

import { parseCertExcel, excelToText, conformityToText, conformityToStructuredText, findConformitySheet, findCalibrationResultSheets, calibrationResultsToText } from './cert-parser'
import type { CertResult, MeasurementPoint } from './cert-cache'

const BASE_URL = 'https://k-tools.ktl.re.kr'

// ─── LLM 설정 ───

const LLM_MISSING_THRESHOLD = 2
const LLM_KEY_FIELDS: (keyof CertResult)[] = ['제조사', '모델', '시리얼', '교정일']

interface LlmProvider {
  name: string
  url: string
  key: string
  model: string
}

function getLlmWorkers(): LlmProvider[] {
  return [
    {
      name: 'Groq-70B',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'llama-3.3-70b-versatile',
    },
    {
      name: 'Groq-Maverick',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    },
    {
      name: 'Groq-Scout',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    },
    {
      name: 'Mistral-S',
      url: 'https://api.mistral.ai/v1/chat/completions',
      key: process.env.MISTRAL_API_KEY ?? '',
      model: 'mistral-small-latest',
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
  ]
}

// ─── LLM 워커 풀 ───
// 유휴 워커를 할당해 LLM 호출. rate limit(429) 시 해당 워커를 쿨다운,
// 작업은 다른 유휴 워커에게 재할당. 모든 워커가 바쁘면 먼저 끝나는 워커 대기.

interface LlmTask {
  prompt: string
  systemPrompt?: string
  maxTokens: number
  retries: number // 남은 재시도 횟수
  failedWorkers: Set<string> // 이 작업에서 실패한 워커 이름
  resolve: (r: LlmResponse) => void
  reject: (e: Error) => void
}

interface WorkerState {
  provider: LlmProvider
  busy: boolean
  cooldownUntil: number // Date.now() 기준, 429 시 쿨다운 시각
}

const MAX_RETRIES = 3 // 작업당 최대 재시도 (429 포함)

class LlmWorkerPool {
  private workers: WorkerState[] = []
  private queue: LlmTask[] = []
  private initialized = false

  private init() {
    if (this.initialized) return
    this.workers = getLlmWorkers()
      .filter(p => !!p.key) // API 키 있는 것만
      .map(p => ({ provider: p, busy: false, cooldownUntil: 0 }))
    this.initialized = true
    console.log(`[pool] 워커 ${this.workers.length}개 초기화: ${this.workers.map(w => w.provider.name).join(', ')}`)
  }

  // 유휴 워커 중 쿨다운 아닌 것 반환 (실패한 워커 제외)
  private getIdleWorker(failedWorkers?: Set<string>): WorkerState | null {
    const now = Date.now()
    // 실패하지 않은 워커 우선
    const idle = this.workers.find(w =>
      !w.busy && w.cooldownUntil <= now && (!failedWorkers || !failedWorkers.has(w.provider.name))
    )
    if (idle) return idle
    // 실패 워커라도 유휴면 반환 (재시도 횟수 내에서)
    return this.workers.find(w => !w.busy && w.cooldownUntil <= now) ?? null
  }

  // 작업 제출 → Promise 반환
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

  // 큐에서 작업 꺼내 유휴 워커에 할당
  private dispatch() {
    while (this.queue.length > 0) {
      const task = this.queue[0]
      const worker = this.getIdleWorker(task.failedWorkers)
      if (!worker) break // 유휴 워커 없음

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
      task.retries--
      const errMsg = err instanceof Error ? err.message : String(err)

      if (err instanceof RateLimitError) {
        // 429: 같은 API 키 공유하는 워커 모두 쿨다운 (rate limit은 키 단위)
        const cooldownUntil = Date.now() + err.waitMs
        const sameKeyWorkers = this.workers.filter(w => w.provider.key === worker.provider.key)
        for (const w of sameKeyWorkers) w.cooldownUntil = Math.max(w.cooldownUntil, cooldownUntil)
        const names = sameKeyWorkers.map(w => w.provider.name).join('+')
        console.log(`[pool] ${names} 429 → ${(err.waitMs / 1000).toFixed(0)}s 쿨다운 (남은 재시도: ${task.retries})`)
      } else {
        // 500 등: 이 워커를 실패 목록에 추가
        task.failedWorkers.add(worker.provider.name)
        console.log(`[pool] ${worker.provider.name} 실패: ${errMsg} (남은 재시도: ${task.retries})`)
      }

      // 재시도 소진 → 최종 실패
      if (task.retries <= 0) {
        task.reject(new Error(`모든 재시도 소진: ${errMsg}`))
        this.dispatch()
        return
      }

      // 재시도: 큐 앞에 삽입
      this.queue.unshift(task)

      // 유휴 워커 있으면 즉시, 없으면 쿨다운 후 재시도
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
    // 작업 완료 후 대기 중인 작업 처리
    this.dispatch()
  }

  private async callSingle(
    provider: LlmProvider,
    task: LlmTask,
  ): Promise<LlmResponse> {
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

class RateLimitError extends Error {
  constructor(public provider: string, public waitMs: number) {
    super(`${provider} 429 rate limit`)
  }
}

// 글로벌 싱글턴 (HMR 대응)
const g = globalThis as unknown as { _llmPool?: LlmWorkerPool }
if (!g._llmPool) g._llmPool = new LlmWorkerPool()
const llmPool = g._llmPool

const LLM_SYSTEM_PROMPT = `You are a calibration certificate data extraction assistant.
You will receive the text content of a calibration certificate Excel file (converted from PDF).
The certificate may contain:
- 갑지 (Cover page): basic equipment info
- 을지 (Calibration results): measurement data (may be multiple pages)
- 적합성검토서 (Conformity Review): PASS/FAIL results (last page, optional)

Extract ALL available information and return a JSON object with these fields:
{
  "성적서번호": "certificate number",
  "고객명": "client/customer name",
  "장비명": "equipment description",
  "제조사": "manufacturer",
  "모델": "model name",
  "시리얼": "serial number",
  "관리번호": "identification/management number",
  "교정일": "date of calibration",
  "차기교정일": "next calibration date",
  "전체판정": "PASS" or "FAIL" or null,
}

Rules:
- Return ONLY the JSON object, no additional text
- If a field is not found, use null
- Dates should be in original format
- For 전체판정: PASS only if ALL measurement points passed, FAIL if any failed`

// ─── acptNo 변환 ───

export function makeApiAcceptNo(acptNo: string): string {
  // "26-010119-02-012" → "26-010119-02-12" (마지막 부분 zero-padding 제거)
  const lastDash = acptNo.lastIndexOf('-')
  if (lastDash < 0) return acptNo
  const prefix = acptNo.slice(0, lastDash + 1)
  const suffix = parseInt(acptNo.slice(lastDash + 1), 10)
  return `${prefix}${suffix}`
}

// ─── k-tools API 호출 ───

async function getSecToken(sessionId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/spm/api/getSecToken`, {
    method: 'POST',
    headers: { 'Cookie': `KTOOLS_JSESSIONID=${sessionId}` },
  })
  if (!res.ok) throw new Error(`토큰 발급 HTTP ${res.status}`)
  const data = await res.json()
  if (data.code !== 200) throw new Error(`토큰 발급 실패: ${JSON.stringify(data)}`)
  if (!data.data?.token) throw new Error('토큰 데이터 없음')
  return data.data.token
}

export async function downloadCertExcel(
  sessionId: string,
  apiAcceptNo: string,
): Promise<Buffer | null> {
  // Step 1: PDF→Excel 변환 요청 (서버에서 DRM 해제 + 변환)
  const token = await getSecToken(sessionId)
  const convertRes = await fetch(
    `${BASE_URL}/spm/api/spm0907_saveReportCardPdfToExcel.ajax`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': `KTOOLS_JSESSIONID=${sessionId}`,
      },
      body: `acptNo=${apiAcceptNo}&token=${token}`,
    },
  )
  const convertData = await convertRes.json()
  if (convertData.code !== 200) return null

  // Step 2: 다운로드
  const dlRes = await fetch(`${BASE_URL}/excel/getAcptNoPdfToExcel.do`, {
    headers: { 'Cookie': `KTOOLS_JSESSIONID=${sessionId}` },
  })
  const contentType = dlRes.headers.get('Content-Type') ?? ''
  if (!contentType.includes('spreadsheet')) return null

  const arrayBuffer = await dlRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ─── LLM 호출 (워커 풀 경유) ───

interface LlmResponse {
  content: string
  model: string
  elapsed: number // ms
}

// JSON 파싱 헬퍼 (부분 추출 포함)
function parseLlmJson<T>(content: string): T {
  try {
    return JSON.parse(content)
  } catch {
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}') + 1
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end))
    }
    throw new Error('JSON 파싱 실패')
  }
}

// LLM 파싱 (워커 풀)
async function llmParse(
  buffer: Buffer,
  acptNo?: string,
): Promise<{ parsed: Record<string, unknown>; provider: string } | null> {
  let text = await excelToText(buffer)
  if (text.length > 8000) text = text.slice(0, 8000) + '\n... (truncated)'

  const prompt = `다음은 교정성적서 Excel 파일의 내용입니다. 정보를 추출해주세요.\n\n${text}`

  try {
    const { content, model, elapsed } = await llmPool.submit(prompt, LLM_SYSTEM_PROMPT)
    console.log(`[pool] 기본정보 보강 ${acptNo ?? ''} → ${model} ${(elapsed / 1000).toFixed(1)}s`)
    return { parsed: parseLlmJson(content), provider: model }
  } catch (err) {
    console.error(`[pool] 기본정보 보강 ${acptNo ?? ''} 실패:`, err instanceof Error ? err.message : err)
    return null
  }
}

// ─── LLM 보강 ───

async function llmSupplement(
  result: CertResult,
  buffer: Buffer,
  acptNo?: string,
): Promise<CertResult> {
  // 핵심 필드 중 THRESHOLD 이상 누락 시 LLM 호출
  const missing = LLM_KEY_FIELDS.filter(f => !result[f])
  if (missing.length < LLM_MISSING_THRESHOLD) return result

  const llmResult = await llmParse(buffer, acptNo)
  if (!llmResult) return result

  const { parsed, provider } = llmResult
  const fillFields = [
    '성적서번호', '고객명', '장비명', '제조사', '모델',
    '시리얼', '관리번호', '교정일', '차기교정일', '전체판정',
  ]

  const filled: string[] = []
  for (const f of fillFields) {
    const resultVal = result[f as keyof CertResult]
    const llmVal = parsed[f]
    if (!resultVal && llmVal && String(llmVal) !== 'null') {
      ;(result as unknown as Record<string, unknown>)[f] = String(llmVal)
      filled.push(f)
    }
  }

  result._llm_보강 = filled
  result._llm_provider = provider
  return result
}

// ─── 적합성검토서 LLM 구조화 파싱 ───

const CONFORMITY_SYSTEM_PROMPT = `You are a calibration certificate conformity review sheet parser.
The input is the FULL content of a conformity review sheet (pipe-delimited rows).
It contains equipment info at the top and one or more measurement tables below.
You must identify the table structure yourself — headers, data rows, and sections.

IMPORTANT CONTEXT: This data was converted from PDF to Excel automatically.
As a result, cell positions may be misaligned, headers may span multiple rows,
merged cells may appear as empty cells, and column alignment may be imperfect.
Interpret the data flexibly based on context, not rigid cell positions.

Return JSON:
{
  "equipment": {
    "manufacturer": "string or null",
    "model": "string or null",
    "serial": "string or null",
    "certNo": "string or null",
    "calDate": "YYYY-MM-DD or null",
    "dueDate": "YYYY-MM-DD or null"
  },
  "measurements": [
    {
      "quantity": "Torque Clockwise",
      "ref": "2279",
      "refUnit": "N·cm",
      "indicated": "2260",
      "indUnit": "N·cm",
      "error": "-0.8",
      "errUnit": "%",
      "tolerance": "4",
      "tolUnit": "%",
      "result": "PASS"
    }
  ],
  "overall": "PASS"
}

CRITICAL RULES:

1. COLUMN IDENTIFICATION — Find the table header rows in the input.
   Headers may span multiple rows (e.g., one row has "Reference Torque", next row has "Average", next row has "(N·m)").
   Combine vertically-aligned header rows to determine each column's full meaning.
   Map columns based on MEANING in calibration context:

   - ref: The STANDARD/REFERENCE value from the calibrator
   - indicated: The value shown by the DEVICE UNDER TEST
   - error: The deviation/difference (may be absolute or percentage)
   - tolerance: The acceptable limit or allowable range
   - result: PASS/FAIL conformity judgment

2. DUPLICATE UNIT COLUMNS — When the same measurement appears in multiple units (e.g., N·cm AND lbf·in), use ONLY the first (primary) unit. Skip secondary unit columns entirely.

3. ERROR/DEVIATION — Priority order:
   a) If the table has an explicit error/deviation column (e.g., "Relative Accuracy Error (%)", "Error", "Deviation"), use that value and unit DIRECTLY. Do NOT recalculate.
   b) IMPORTANT: "Correction" is NOT the same as "Error".
      Correction = Reference - Indication (opposite sign of error).
      If only a "Correction" column exists with NO separate "Error" column, calculate: error = indicated - ref. Do NOT use the Correction value as error.
   c) Only if NO error column exists: calculate error = indicated - ref (preserve sign), errUnit = same as ref unit.
   errUnit must reflect the actual unit. If header says "(%)", errUnit = "%".

   SANITY CHECK — After mapping columns, verify:
   - If errUnit is "%", the error value should typically be small (< 10). If error ≈ ref or error ≈ indicated, you have a COLUMN MAPPING BUG — re-examine which column is actually the error column.
   - error must come from a column whose header contains words like "Error", "Deviation", "Accuracy", "오차", "편차". NEVER use the indicated/ref value column as error.
   - If error value equals the indicated value, something is wrong. Re-read the headers carefully.

4. TOLERANCE PARSING — For compound expressions like "±0.5 μm (±2 %)":
   Use the absolute value: tolerance="0.5", tolUnit="μm"
   For "±4.0 %": tolerance="4.0", tolUnit="%"
   Always strip the ± sign from the number.
   If tolerance contains non-numeric text (e.g., "Refer to the attached calibration results"), set tolerance=null, tolUnit=null.

5. MULTIPLE TABLES — The input may contain multiple measurement sections (e.g., "Clockwise" + "Counterclockwise", or "TEMPERATURE" + "HUMIDITY").
   Look for section labels like "Clockwise", "Counterclockwise", "TEMPERATURE", "HUMIDITY" in the data.
   Include ALL measurements from ALL sections.
   Use quantity field to distinguish (e.g., "Torque Clockwise", "Torque Counterclockwise", "Temperature", "Humidity").

6. GROUPED VALUES — CRITICAL pattern for some instruments:
   Some tables show error, tolerance, and result on ONLY ONE ROW within a group of data rows.
   That single value applies to ALL data rows in that group.

   How to identify: Multiple data rows with ref/indicated values, but error/tolerance/result cells are empty.
   Then one row has error/tolerance/result but may lack ref/indicated.
   → The error/tolerance/result apply to ALL rows in the group.

   You MUST populate the same error, tolerance, and result for every data row in the group.
   Do NOT calculate individual errors per row — use the group's shared value.

7. DATA ROWS — Rows with numeric measurement data are data rows even without PASS/FAIL.
   Rows with only "-" in error/tolerance/result columns are also data rows (the "-" means "not applicable" for that specific point, often the 0.0 reference point).
   Skip rows where ref=0.0 and indicated=0.0 with "-" markers (zero calibration point, not a measurement).
   INVALID DATA: If a section contains "#DIV/0!", all-zero reference values, or "#DIV/0!" in result/error columns,
   skip that ENTIRE section. This means the instrument was outside its output range for that direction.

8. quantity: Physical quantity in English (Temperature, Humidity, Pressure, Torque, Length, etc.).
   Infer from section headers or unit patterns. Use section labels for disambiguation (e.g., "Torque Clockwise").

9. Numbers MUST be strings. null for truly missing values.
10. overall: "PASS" only if ALL measurement points passed.

EXAMPLES:

Example 1a — Torque wrench (explicit error column, N·cm):
Input rows include:
  Indicated Torque (N·cm) | (lbf·in) | Ref Torque Calibrator (N·cm) | (lbf·in) | Relative Accuracy Error (%) | Tolerance (±%) | Conformity
  2260 | 1586.8 | 2279 | 1600.2 | -0.8 | 4 | PASS
→ indicated=2260 (N·cm), ref=2279 (N·cm), error=-0.8 (%), tolerance=4 (%), result=PASS
Note: "(lbf·in)" = secondary unit, skip. Error column exists — use directly.
WRONG: error=2260 or error=2279 — these are ref/indicated values, NOT error!

Example 1b — Torque measuring device (explicit error column, N·m):
Input rows include:
  Indicated Torque | Ref Torque | Relative Accuracy | Tolerance | Conformity
  (N·m) | Calibrator (N·m) | Error (%) | (±%) |
  0.5 | 0.498 | 0.12 | 0.50 | PASS
  1.0 | 0.997 | 0.08 | 0.50 | PASS
→ indicated=0.5, ref=0.498, error=0.12 (%), tolerance=0.50 (%), result=PASS
WRONG: error=0.498 or error=0.5 — these are ref/indicated, NOT error! The error is the SMALL percentage value (0.12%).

Example 2 — Coating thickness (no error column):
Input rows include:
  Nominal value (μm) | Measured value (μm) | Tolerance limit (μm) | Conformity
  24.3 | 24.3 | 0.5 | PASS
→ ref=24.3, indicated=24.3, error=0.0 (calculated), tolerance=0.5

Example 3 — Temperature/Humidity (Correction column, NOT error):
Input rows include:
  Reference (°C) | Indication (°C) | Correction (°C) | Tolerance | Suitability
  15.1 | 15.0 | 0.1 | Refer to the attached calibration results | Pass
→ ref=15.1, indicated=15.0, error=-0.1 (calculated: 15.0-15.1, NOT from Correction), tolerance=null (non-numeric text), result=PASS
Note: "Correction" is NOT error — do not use it. Calculate error = indicated - ref.

Example 4 — Torque device (grouped error/tolerance):
Input rows include:
  Reference Torque | Measured value Average | Relative accuracy err | Specifications | Conformity
  (N·m) | (N·m) | (Full Scale) | (± %) (Full Scale) | (PASS, FAIL)
  0.0 | 0.000 0 | - | - | -
  0.1 | 0.101 2 | | |
  0.2 | 0.201 5 | | |
  0.3 | 0.301 8 | | |
  0.4 | 0.402 0 | | |
  0.5 | 0.502 2 | | |
  | | 0.37 | 0.50 | PASS
  0.6 | 0.602 4 | | |
  ...
  1.0 | 1.003 7 | | |
→ ALL rows (0.1~1.0) share: error=0.37 (%), tolerance=0.50 (%), result=PASS
   Skip the 0.0 row (zero point with "-" markers).
   For each: ref=0.1, indicated=0.1012, error=0.37, errUnit="%", tolerance=0.50, tolUnit="%", result=PASS`

// ─── 을지(교정 측정결과) LLM 파싱 프롬프트 ───

const CALIBRATION_RESULTS_SYSTEM_PROMPT = `You are a calibration certificate measurement data parser.
The input contains calibration measurement results (을지/calibration results pages).
This data was converted from PDF to Excel automatically, so cell alignment may be imperfect.
The data may be in Korean, English, or mixed.

Multiple sheets may be concatenated with "=== Page N ===" separators.

Return JSON:
{
  "equipment": {
    "manufacturer": "string or null",
    "model": "string or null",
    "serial": "string or null",
    "certNo": "string or null",
    "calDate": "YYYY-MM-DD or null",
    "dueDate": "YYYY-MM-DD or null"
  },
  "measurements": [
    {
      "quantity": "Torque Clockwise",
      "ref": "0.1",
      "refUnit": "N·m",
      "indicated": "0.1012",
      "indUnit": "N·m",
      "error": "0.69",
      "errUnit": "%",
      "tolerance": null,
      "tolUnit": null,
      "result": null
    }
  ],
  "overall": null
}

RULES:

1. COLUMN IDENTIFICATION — Headers often span multiple rows.
   Combine vertically-aligned header rows to determine each column's meaning.
   Typical columns in calibration results:
   - Reference value (기준값/Reference/Standard) → ref
   - Indication/Measured value (지시값/Indication/Measured/DUT) → indicated
   - Multiple error columns may exist (Reproducibility, Interpolation, Zero, Reversibility, etc.)
   - Use the FIRST error column (usually "Relative error" or "Reproducibility") as the primary error → error
   - Uncertainty column → ignore (not error)
   - Class/Grade → ignore

2. SECTION LABELS — Look for "Clockwise", "Counterclockwise", "CW", "CCW",
   "시계방향", "반시계방향", "TEMPERATURE", "HUMIDITY", "온도", "습도" etc.
   Use these as quantity prefixes (e.g., "Torque Clockwise", "Temperature").

3. MULTIPLE INDICATION COLUMNS — Priority for indicated value:
   a) If an "Average" column exists (among multiple runs like 1 Run, 2 Run, 3 Run, Average), use Average.
   b) If "Increasing indication" and "Decreasing indication" exist without Average, use Increasing.
   c) If only single indication/measured column, use that.

4. ERROR — Use the FIRST relative/percentage error column value.
   errUnit is typically "%". Do NOT recalculate — use the table value directly.
   "Correction" column: same rule as conformity — it is NOT error.

5. TOLERANCE — Calibration results typically do NOT have tolerance columns.
   Set tolerance=null, tolUnit=null.

6. RESULT — No PASS/FAIL in calibration results. Set result=null for all rows.

7. SKIP zero-point rows: Where ref=0.0 and indicated ≈ 0.0 with "-" markers.
   INVALID SECTIONS: If a section contains "#DIV/0!", all-zero reference values, or other Excel error values,
   skip that ENTIRE section — the instrument was outside its output range for that direction.

8. Numbers MUST be strings. null for missing values.
9. overall: null (no conformity judgment in calibration results).

EXAMPLES:

Example 1 — Torque measuring device (Increasing/Decreasing):
Input rows include:
  Reference | | | Relative | Reproducibility | Zero | Reversibility
  Torque | Increasing | Decreasing | Measurement | error | error | error | error | Class
  | indication | indication | Uncertainty(%) | (%) | (%) | (%) | (%)
  (N·m)
  0.0 | 0.000 0 | 0.000 1 | - | - | - | - | - | -
  0.1 | 0.101 2 | 0.101 4 | 0.86 | 0.69 | 0.36 | 0.02 | 0.20 | 1
→ ref=0.1, refUnit="N·m", indicated=0.1012, indUnit="N·m", error=0.69, errUnit="%"
Note: Use Increasing indication. First error column (Relative error = 0.69). Skip 0.0 row.

Example 2 — Torque wrench (1 Run / 2 Run / 3 Run / Average):
Input rows include:
  Indicated | Indicated Value of the Reference | | | | Relative Accuracy
  Torque | Torque Calibrator | | | | Error
  (N·cm) | 1 Run | 2 Run | 3 Run | Average | (%)
  0 | 0 | 0 | 0 | 0 | -
  2 260 | 2 229 | 2 228 | 2 229 | 2 229 | 1.4
  4 519 | 4 464 | 4 478 | 4 482 | 4 475 | 1.0
→ ref=2229 (Average column), refUnit="N·cm", indicated=2260, indUnit="N·cm", error=1.4, errUnit="%"
Note: Use Average column for ref (it's the reference calibrator average). Indicated Torque = DUT reading. Skip 0 row.`

interface LlmConformityResult {
  equipment: {
    manufacturer?: string | null
    model?: string | null
    serial?: string | null
    certNo?: string | null
    calDate?: string | null
    dueDate?: string | null
  }
  measurements: Array<{
    quantity?: string | null
    ref?: string | null
    refUnit?: string | null
    indicated?: string | null
    indUnit?: string | null
    error?: string | null
    errUnit?: string | null
    tolerance?: string | null
    tolUnit?: string | null
    result?: string | null
  }>
  overall?: string | null
}

async function llmParseConformity(
  conformityText: string,
): Promise<{ result: LlmConformityResult; provider: string } | null> {
  const prompt = `Parse the following conformity review sheet data:\n\n${conformityText}`

  try {
    const { content, model, elapsed } = await llmPool.submit(prompt, CONFORMITY_SYSTEM_PROMPT, 4000)
    const parsed = parseLlmJson<LlmConformityResult>(content)
    // 디버그: 첫 측정포인트 샘플 출력
    const sample = parsed.measurements?.[0]
    if (sample) {
      console.log(`[pool] 적합성검토서 → ${model} ${(elapsed / 1000).toFixed(1)}s | 샘플: ref=${sample.ref} ind=${sample.indicated} err=${sample.error}(${sample.errUnit}) tol=${sample.tolerance}(${sample.tolUnit}) ${sample.result}`)
    } else {
      console.log(`[pool] 적합성검토서 → ${model} ${(elapsed / 1000).toFixed(1)}s | 측정포인트 0개`)
    }
    return { result: parsed, provider: model }
  } catch (err) {
    console.error('[pool] 적합성검토서 실패:', err instanceof Error ? err.message : err)
    return null
  }
}

// 을지 LLM 파싱 (같은 응답 구조 재활용)
async function llmParseCalibrationResults(
  text: string,
): Promise<{ result: LlmConformityResult; provider: string } | null> {
  const prompt = `Parse the following calibration measurement results data:\n\n${text}`

  try {
    const { content, model, elapsed } = await llmPool.submit(prompt, CALIBRATION_RESULTS_SYSTEM_PROMPT, 4000)
    const parsed = parseLlmJson<LlmConformityResult>(content)
    const sample = parsed.measurements?.[0]
    if (sample) {
      console.log(`[pool] 을지 → ${model} ${(elapsed / 1000).toFixed(1)}s | 샘플: ref=${sample.ref} ind=${sample.indicated} err=${sample.error}(${sample.errUnit}) tol=${sample.tolerance}(${sample.tolUnit})`)
    } else {
      console.log(`[pool] 을지 → ${model} ${(elapsed / 1000).toFixed(1)}s | 측정포인트 0개`)
    }
    return { result: parsed, provider: model }
  } catch (err) {
    console.error('[pool] 을지 실패:', err instanceof Error ? err.message : err)
    return null
  }
}

function conformityResultToMeasurements(
  llm: LlmConformityResult,
): MeasurementPoint[] {
  return (llm.measurements || []).map(m => ({
    // 기존 필드 (하위호환)
    원본데이터: [m.ref, m.refUnit, m.indicated, m.indUnit, m.error, m.tolerance, m.result]
      .filter((v): v is string => v != null && v !== ''),
    숫자값: [m.ref, m.indicated, m.error, m.tolerance]
      .map(v => v ? parseFloat(String(v).replace(/[±<>]/g, '').replace(/\s/g, '').replace(',', '')) : NaN)
      .filter(n => !isNaN(n)),
    판정: (m.result?.toUpperCase() === 'FAIL' ? 'FAIL' : 'PASS') as 'PASS' | 'FAIL',
    셀: [],
    // LLM 구조화 필드
    기준값: m.ref ?? null,
    기준단위: m.refUnit ?? null,
    지시값: m.indicated ?? null,
    지시단위: m.indUnit ?? null,
    오차: m.error ?? null,
    오차단위: m.errUnit ?? null,
    허용오차: m.tolerance ?? null,
    허용오차단위: m.tolUnit ?? null,
    물리량: m.quantity ?? null,
  }))
}

// ─── 1단계: 다운로드 + 규칙기반 파싱 (빠름, 순차 OK) ───

export interface DownloadResult {
  result: CertResult
  buffer: Buffer
}

export async function downloadAndRuleParse(
  sessionId: string,
  acptNo: string,
): Promise<DownloadResult | null> {
  const apiAcceptNo = makeApiAcceptNo(acptNo)
  const buffer = await downloadCertExcel(sessionId, apiAcceptNo)
  if (!buffer) return null

  const result = await parseCertExcel(buffer)
  return { result, buffer }
}

// ─── 2단계: LLM 보강 (느림, 워커 풀 병렬) ───

export async function llmEnhanceCert(
  dl: DownloadResult,
  acptNo?: string,
): Promise<CertResult> {
  const tag = acptNo ? `[cert:${acptNo}]` : '[cert]'
  let { result } = dl
  const { buffer } = dl

  // 1. 적합성검토서가 있으면 LLM 구조화 파싱 시도
  if (result.적합성검토) {
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await wb.xlsx.load(buffer as any)
      const confWs = findConformitySheet(wb)
      if (confWs) {
        const text = conformityToStructuredText(confWs)
        const llmConf = await llmParseConformity(text)
        if (llmConf) {
          const { result: confResult, provider } = llmConf
          const measurements = conformityResultToMeasurements(confResult)
          if (measurements.length > 0) {
            result.측정결과 = measurements
            result.측정포인트수 = measurements.length
            result.전체판정 = measurements.every(m => m.판정 === 'PASS') ? 'PASS' : 'FAIL'
          }
          const eq = confResult.equipment
          if (eq) {
            if (!result.제조사 && eq.manufacturer) result.제조사 = eq.manufacturer
            if (!result.모델 && eq.model) result.모델 = eq.model
            if (!result.시리얼 && eq.serial) result.시리얼 = eq.serial
            if (!result.성적서번호 && eq.certNo) result.성적서번호 = eq.certNo
            if (!result.교정일 && eq.calDate) result.교정일 = eq.calDate
            if (!result.차기교정일 && eq.dueDate) result.차기교정일 = eq.dueDate
          }
          result._llm_provider = provider
          console.log(`${tag} 적합성검토서 → ${provider} | ${measurements.length}포인트`)
        }
      }
    } catch (err) {
      console.error(`${tag} LLM 적합성검토서 실패 (규칙기반 유지):`, err)
    }
  }

  // 2. 적합성검토서가 없고 측정결과도 없으면 을지 LLM 파싱
  if (result.측정포인트수 === 0) {
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await wb.xlsx.load(buffer as any)
      const calSheets = findCalibrationResultSheets(wb)
      if (calSheets.length > 0) {
        const text = calibrationResultsToText(calSheets)
        if (text.trim()) {
          const llmCal = await llmParseCalibrationResults(text)
          if (llmCal) {
            const { result: calResult, provider } = llmCal
            const measurements = conformityResultToMeasurements(calResult)
            if (measurements.length > 0) {
              result.측정결과 = measurements
              result.측정포인트수 = measurements.length
              result.전체판정 = null
            }
            const eq = calResult.equipment
            if (eq) {
              if (!result.제조사 && eq.manufacturer) result.제조사 = eq.manufacturer
              if (!result.모델 && eq.model) result.모델 = eq.model
              if (!result.시리얼 && eq.serial) result.시리얼 = eq.serial
              if (!result.성적서번호 && eq.certNo) result.성적서번호 = eq.certNo
              if (!result.교정일 && eq.calDate) result.교정일 = eq.calDate
              if (!result.차기교정일 && eq.dueDate) result.차기교정일 = eq.dueDate
            }
            result._llm_provider = provider
            console.log(`${tag} 을지 → ${provider} | ${measurements.length}포인트`)
          }
        }
      }
    } catch (err) {
      console.error(`${tag} LLM 을지 실패:`, err)
    }
  }

  // 3. 핵심 필드 누락 시 기존 LLM 보강
  result = await llmSupplement(result, buffer, acptNo)

  return result
}

// ─── 레거시 호환: 순차 다운로드+파싱+LLM (단건용) ───

export async function downloadAndParseCert(
  sessionId: string,
  acptNo: string,
  useLlm = true,
): Promise<CertResult | null> {
  const dl = await downloadAndRuleParse(sessionId, acptNo)
  if (!dl) return null
  if (!useLlm) return dl.result
  return llmEnhanceCert(dl, acptNo)
}

// spm0907.do 페이지 접근 (API 호출 전제조건)
export async function ensureSpmAccess(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/spm/contents/spm0907.do?cnsnClsIdx=32`, {
    headers: { 'Cookie': `KTOOLS_JSESSIONID=${sessionId}` },
  })
}
