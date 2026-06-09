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
import { llmPool, parseLlmJson } from './llm-worker-pool'

const BASE_URL = 'https://k-tools.ktl.re.kr'

// ─── LLM 설정 ───

const LLM_MISSING_THRESHOLD = 2
const LLM_KEY_FIELDS: (keyof CertResult)[] = ['제조사', '모델', '시리얼', '교정일']


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

const CONFORMITY_SYSTEM_PROMPT = `Parse a calibration conformity review sheet (pipe-delimited rows from PDF→Excel).
Headers may span multiple rows; merged cells may appear empty; column alignment may be imperfect.
Extract equipment info and ALL measurement data. Return JSON:
{
  "equipment": { "manufacturer":str|null, "model":str|null, "serial":str|null, "certNo":str|null, "calDate":"YYYY-MM-DD"|null, "dueDate":"YYYY-MM-DD"|null },
  "measurements": [{ "quantity":"Torque Clockwise", "ref":"2279", "refUnit":"N·cm", "indicated":"2260", "indUnit":"N·cm", "error":"-0.8", "errUnit":"%", "tolerance":"4", "tolUnit":"%", "result":"PASS", "uncertainty":null, "uncUnit":null, "uncK":null }],
  "overall": "PASS"
}

RULES:
1. COLUMNS — Combine multi-row headers vertically. Map by meaning:
   ref=standard/reference, indicated=DUT reading, error=deviation, tolerance=limit, result=PASS/FAIL.
   Korean: 기준값→ref, 지시값→indicated, 허용범위→tolerance, 적합여부→result, "O"=PASS/"X"=FAIL.
   TORQUE WRENCH: "Indicated Torque"=DUT set value(indicated). "Indicated Value of Reference Torque Calibrator"=reference measurement(ref). Do NOT confuse "Indicated" in the reference calibrator column header with DUT indication.
   Equipment: 제조사, 모델, 장비명, 제조사 일련번호, [관리번호], 교정일, 차기교정일, 성적서번호.

2. DUPLICATE UNITS — If same measurement in multiple units (N·cm AND lbf·in), use first only.

3. ERROR —
   a) Explicit error column (e.g. "Relative Accuracy Error (%)")→use directly, do NOT recalculate.
   b) "Correction"/"보정값" is NOT error (opposite sign). If only Correction exists, calculate: error=indicated−ref.
   c) No error column: error=indicated−ref.
      - If errUnit="%" and column header says "% FS" or "%FS"→relative to Full Scale: (indicated−ref)/FullScale×100.
        FullScale = maximum ref value in the group.
      - If errUnit="%" (plain)→relative to ref: (indicated−ref)/ref×100.
   SANITY: error must be small if errUnit="%". If error≈ref or error≈indicated→column mapping bug.

4. TOLERANCE — "±0.5 μm"→tolerance="0.5",tolUnit="μm". Strip ±. Non-numeric text→null.

5. SECTIONS — Include ALL sections (CW/CCW, Temp/Humidity). Use quantity to distinguish.

6. GROUPED VALUES — If error/tolerance/result appear on ONE row for a group, apply to ALL data rows.
   IMPORTANT: Data rows in the group may have EMPTY error/tolerance/result cells. Do NOT fill them
   with measured values from adjacent columns. Only the summary row contains the real error/tolerance/result.
   If a "data row" has the same numeric value in both measured AND error columns, that is a PDF→Excel
   conversion artifact — the error column should be treated as empty.
   Exception: "등급"/"Class"/"Grade" columns are NOT error. Calculate error per row instead.
   Use Class value as tolerance (e.g. Class 1→tolerance="1",tolUnit="% FS").

7. DATA ROWS — Skip ref=0.0/indicated=0.0 with "-". Skip sections with "#DIV/0!".

8. quantity: English (Torque, Temperature, etc). uncK is number, others are strings. null for missing.
   overall: "PASS" only if ALL passed. Uncertainty: extract if column exists, else null.

EXAMPLES:
Ex1 — Explicit error column:
  Indicated(N·cm)|(lbf·in)|Ref Calibrator(N·cm)|(lbf·in)|Accuracy Error(%)|Tolerance(±%)|Conformity
  2260|1586.8|2279|1600.2|-0.8|4|PASS
→ indicated=2260,ref=2279,error=-0.8(%),tolerance=4(%),result=PASS. Skip lbf·in.

Ex2 — No error column:
  Nominal(μm)|Measured(μm)|Tolerance(μm)|Conformity
  24.3|24.3|0.5|PASS → error=0.0(calculated)

Ex3 — Correction(보정값), NOT error:
  Reference(°C)|Indication(°C)|Correction(°C)|Tolerance|Suitability
  15.1|15.0|0.1|Refer to attached|Pass
→ error=-0.1(calculated:15.0−15.1). tolerance=null(non-numeric). Do NOT use Correction.

Ex4 — Grouped values:
  Ref(N·m)|Measured Avg(N·m)|Rel.accuracy err(%FS)|Specs(±%FS)|Conformity
  0.0|0.0000|-|-|-
  0.1|0.1012| | |
  0.5|0.5022| | |
  | |0.37|0.50|PASS
→ ALL rows share error=0.37,tolerance=0.50,result=PASS. Skip 0.0 row.

Ex5 — Class/Grade (NOT error):
  지시토크(N·m)|측정값평균(N·m)|등급(FS대비)|제조사사양허용등급(FS대비)|적합여부
  0.1|0.1006| | |
  0.5|0.5010| | |
  | |1|1|PASS
→ 등급=Class→tolerance="1",tolUnit="% FS". CALCULATE error per row: (0.1006−0.1)/0.1×100=0.60%.

Ex6 — Korean format:
  제조사|GE DRUCK|모델|ADTS542F|교정일|2023-03-17|차기교정일|2024-03-16
  기준값(kPa)|지시값(kPa)|보정값(kPa)|Spec Accuracy|허용범위(±)|적합여부(O,X)
  2.1340|2.134|0.000|0.2%RDG|0.0043|O
→ error=2.134−2.1340(calculated). tolerance="0.0043". "O"→PASS.`

// ─── 을지(교정 측정결과) LLM 파싱 프롬프트 ───

const CALIBRATION_RESULTS_SYSTEM_PROMPT = `Parse calibration measurement results (을지, pipe-delimited from PDF→Excel).
Multiple sheets may be concatenated with "=== Page N ===" separators.
tolerance=null, tolUnit=null, result=null, overall=null for ALL rows (no conformity in 을지).

Return JSON:
{
  "equipment": { "manufacturer":str|null, "model":str|null, "serial":str|null, "certNo":str|null, "calDate":"YYYY-MM-DD"|null, "dueDate":"YYYY-MM-DD"|null },
  "measurements": [{ "quantity":"Torque Clockwise", "ref":"0.1", "refUnit":"N·m", "indicated":"0.1012", "indUnit":"N·m", "error":"0.69", "errUnit":"%", "tolerance":null, "tolUnit":null, "result":null, "uncertainty":"0.86", "uncUnit":"%", "uncK":2 }],
  "overall": null
}

RULES:
1. COLUMNS — Combine multi-row headers. Map: ref=Reference/기준값, indicated=Indication/지시값.
   TORQUE WRENCH: "Indicated Torque"=DUT set value(indicated). "Indicated Value of Reference Torque Calibrator"=reference measurement(ref). Do NOT confuse "Indicated" in the reference calibrator column header with DUT indication.
   Multiple error columns may exist (Reproducibility, Interpolation, Zero, etc.)→use FIRST one.
   "Correction"/"보정값" is NOT error. Class/Grade→ignore.

2. SECTIONS — CW/CCW, 시계/반시계, Temperature/Humidity→use as quantity prefix.

3. INDICATION PRIORITY — Average>Increasing>single column.

4. ERROR — Use FIRST relative error column directly. Do NOT recalculate.

5. UNCERTAINTY — Headers: "Measurement uncertainty","불확도","U(k=2)". NOT the same as error.
   Extract: uncertainty=U value(string), uncUnit=unit, uncK=k(number, default 2). Null if no column.

6. Skip ref=0.0 rows with "-". Skip sections with "#DIV/0!".
   Numbers are strings (except uncK=number). null for missing.

EXAMPLES:
Ex1 — Torque (Increasing/Decreasing + Uncertainty):
  Ref Torque(N·m)|Increasing|Decreasing|Meas.Uncertainty(%)|Rel.error(%)|Repro(%)|Zero(%)|Rev(%)|Class
  0.0|0.0000|0.0001|-|-|-|-|-|-
  0.1|0.1012|0.1014|0.86|0.69|0.36|0.02|0.20|1
→ ref=0.1,indicated=0.1012(Increasing),error=0.69(%),uncertainty=0.86(%),uncK=2. Skip 0.0.

Ex2 — Torque wrench (Average + Uncertainty):
  Indicated Torque(N·m)|Indicated Value of Reference Torque Calibrator 1Run|2Run|3Run|Average|Relative Accuracy Error(%)|Meas.Uncertainty(%)
  56.5|54.06|53.89|53.84|53.93|4.8|1.0
→ indicated=56.5(Indicated Torque=DUT setting),ref=53.93(Reference Calibrator Average),error=4.8,uncertainty=1.0,uncK=2.
  IMPORTANT: "Indicated Torque" is the DUT's set/nominal value (지시값). "Indicated Value of Reference Torque Calibrator" is the reference measurement (기준값). Do NOT swap them.

Ex3 — Tesla Meter:
  Range|RefValue(mT)|Indication(mT)|Deviation(mT)|Meas.uncertainty(mT, k=2)
  30mT|+16.00|+16.10|0.10|0.10
→ ref=16.00,indicated=16.10,error=0.10(mT),uncertainty=0.10(mT),uncK=2.`

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
    uncertainty?: string | null
    uncUnit?: string | null
    uncK?: number | null
  }>
  overall?: string | null
}

async function llmParseConformity(
  conformityText: string,
): Promise<{ result: LlmConformityResult; provider: string } | null> {
  // 텍스트가 너무 길면 LLM 응답이 잘림 — 12,000자 제한
  const trimmed = conformityText.length > 12000
    ? conformityText.slice(0, 12000) + '\n... (truncated)'
    : conformityText
  const prompt = `Parse the following conformity review sheet data:\n\n${trimmed}`

  try {
    const { content, model, elapsed } = await llmPool.submit(prompt, CONFORMITY_SYSTEM_PROMPT, 8000)
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
  // 을지 텍스트가 너무 길면 입력 토큰 폭증 → TPM 초과 + 응답 잘림
  const trimmed = text.length > 12000
    ? text.slice(0, 12000) + '\n... (truncated)'
    : text
  const prompt = `Parse the following calibration measurement results data:\n\n${trimmed}`

  try {
    const { content, model, elapsed } = await llmPool.submit(prompt, CALIBRATION_RESULTS_SYSTEM_PROMPT, 8000)
    const parsed = parseLlmJson<LlmConformityResult>(content)
    const sample = parsed.measurements?.[0]
    if (sample) {
      console.log(`[pool] 을지 → ${model} ${(elapsed / 1000).toFixed(1)}s | 샘플: ref=${sample.ref} ind=${sample.indicated} err=${sample.error}(${sample.errUnit}) tol=${sample.tolerance}(${sample.tolUnit}) U=${sample.uncertainty}(${sample.uncUnit})`)
    } else {
      console.log(`[pool] 을지 → ${model} ${(elapsed / 1000).toFixed(1)}s | 측정포인트 0개`)
    }
    return { result: parsed, provider: model }
  } catch (err) {
    console.error('[pool] 을지 실패:', err instanceof Error ? err.message : err)
    return null
  }
}

// 을지 불확도 → 적합성검토서 측정포인트에 병합
// 3단계 매칭: 1) 기준값 정확매칭 2) 지시값 매칭 3) 인덱스 순서 매칭
function mergeUncertainty(
  confPoints: MeasurementPoint[],
  calPoints: MeasurementPoint[],
): void {
  const normalizeNum = (v: string | number | null | undefined): string => {
    if (v == null || v === '') return ''
    if (typeof v === 'number') return isNaN(v) ? '' : String(v)
    return String(parseFloat(v.replace(/[±<>+\s]/g, '').replace(',', '')))
  }

  // 을지에서 불확도 있는 포인트만 추출
  const calWithUnc = calPoints.filter(c => c.불확도)
  if (calWithUnc.length === 0) return

  const usedCalIdx = new Set<number>()

  // Pass 1: 기준값 + 물리량 정확 매칭
  for (const conf of confPoints) {
    if (conf.불확도) continue
    const confRef = normalizeNum(conf.기준값)
    if (!confRef) continue
    const idx = calWithUnc.findIndex((cal, i) =>
      !usedCalIdx.has(i) &&
      normalizeNum(cal.기준값) === confRef &&
      (cal.물리량 || '') === (conf.물리량 || ''),
    )
    if (idx >= 0) {
      conf.불확도 = calWithUnc[idx].불확도
      conf.불확도단위 = calWithUnc[idx].불확도단위
      conf.불확도k = calWithUnc[idx].불확도k
      usedCalIdx.add(idx)
    }
  }

  // Pass 2: 지시값 매칭 (을지 indicated ↔ 적합성검토서 indicated 또는 ref)
  for (const conf of confPoints) {
    if (conf.불확도) continue
    const confInd = normalizeNum(conf.지시값)
    const confRef = normalizeNum(conf.기준값)
    if (!confInd && !confRef) continue
    const idx = calWithUnc.findIndex((cal, i) => {
      if (usedCalIdx.has(i)) return false
      if ((cal.물리량 || '') !== (conf.물리량 || '')) return false
      const calInd = normalizeNum(cal.지시값)
      const calRef = normalizeNum(cal.기준값)
      // 을지 지시값 = 적합성검토서 지시값 or 기준값
      return (confInd && calInd && calInd === confInd) ||
             (confInd && calRef && calRef === confInd) ||
             (confRef && calInd && calInd === confRef)
    })
    if (idx >= 0) {
      conf.불확도 = calWithUnc[idx].불확도
      conf.불확도단위 = calWithUnc[idx].불확도단위
      conf.불확도k = calWithUnc[idx].불확도k
      usedCalIdx.add(idx)
    }
  }

  // Pass 3: 같은 물리량 내 인덱스 순서 매칭 (아직 매칭 안 된 것)
  // 물리량 정규화: "Torque Clockwise"→"torque cw", "Torque CW"→"torque cw" 등
  const normalizeQuantity = (q: string | null | undefined): string => {
    if (!q) return ''
    let s = q.toLowerCase().trim()
    s = s.replace(/\bclockwise\b/g, 'cw').replace(/\bcounterclockwise\b/g, 'ccw')
    s = s.replace(/\b시계\s*방향\b/g, 'cw').replace(/\b반시계\s*방향\b/g, 'ccw')
    s = s.replace(/\b시계\b/g, 'cw').replace(/\b반시계\b/g, 'ccw')
    return s
  }
  const quantityGroups = new Map<string, { confIdx: number[]; calIdx: number[] }>()
  confPoints.forEach((conf, ci) => {
    if (conf.불확도) return
    const q = normalizeQuantity(conf.물리량)
    if (!quantityGroups.has(q)) quantityGroups.set(q, { confIdx: [], calIdx: [] })
    quantityGroups.get(q)!.confIdx.push(ci)
  })
  calWithUnc.forEach((cal, ci) => {
    if (usedCalIdx.has(ci)) return
    const q = normalizeQuantity(cal.물리량)
    if (!quantityGroups.has(q)) quantityGroups.set(q, { confIdx: [], calIdx: [] })
    quantityGroups.get(q)!.calIdx.push(ci)
  })
  for (const { confIdx, calIdx } of quantityGroups.values()) {
    const len = Math.min(confIdx.length, calIdx.length)
    for (let i = 0; i < len; i++) {
      const conf = confPoints[confIdx[i]]
      const cal = calWithUnc[calIdx[i]]
      conf.불확도 = cal.불확도
      conf.불확도단위 = cal.불확도단위
      conf.불확도k = cal.불확도k
      usedCalIdx.add(calWithUnc.indexOf(cal))
    }
  }

  // Pass 4: 물리량 무시 폴백 — 아직 불확도 없는 포인트에 남은 을지 데이터를 순서대로 매칭
  const unmatchedConf = confPoints.filter(c => !c.불확도)
  const unmatchedCal = calWithUnc.filter((_, i) => !usedCalIdx.has(i))
  if (unmatchedConf.length > 0 && unmatchedCal.length > 0) {
    const len = Math.min(unmatchedConf.length, unmatchedCal.length)
    for (let i = 0; i < len; i++) {
      unmatchedConf[i].불확도 = unmatchedCal[i].불확도
      unmatchedConf[i].불확도단위 = unmatchedCal[i].불확도단위
      unmatchedConf[i].불확도k = unmatchedCal[i].불확도k
    }
  }
}

// LLM이 숫자/문자열 혼용으로 반환 가능 → 문자열로 정규화
function toStr(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return isNaN(v) ? null : String(v)
  return String(v)
}

function conformityResultToMeasurements(
  llm: LlmConformityResult,
): MeasurementPoint[] {
  return (llm.measurements || []).map(m => {
    const ref = toStr(m.ref)
    const refUnit = toStr(m.refUnit)
    const indicated = toStr(m.indicated)
    const indUnit = toStr(m.indUnit)
    const error = toStr(m.error)
    const errUnit = toStr(m.errUnit)
    const tolerance = toStr(m.tolerance)
    const tolUnit = toStr(m.tolUnit)
    const quantity = toStr(m.quantity)
    const uncertainty = toStr(m.uncertainty)
    const uncUnit = toStr(m.uncUnit)
    const result = toStr(m.result)
    return {
      // 기존 필드 (하위호환)
      원본데이터: [ref, refUnit, indicated, indUnit, error, tolerance, result]
        .filter((v): v is string => v != null && v !== ''),
      숫자값: [ref, indicated, error, tolerance]
        .map(v => v ? parseFloat(v.replace(/[±<>]/g, '').replace(/\s/g, '').replace(',', '')) : NaN)
        .filter(n => !isNaN(n)),
      판정: (result?.toUpperCase() === 'FAIL' ? 'FAIL' : 'PASS') as 'PASS' | 'FAIL',
      셀: [],
      // LLM 구조화 필드
      기준값: ref,
      기준단위: refUnit,
      지시값: indicated,
      지시단위: indUnit,
      오차: error,
      오차단위: errUnit,
      허용오차: tolerance,
      허용오차단위: tolUnit,
      물리량: quantity,
      // 측정불확도 (ISO 10012 §7.3.1)
      불확도: uncertainty,
      불확도단위: uncUnit,
      불확도k: typeof m.uncK === 'number' ? m.uncK : (m.uncK ? parseFloat(String(m.uncK)) || null : null),
    }
  })
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

  // ExcelJS 워크북 1회 로드 (적합성검토서 + 을지 공유)
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any)

    // 적합성검토서 / 을지 시트 탐색
    const confWs = result.적합성검토 ? findConformitySheet(wb) : null
    const calSheets = findCalibrationResultSheets(wb)
    const calText = calSheets.length > 0 ? calibrationResultsToText(calSheets) : ''

    // 1. 적합성검토서 + 을지 LLM 호출을 병렬 실행
    const confPromise = confWs
      ? llmParseConformity(conformityToStructuredText(confWs))
      : Promise.resolve(null)
    const calPromise = calText.trim()
      ? llmParseCalibrationResults(calText)
      : Promise.resolve(null)

    const [llmConf, llmCal] = await Promise.all([confPromise, calPromise])

    // 2. 적합성검토서 결과 적용
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

    // 3. 을지 결과 적용
    if (llmCal) {
      const { result: calResult, provider } = llmCal
      const calMeasurements = conformityResultToMeasurements(calResult)

      if (result.측정포인트수 === 0) {
        // 적합성검토서 없음 → 을지가 주 데이터원
        if (calMeasurements.length > 0) {
          result.측정결과 = calMeasurements
          result.측정포인트수 = calMeasurements.length
          result.전체판정 = null
        }
      } else {
        // 적합성검토서 있음 → 불확도만 병합
        mergeUncertainty(result.측정결과, calMeasurements)
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
      if (!result._llm_provider) result._llm_provider = provider
      result.을지파싱 = true
      const uncCount = calMeasurements.filter(m => m.불확도).length
      console.log(`${tag} 을지 → ${provider} | ${calMeasurements.length}포인트 | 불확도 ${uncCount}건`)
    }
  } catch (err) {
    console.error(`${tag} LLM 파싱 실패 (규칙기반 유지):`, err)
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