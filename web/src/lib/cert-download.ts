// 교정성적서 다운로드 + LLM fallback 보강
//
// === 전체 흐름 ===
// 1. acptNo 변환 (DB zero-padded → API unpadded)
// 2. 보안 토큰 발급 (getSecToken)
// 3. PDF→Excel 변환 요청 (서버에서 DRM 해제 + 변환)
// 4. Excel 다운로드
// 5. 규칙기반 파싱 (cert-parser.ts)
// 6. [필요 시] LLM 보강 (Mistral → Groq fallback)
//
// ※ 건당 2~5초 소요 (서버 변환이 병목)

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
  retries: number
}

function getLlmProviders(): LlmProvider[] {
  return [
    {
      name: 'Mistral',
      url: 'https://api.mistral.ai/v1/chat/completions',
      key: process.env.MISTRAL_API_KEY ?? '',
      model: 'mistral-small-latest',
      retries: 2,
    },
    {
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY ?? '',
      model: 'llama-3.3-70b-versatile',
      retries: 1,
    },
  ]
}

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

// ─── LLM 호출 ───

async function callLlm(
  provider: LlmProvider,
  prompt: string,
  systemPrompt?: string,
  maxTokens = 2000,
): Promise<string> {
  if (!provider.key) throw new Error(`${provider.name} API 키 없음`)

  const messages: { role: string; content: string }[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

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
        temperature: 0.0,
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

  throw new Error(`${provider.name} 429: rate limit ${provider.retries + 1}회 초과`)
}

// LLM 파싱 (3단계 fallback)
async function llmParse(
  buffer: Buffer,
): Promise<{ parsed: Record<string, unknown>; provider: string } | null> {
  let text = await excelToText(buffer)
  if (text.length > 8000) text = text.slice(0, 8000) + '\n... (truncated)'

  const prompt = `다음은 교정성적서 Excel 파일의 내용입니다. 정보를 추출해주세요.\n\n${text}`

  for (const provider of getLlmProviders()) {
    try {
      const content = await callLlm(provider, prompt, LLM_SYSTEM_PROMPT)
      try {
        return { parsed: JSON.parse(content), provider: provider.name }
      } catch {
        // JSON 부분만 추출 시도
        const start = content.indexOf('{')
        const end = content.lastIndexOf('}') + 1
        if (start >= 0 && end > start) {
          return { parsed: JSON.parse(content.slice(start, end)), provider: provider.name }
        }
      }
    } catch {
      continue // 다음 프로바이더로 fallback
    }
  }
  return null
}

// ─── LLM 보강 ───

async function llmSupplement(
  result: CertResult,
  buffer: Buffer,
): Promise<CertResult> {
  // 핵심 필드 중 THRESHOLD 이상 누락 시 LLM 호출
  const missing = LLM_KEY_FIELDS.filter(f => !result[f])
  if (missing.length < LLM_MISSING_THRESHOLD) return result

  const llmResult = await llmParse(buffer)
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

Example 1 — Torque wrench (explicit error column):
Input rows include:
  Indicated Torque (N·cm) | (lbf·in) | Ref Torque Calibrator (N·cm) | (lbf·in) | Relative Accuracy Error (%) | Tolerance (±%) | Conformity
  2260 | 1586.8 | 2279 | 1600.2 | -0.8 | 4 | PASS
→ indicated=2260 (N·cm), ref=2279 (N·cm), error=-0.8 (%), tolerance=4 (%), result=PASS
Note: "(lbf·in)" = secondary unit, skip. Error column exists — use directly.

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

  for (const provider of getLlmProviders()) {
    try {
      const content = await callLlm(provider, prompt, CONFORMITY_SYSTEM_PROMPT, 4000)
      try {
        return { result: JSON.parse(content) as LlmConformityResult, provider: provider.name }
      } catch {
        const start = content.indexOf('{')
        const end = content.lastIndexOf('}') + 1
        if (start >= 0 && end > start) {
          return { result: JSON.parse(content.slice(start, end)) as LlmConformityResult, provider: provider.name }
        }
      }
    } catch {
      continue
    }
  }
  return null
}

// 을지 LLM 파싱 (같은 응답 구조 재활용)
async function llmParseCalibrationResults(
  text: string,
): Promise<{ result: LlmConformityResult; provider: string } | null> {
  const prompt = `Parse the following calibration measurement results data:\n\n${text}`

  for (const provider of getLlmProviders()) {
    try {
      const content = await callLlm(provider, prompt, CALIBRATION_RESULTS_SYSTEM_PROMPT, 4000)
      try {
        return { result: JSON.parse(content) as LlmConformityResult, provider: provider.name }
      } catch {
        const start = content.indexOf('{')
        const end = content.lastIndexOf('}') + 1
        if (start >= 0 && end > start) {
          return { result: JSON.parse(content.slice(start, end)) as LlmConformityResult, provider: provider.name }
        }
      }
    } catch {
      continue
    }
  }
  return null
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

// ─── 메인: 다운로드 + 파싱 + LLM 보강 ───

export async function downloadAndParseCert(
  sessionId: string,
  acptNo: string,
  useLlm = true,
): Promise<CertResult | null> {
  const apiAcceptNo = makeApiAcceptNo(acptNo)
  const buffer = await downloadCertExcel(sessionId, apiAcceptNo)
  if (!buffer) return null

  // 1. 규칙기반 파싱 (갑지 + 적합성검토서 기본)
  let result = await parseCertExcel(buffer)

  if (!useLlm) return result

  // 2. 적합성검토서가 있으면 LLM 구조화 파싱 시도
  if (result.적합성검토) {
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await wb.xlsx.load(buffer as any)
      const confWs = findConformitySheet(wb)
      if (confWs) {
        const text = conformityToStructuredText(confWs)
        console.log(`[cert] LLM 적합성검토서 파싱 (${text.length}자, ~${Math.ceil(text.length / 4)}토큰)`)
        const llmConf = await llmParseConformity(text)
        if (llmConf) {
          const { result: confResult, provider } = llmConf
          // LLM 측정결과로 교체
          const measurements = conformityResultToMeasurements(confResult)
          if (measurements.length > 0) {
            result.측정결과 = measurements
            result.측정포인트수 = measurements.length
            result.전체판정 = measurements.every(m => m.판정 === 'PASS') ? 'PASS' : 'FAIL'
          }
          // LLM 장비정보로 누락 필드 보강
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
          console.log(`[cert] LLM 적합성검토서 파싱 완료: ${measurements.length}포인트 via ${provider}`)
        }
      }
    } catch (err) {
      console.error('[cert] LLM 적합성검토서 파싱 실패 (규칙기반 유지):', err)
    }
  }

  // 3. 적합성검토서가 없고 측정결과도 없으면 을지 LLM 파싱
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
          console.log(`[cert] LLM 을지 파싱 (${calSheets.length}시트, ${text.length}자, ~${Math.ceil(text.length / 4)}토큰)`)
          const llmCal = await llmParseCalibrationResults(text)
          if (llmCal) {
            const { result: calResult, provider } = llmCal
            const measurements = conformityResultToMeasurements(calResult)
            if (measurements.length > 0) {
              result.측정결과 = measurements
              result.측정포인트수 = measurements.length
              // 을지에는 PASS/FAIL이 없으므로 전체판정 null
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
            console.log(`[cert] LLM 을지 파싱 완료: ${measurements.length}포인트 via ${provider}`)
          }
        }
      }
    } catch (err) {
      console.error('[cert] LLM 을지 파싱 실패:', err)
    }
  }

  // 4. 핵심 필드 누락 시 기존 LLM 보강
  result = await llmSupplement(result, buffer)

  return result
}

// spm0907.do 페이지 접근 (API 호출 전제조건)
export async function ensureSpmAccess(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/spm/contents/spm0907.do?cnsnClsIdx=32`, {
    headers: { 'Cookie': `KTOOLS_JSESSIONID=${sessionId}` },
  })
}
