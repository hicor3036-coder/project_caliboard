// 교정성적서 Excel 파싱 (Python ktools_성적서.py → TypeScript 포팅)
//
// === 교정성적서 구조 ===
// - 갑지 (Page 1): 표지. 장비 기본 정보 (성적서번호, 고객명, 장비명, 제조사/모델, 시리얼 등)
// - 을지 (Page 2~): 교정 측정 결과. 비정형 데이터라 규칙기반 파싱 불가 → LLM에 위임
// - 적합성검토서 (마지막 페이지, 선택): Conformity Review. 장비정보 + PASS/FAIL 측정 결과
//
// ※ 셀 위치가 고정이 아님 — PDF→Excel 변환기에 의해 결정
// ※ 라벨(영문) 기반으로 값을 찾는 방식 → 100% 정확할 필요 없음 (LLM fallback이 보완)
// ※ exceljs를 동적 import (Turbopack junction point 에러 회피)

import type { CertResult, MeasurementPoint, ReferenceStandard } from './cert-cache'

import ExcelJS from 'exceljs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workbook = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Worksheet = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CellValue = any

// 갑지 파싱 시 영문 라벨이 값으로 잘못 추출되는 케이스 필터
const BAD_VALUES = new Set([
  'Serial Number', 'The due date', 'Manufacturer', 'Model',
  'Description', 'Date of Calibration', 'Certificate No',
  'Identification Number', 'Client', 'Name',
])

// 적합성검토서 헤더 영역의 라벨들
const HEADER_LABELS = new Set([
  'Manufacturer', 'Model', 'Description', 'Serial Number',
  'Certificate No.', 'Certificate No', 'Identification', 'Number',
  'Identification Number', 'Date of Calibration', 'Due date',
  // 한국어 라벨
  '제조사', '모델', '장비명', '제조사 일련번호', '관리번호',
  '성적서번호', '교정일', '차기교정일', '작성자', '대상기기',
])

function cellStr(value: CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

// 한글/영문 혼합 날짜 → YYYY-MM-DD 정규화
// "2024년 01월 29일" → "2024-01-29"
// "12 February 2025" → "2025-02-12"
// "2024-01-29" → 그대로
const MONTH_MAP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null
  const s = raw.trim()

  // 이미 YYYY-MM-DD 형식
  const isoMatch = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`

  // YYYY. MM. DD 또는 YYYY.MM.DD
  const dotMatch = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/)
  if (dotMatch) return `${dotMatch[1]}-${dotMatch[2].padStart(2, '0')}-${dotMatch[3].padStart(2, '0')}`

  // 한글: "2024년 01월 29일"
  const krMatch = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (krMatch) return `${krMatch[1]}-${krMatch[2].padStart(2, '0')}-${krMatch[3].padStart(2, '0')}`

  // 영문: "12 February 2025" 또는 "February 12, 2025"
  const enMatch1 = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (enMatch1) {
    const m = MONTH_MAP[enMatch1[2].toLowerCase()]
    if (m) return `${enMatch1[3]}-${m}-${enMatch1[1].padStart(2, '0')}`
  }
  const enMatch2 = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  if (enMatch2) {
    const m = MONTH_MAP[enMatch2[1].toLowerCase()]
    if (m) return `${enMatch2[3]}-${m}-${enMatch2[2].padStart(2, '0')}`
  }

  // YYYYMMDD
  const compactMatch = s.match(/(\d{4})(\d{2})(\d{2})/)
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`

  return null
}

// 셀 값에서 날짜 부분만 추출 (라벨+날짜 합쳐진 경우)
function extractDateFromCell(val: string): string | null {
  // 콜론이 있으면 콜론 뒤를 사용
  if (val.includes(':')) {
    const afterColon = val.split(':').pop()!.trim()
    const d = normalizeDate(afterColon)
    if (d) return d
  }
  // 전체 문자열에서 날짜 패턴 추출 시도
  return normalizeDate(val)
}

// ─── 적합성검토서 시트 찾기 ───
export function findConformitySheet(wb: Workbook): Worksheet | null {
  const sheets = wb.worksheets
  for (let i = sheets.length - 1; i >= 0; i--) {
    const ws = sheets[i]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.eachRow((row: any, rowNum: number) => {
      if (rowNum > 3) return
      const joined = row.values
        ? (row.values as CellValue[]).filter((v: CellValue) => v != null).map((v: CellValue) => cellStr(v)).join(' ').toUpperCase()
        : ''
      if (joined.includes('CONFORMITY') || joined.includes('적합성')) {
        ;(ws as unknown as { _isConformity: boolean })._isConformity = true
      }
    })
    if ((ws as unknown as { _isConformity?: boolean })._isConformity) {
      return ws
    }
  }
  return null
}

// ─── 을지 시트 찾기 (적합성검토서, 갑지 제외한 나머지) ───
export function findCalibrationResultSheets(wb: Workbook): Worksheet[] {
  const confWs = findConformitySheet(wb)
  const confName = confWs?.name
  const coverWs = wb.getWorksheet('Page 1') ?? wb.worksheets[0]
  const coverName = coverWs?.name

  return wb.worksheets.filter((ws: Worksheet) => {
    if (ws.name === confName || ws.name === coverName) return false
    return true
  })
}

// ─── 을지 시트들 → 구조화 텍스트 (셀 병합 전파, 합산) ───
export function calibrationResultsToText(sheets: Worksheet[]): string {
  const parts: string[] = []
  for (const ws of sheets) {
    const text = conformityToStructuredText(ws)
    if (text.trim()) {
      parts.push(`=== ${ws.name} ===\n${text}`)
    }
  }
  return parts.join('\n\n')
}

// ─── 갑지 (Page 1) 파싱 ───
interface CoverParseResult {
  info: Record<string, string>
  기준기: ReferenceStandard[]
}

function parseCover(wb: Workbook): CoverParseResult {
  const info: Record<string, string> = {}
  const standards: ReferenceStandard[] = []
  const ws = wb.getWorksheet('Page 1') ?? wb.worksheets[0]
  if (!ws) return { info, 기준기: standards }

  // 모든 셀을 (행, 열) → 값 딕셔너리로 변환
  // ※ ExcelJS는 병합 셀의 slave에도 master 값을 전파 → master 셀만 저장
  const cells = new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow((row: any, rowNum: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell((cell: any, colNum: number) => {
      // 병합된 slave 셀은 건너뛰기 (master에 실제 값이 있음)
      if (cell.isMerged && cell.master && cell.master !== cell) {
        return
      }
      const val = cellStr(cell.value)
      if (val) cells.set(`${rowNum},${colNum}`, val)
    })
  })

  const getCell = (r: number, c: number) => cells.get(`${r},${c}`) || ''

  // 한 행의 모든 셀 텍스트를 합쳐서 반환
  const getRowText = (r: number) => {
    const parts: string[] = []
    for (let c = 1; c <= 12; c++) {
      const v = getCell(r, c)
      if (v) parts.push(v)
    }
    return parts.join(' ')
  }

  let foundClient = false
  const sortedEntries = [...cells.entries()].sort((a, b) => {
    const [ar, ac] = a[0].split(',').map(Number)
    const [br, bc] = b[0].split(',').map(Number)
    return ar !== br ? ar - br : ac - bc
  })

  // ─── 메인 라벨 탐색 루프 ───
  for (const [key, val] of sortedEntries) {
    const [r, c] = key.split(',').map(Number)

    // 성적서번호
    if (val.includes('Certificate No') && val.includes(':')) {
      info['성적서번호'] = val.split(':').pop()!.trim()
    } else if (val.includes('성적서 번호') && val.includes(':')) {
      info['성적서번호'] = val.split(':').pop()!.trim()
    }

    // Client 섹션 감지
    if (val.includes('Client')) {
      foundClient = true
    }

    // 고객명
    if (foundClient && val.includes('Name') && !val.includes('Model') && val.includes(':')) {
      const nameVal = getCell(r, c + 2) || getCell(r, c + 1)
      if (nameVal && !info['고객명']) {
        info['고객명'] = nameVal
      }
      foundClient = false
    }

    // 장비명
    if (val.includes('Description') && val.includes(':')) {
      const descVal = getCell(r, c + 2) || getCell(r, c + 1)
      if (descVal && !info['장비명']) {
        info['장비명'] = descVal
      }
    }

    // 제조사/모델
    if (val.includes('Manufacturer and Model') || val.includes('제작회사 및 형식')) {
      const modelVal = getCell(r, c + 4) || getCell(r, c + 3) || getCell(r, c + 2) || getCell(r, c + 1)
      if (modelVal) {
        const parts = modelVal.split('/')
        info['제조사'] = parts[0].trim()
        info['모델'] = parts.length > 1 ? parts[1].trim() : ''
      }
    }

    // 시리얼
    if (val.startsWith('Serial Number') || val.includes('기기번호') || val.startsWith('시리얼') || val.includes('일련번호')) {
      const snVal = getCell(r, c + 2) || getCell(r, c + 1)
      if (snVal && !info['시리얼']) {
        info['시리얼'] = snVal.split('[')[0].trim()
        if (snVal.includes('[')) {
          info['관리번호'] = snVal.split(':').pop()!.trim().replace(']', '')
        }
      }
    }

    // 교정일
    if (val.includes('Date of Calibration') || val.includes('교정일자') || val.includes('교 정 일 자')) {
      if (!info['교정일']) {
        const fromSelf = extractDateFromCell(val)
        if (fromSelf) {
          info['교정일'] = fromSelf
        } else {
          const dateVal = getCell(r, c + 3) || getCell(r, c + 2) || getCell(r, c + 1)
          if (dateVal) {
            const normalized = extractDateFromCell(dateVal)
            info['교정일'] = normalized || dateVal.trim()
          }
        }
      }
    }

    // 차기교정일
    if (val.includes('due date') || val.includes('Due date') || val.includes('차기교정') || val.includes('유효기간')) {
      if (!info['차기교정일']) {
        const fromSelf = extractDateFromCell(val)
        if (fromSelf) {
          info['차기교정일'] = fromSelf
        } else {
          const dateVal = getCell(r, c + 3) || getCell(r, c + 2) || getCell(r, c + 1)
          if (dateVal) {
            const normalized = extractDateFromCell(dateVal)
            // 날짜로 파싱 가능한 경우만 할당 (기준기 테이블 헤더의 "교정기관" 등 오인 방지)
            if (normalized) {
              info['차기교정일'] = normalized
            } else if (/\d/.test(dateVal)) {
              info['차기교정일'] = dateVal.trim()
            }
          }
        }
      }
    }

    // ─── 환경조건: 온도 ───
    if ((val.includes('Temperature') || val.includes('온도') || val.includes('온 도')) && r >= 15 && r <= 22 && !info['온도']) {
      // 같은 셀에 값 포함 (한/영 혼용 서식)
      const tempMatch = val.match(/\([^)]*℃\)|\([^)]*°C\)|\(\s*[\d.]+\s*[±+-]\s*[\d.]+\s*\)\s*℃/)
      if (tempMatch) {
        info['온도'] = tempMatch[0]
      } else {
        // 우측 셀 탐색
        for (let dc = 1; dc <= 4; dc++) {
          const v = getCell(r, c + dc)
          if (v && (v.includes('℃') || v.includes('°C'))) {
            info['온도'] = v.trim()
            break
          }
        }
      }
    }

    // ─── 환경조건: 습도 ───
    if ((val.includes('Humidity') || val.includes('습도') || val.includes('습 도')) && r >= 15 && r <= 22 && !info['습도']) {
      // 같은 셀에 값 포함: "습 도 ( Humidity ) : (47 ± 1) % R.H." → 괄호+% 패턴 추출
      const humMatch = val.match(/\(\s*[\d.]+\s*[±+-]\s*[\d.]+\s*\)\s*%\s*R\.?H\.?/)
      if (humMatch) {
        info['습도'] = humMatch[0].trim()
      } else {
        // 우측 셀에서 찾기
        for (let dc = 1; dc <= 4; dc++) {
          const v = getCell(r, c + dc)
          if (v && (v.includes('R.H') || v.includes('% R'))) {
            info['습도'] = v.trim()
            break
          }
        }
      }
    }

    // ─── 환경조건: 교정장소 ───
    if ((val.includes('Location') || val.includes('교정장소')) && r >= 15 && r <= 22 && !info['교정장소']) {
      // ▣ 체크된 항목 찾기 (같은 행 전체 스캔)
      const rowText = getRowText(r)
      if (rowText.includes('▣')) {
        const checked = rowText.match(/▣\s*([^□▣]+)/)
        if (checked) {
          // "▣ KTL Lab." 또는 "▣ 고정표준실 (KTL Lab.)" → 깔끔하게 추출
          let loc = checked[1].trim()
          // 괄호 안 영문 추출 (한/영 혼용 서식)
          const paren = loc.match(/\(([^)]+)\)/)
          if (paren) loc = paren[1].trim()
          info['교정장소'] = loc
        }
      }
    }

    // ─── 교정자/승인자 ───
    // "Measurements performed by" / "작성자" 행의 열 위치를 기록
    if ((val.includes('performed by') || val.includes('작성자')) && r >= 35 && !info['_performerCol']) {
      info['_performerCol'] = String(c)
      info['_performerRow'] = String(r)
    }
    if ((val.includes('Approved by') || val.includes('승인자')) && r >= 35 && !info['_approverCol']) {
      info['_approverCol'] = String(c)
      info['_approverRow'] = String(r)
    }

    // 승인자 직위: "Technical Supervisor" / "기술책임자"
    if ((val.includes('Supervisor') || val.includes('책임자') || val.includes('Manager')) && r >= 35 && !info['승인자직위']) {
      info['승인자직위'] = val.trim()
    }
  }

  // ─── 교정자/승인자 이름 추출 (Name/성명 행에서) ───
  // 병합 셀이 있으므로 Name 라벨과 **다른 값**인 셀을 우측으로 탐색
  const performerCol = parseInt(info['_performerCol'] || '0')
  const approverCol = parseInt(info['_approverCol'] || '0')
  if (performerCol > 0 || approverCol > 0) {
    for (const [key, val] of sortedEntries) {
      const [r, c] = key.split(',').map(Number)
      if (r < 35 || r > 48) continue
      if (val.includes('Name') || val.includes('성명') || val.includes('성  명')) {
        // Name 라벨 우측에서 **라벨과 다른 값**인 셀을 찾기 (병합 셀 대응)
        let nameVal = ''
        for (let dc = 1; dc <= 6; dc++) {
          const v = getCell(r, c + dc)
          if (v && !v.includes('Name') && !v.includes('성명') && !v.includes('성  명') && !v.includes(':')) {
            nameVal = v.trim()
            break
          }
        }
        if (!nameVal || nameVal.length < 2) continue

        // performer 영역(왼쪽)인지 approver 영역(오른쪽)인지 판단
        if (approverCol > 0 && c >= approverCol && !info['승인자']) {
          info['승인자'] = nameVal
        } else if (performerCol > 0 && c < (approverCol || 99) && !info['교정자']) {
          info['교정자'] = nameVal
        }
      }
    }
  }
  // 임시 키 제거
  delete info['_performerCol']; delete info['_performerRow']
  delete info['_approverCol']; delete info['_approverRow']

  // ─── 소급성: 교정방법 + 기술지원코드 (Row 20~28) ───
  // PDF→Excel 변환 시 셀 병합 해제로 같은 텍스트가 12개 열에 복사됨.
  // 또한 긴 문장이 행 단위로 잘림 (Row 23: 본문 앞부분, Row 24: 나머지).
  // → 각 행에서 C1만 대표로 취하고, 연속 행을 이어붙여 완전한 문장 복원.
  const traceRows: { row: number; text: string }[] = []
  const traceKeywords = ['CP801', '교정업무기준', 'calibration work standard', 'calibrated as per', '에 따라']
  for (let r = 20; r <= 28; r++) {
    const t = getCell(r, 1).replace(/\s+/g, ' ').trim()
    if (t && traceKeywords.some(kw => t.includes(kw))) {
      traceRows.push({ row: r, text: t })
    }
  }
  // 키워드 매칭된 행의 뒤 행이 잘린 나머지인지 확인 (키워드 없지만 연속 행)
  if (traceRows.length > 0) {
    const lastMatchRow = traceRows[traceRows.length - 1].row
    for (let r = lastMatchRow + 1; r <= 28; r++) {
      const t = getCell(r, 1).replace(/\s+/g, ' ').trim()
      // 짧은 텍스트 + 라벨/헤더가 아님 → 잘린 나머지로 판단
      if (t && t.length < 60 && !t.includes('List of') && !t.includes('교정에 사용한') &&
          !t.includes('Description') && !t.includes('Manufacturer') && !t.includes('기기명')) {
        traceRows.push({ row: r, text: t })
      } else break
    }
  }
  if (traceRows.length > 0) {
    // 행들을 직접 이어붙임 (PDF 행 분할로 단어/어절 중간에서 잘림)
    const combined = traceRows.map(r => r.text).join('')
    info['교정방법'] = combined
    // 기술지원코드: (CP801-40508-1) → 전체 + 숫자만
    const cpMatch = info['교정방법'].match(/\(?(CP801-(\d+)-\d+)\)?/)
    if (cpMatch) {
      info['기술지원코드원본'] = cpMatch[1]
      info['기술지원코드'] = cpMatch[2]
    }
  }

  // ─── 기준기 목록 파싱 (Row 25~부터 동적) ───
  // Step A: 헤더 영역(Row 25~28)에서 기준기 테이블 존재 여부 확인
  let hasRefTable = false
  let refHeaderEndRow = 28 // 기본값

  for (const [key, val] of sortedEntries) {
    const [r] = key.split(',').map(Number)
    if (r < 25 || r > 28) continue
    const v = val.toLowerCase()
    if (v.includes('description') || v.includes('기기명') || v.includes('manufacturer') ||
        v.includes('제작회사') || v.includes('serial') || v.includes('기기번호') ||
        v.includes('laboratory') || v.includes('교정기관')) {
      hasRefTable = true
      refHeaderEndRow = Math.max(refHeaderEndRow, r)
    }
  }

  // Step B: 기준기 테이블 파싱 — 헤더 의미론적 매핑 + 데이터 행 보정
  // 테이블 5컬럼: 장비명(Description), 제조사/모델(Manufacturer/Model), S/N, 유효일(Due date), 교정기관(Laboratory)
  // ※ cells Map이 master-only이므로, 각 셀 위치에 해당 값만 존재
  //
  // 실제 패턴 (test 폴더 7개 성적서 분석 결과):
  //   - 헤더 "Description"은 col2에 있지만 데이터는 col1부터 시작 (병합 범위 col1:col3)
  //   - 컬럼 위치는 파일마다 다름 (col 3~13 범위에서 변동)
  //   - 일부 파일에서 장비명이 길어 데이터가 2행에 걸쳐 분할됨
  if (hasRefTable) {
    // Step B-1: 헤더에서 의미론적 키워드로 컬럼 타입별 master col 찾기
    // 같은 타입이 여러 행에 있으면 (한글/영문 동시) 가장 작은 col을 사용
    type ColType = 'desc' | 'mfr' | 'sn' | 'date' | 'lab'
    const foundAll: { type: ColType; col: number }[] = []

    for (let r = 25; r <= refHeaderEndRow; r++) {
      for (let c = 1; c <= 14; c++) {
        const v = getCell(r, c)
        if (!v) continue
        const vl = v.toLowerCase()

        if (vl.includes('description') || vl.includes('기기명'))
          foundAll.push({ type: 'desc', col: c })
        else if (vl.includes('manufacturer') || vl.includes('제작회사'))
          foundAll.push({ type: 'mfr', col: c })
        else if (vl.includes('serial') || vl.includes('기기번호'))
          foundAll.push({ type: 'sn', col: c })
        else if (vl.includes('due date') || vl.includes('차기교정') || vl.includes('유효'))
          foundAll.push({ type: 'date', col: c })
        else if (vl.includes('calibration laboratory') || vl.includes('교정기관'))
          foundAll.push({ type: 'lab', col: c })
      }
    }

    // 각 타입별 가장 작은 col을 선택 (한글 col10 vs 영문 col9 → col9 사용)
    const found: { type: ColType; col: number }[] = []
    for (const type of ['desc', 'mfr', 'sn', 'date', 'lab'] as ColType[]) {
      const matches = foundAll.filter(f => f.type === type)
      if (matches.length > 0) {
        const minCol = Math.min(...matches.map(m => m.col))
        found.push({ type, col: minCol })
      }
    }

    // Step B-2: 각 컬럼의 시작 col 결정
    const colOf = (t: ColType) => found.find(f => f.type === t)?.col ?? 0
    const mfrCol = colOf('mfr')
    const snCol = colOf('sn')
    const dateCol = colOf('date')
    const labCol = colOf('lab')
    // 장비명은 항상 col1 (헤더에서 col2에 있어도 데이터는 col1:col3 병합)
    const descCol = 1

    // 5컬럼 위치를 순서대로 정렬
    const colOrder = [
      { type: 'desc' as ColType, col: descCol },
      { type: 'mfr' as ColType, col: mfrCol },
      { type: 'sn' as ColType, col: snCol },
      { type: 'date' as ColType, col: dateCol },
      { type: 'lab' as ColType, col: labCol },
    ].filter(c => c.col > 0).sort((a, b) => a.col - b.col)

    // 각 컬럼의 범위: [시작col, 다음컬럼 시작col) — 마지막은 col14까지
    const colRange = (type: ColType): [number, number] => {
      const idx = colOrder.findIndex(c => c.type === type)
      if (idx < 0) return [0, 0]
      const start = colOrder[idx].col
      const end = idx + 1 < colOrder.length ? colOrder[idx + 1].col : 14
      return [start, end]
    }

    // 범위 내 첫 번째 비빈 값을 반환
    const getVal = (r: number, range: [number, number]): string => {
      const [start, end] = range
      if (start === 0) return ''
      for (let c = start; c < end; c++) {
        const v = getCell(r, c)
        if (v) return v
      }
      return ''
    }

    const DR = colRange('desc')
    const MR = colRange('mfr')
    const SR = colRange('sn')
    const TR = colRange('date')
    const LR = colRange('lab')

    const dataStartRow = refHeaderEndRow + 1
    let emptyCount = 0

    for (let r = dataStartRow; r <= dataStartRow + 20; r++) {
      const rowText = getRowText(r)

      // 종료: "Calibration Results" / "교정결과" / "6." / "7." 섹션
      if (/calibration\s*results|교정\s*결과|measurement\s*uncertainty|측정\s*불확도/i.test(rowText)) break
      if (/^6\.\s|^7\.\s/.test(rowText.trim())) break

      // 빈 행 카운트
      if (!rowText.trim()) { emptyCount++; if (emptyCount >= 2) break; continue }
      emptyCount = 0

      const desc = getVal(r, DR)
      const mfr = getVal(r, MR)
      const sn = getVal(r, SR)
      const date = getVal(r, TR)
      const lab = getVal(r, LR)

      // 행 분할 처리: 장비명만 있고 나머지 컬럼이 비어있으면 다음 행과 합침
      // (PDF→Excel 변환 시 긴 장비명이 전체 행을 차지하고, 나머지 데이터가 다음 행에)
      // ※ nonEmpty < 2 체크보다 먼저 처리해야 함 (desc만 있으면 nonEmpty=1)
      if (desc && !mfr && !sn && !date && !lab) {
        const nr = r + 1
        const nrText = getRowText(nr)
        // 다음 행이 종료 패턴이면 행 분할 아님
        if (/calibration\s*results|교정\s*결과|measurement\s*uncertainty|측정\s*불확도/i.test(nrText) ||
            /^6\.\s|^7\.\s/.test(nrText.trim())) {
          continue
        }
        const nMfr = getVal(nr, MR)
        const nSn = getVal(nr, SR)
        const nDate = getVal(nr, TR)
        const nLab = getVal(nr, LR)
        if (nMfr || nSn || nDate || nLab) {
          const nDesc = getVal(nr, DR) // 장비명 나머지 (e.g. "ne")
          standards.push({
            장비명: (nDesc ? desc + nDesc : desc) || null,
            제조사모델: nMfr || null,
            시리얼: nSn || null,
            유효일: nDate ? (normalizeDate(nDate) || nDate.trim()) : null,
            교정기관: nLab || null,
          })
          r++ // 다음 행 건너뛰기
          continue
        }
        continue // 다음 행에도 데이터 없으면 건너뜀
      }

      // 최소 2개 값이 있어야 기준기 행으로 인식
      const nonEmpty = [desc, mfr, sn, date, lab].filter(v => v).length
      if (nonEmpty < 2) continue

      standards.push({
        장비명: desc || null,
        제조사모델: mfr || null,
        시리얼: sn || null,
        유효일: date ? (normalizeDate(date) || date.trim()) : null,
        교정기관: lab || null,
      })
    }
  }

  // ─── 후처리: 잘못 파싱된 라벨 제거 ───
  for (const key of Object.keys(info)) {
    if (BAD_VALUES.has(info[key])) {
      delete info[key]
    }
  }

  return { info, 기준기: standards }
}

// ─── 판정 유틸 ───
// PASS/FAIL은 어디서든 판정으로 인식
// O/X는 적합여부 열(verdictCol)이 확인된 경우 해당 열에서만 판정으로 인식
function normalizeVerdict(v: string): 'PASS' | 'FAIL' {
  return (v === 'FAIL' || v === 'X') ? 'FAIL' : 'PASS'
}
// PASS/FAIL만 검사 (1차 탐색용 — O/X 열 위치를 아직 모를 때)
function hasPfInRow(vals: string[]): boolean {
  return vals.includes('PASS') || vals.includes('FAIL')
}
// PASS/FAIL + O/X 검사 (2차 탐색용 — verdictCol이 확인된 후)
function hasVerdictInRow(vals: string[], verdictCol: number): boolean {
  if (vals.includes('PASS') || vals.includes('FAIL')) return true
  const v = vals[verdictCol]
  return v === 'O' || v === 'X'
}
function getRowVerdict(vals: string[], verdictCol: number): 'PASS' | 'FAIL' | '' {
  if (vals.includes('FAIL')) return 'FAIL'
  if (vals.includes('PASS')) return 'PASS'
  const v = vals[verdictCol]
  if (v === 'X') return 'FAIL'
  if (v === 'O') return 'PASS'
  return ''
}
function isVerdictAt(v: string, col: number, verdictCol: number): boolean {
  if (v === 'PASS' || v === 'FAIL') return true
  if (col === verdictCol && (v === 'O' || v === 'X')) return true
  return false
}

// ─── 적합성검토서 파싱 ───
function parseConformity(ws: Worksheet): {
  info: Record<string, string>
  measurements: MeasurementPoint[]
  headers: string[]
} {
  const info: Record<string, string> = {}
  const measurements: MeasurementPoint[] = []

  // 모든 행을 배열로 변환
  const rows: string[][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow((row: any) => {
    const vals: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell({ includeEmpty: true }, (cell: any, colNum: number) => {
      while (vals.length < colNum - 1) vals.push('')
      vals.push(cellStr(cell.value))
    })
    rows.push(vals)
  })

  // ─── 장비 헤더 영역 파싱 ───
  // 패턴A: ['DYTRAN', 'Model', '3273A2', 'Description', 'Vibration transducers']
  //         ['Manufacturer']
  // 패턴B: ['Manufacturer', 'KULITE', 'Model', 'HKL-375-100A', 'Description', '...']
  for (let idx = 0; idx < rows.length; idx++) {
    const vals = rows[idx]
    const joined = vals.join(' ')

    if (vals.includes('Manufacturer') || vals.includes('Model')) {
      let combined = [...vals]
      if (idx > 0) {
        const prev = rows[idx - 1]
        if (!prev.some(v => HEADER_LABELS.has(v))) {
          combined = [...prev, ...combined]
        }
      }

      for (let i = 0; i < combined.length; i++) {
        const v = combined[i]

        if (v === 'Manufacturer' && !info['제조사']) {
          if (vals.includes('Model')) {
            // 패턴B
            const mfrIdx = vals.indexOf('Manufacturer')
            const modelIdx = vals.indexOf('Model')
            for (let j = mfrIdx + 1; j < modelIdx; j++) {
              if (vals[j] && !HEADER_LABELS.has(vals[j])) {
                info['제조사'] = vals[j]
                break
              }
            }
          } else {
            // 패턴A: 위 행에서 찾기
            for (let j = i - 1; j >= 0; j--) {
              if (combined[j] && !HEADER_LABELS.has(combined[j])) {
                info['제조사'] = combined[j]
                break
              }
            }
          }
        }

        if (v === 'Model' && !info['모델']) {
          if (vals.includes('Model')) {
            const mIdx = vals.indexOf('Model')
            for (let j = mIdx + 1; j < vals.length; j++) {
              if (vals[j] && !HEADER_LABELS.has(vals[j])) {
                info['모델'] = vals[j]
                break
              }
            }
          }
        }

        if (v === 'Description' && !info['장비명']) {
          if (vals.includes('Description')) {
            const dIdx = vals.indexOf('Description')
            for (let j = dIdx + 1; j < vals.length; j++) {
              if (vals[j] && !HEADER_LABELS.has(vals[j])) {
                info['장비명'] = vals[j]
                break
              }
            }
          }
        }
      }
    }

    // 한국어 패턴: 제조사 | GE DRUCK | 모델 | ADTS542F | 장비명 | 고도계
    if (vals.includes('제조사') || vals.includes('모델') || vals.includes('장비명')) {
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i]
        if (v === '제조사' && !info['제조사']) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && !HEADER_LABELS.has(vals[j])) {
              info['제조사'] = vals[j]; break
            }
          }
        }
        if (v === '모델' && !info['모델']) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && !HEADER_LABELS.has(vals[j])) {
              info['모델'] = vals[j]; break
            }
          }
        }
        if (v === '장비명' && !info['장비명']) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && !HEADER_LABELS.has(vals[j])) {
              info['장비명'] = vals[j]; break
            }
          }
        }
      }
    }

    if (joined.includes('Serial Number') || joined.includes('일련번호')) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Serial Number') || vals[i] === 'Serial Number' ||
            vals[i].includes('일련번호')) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && vals[j] !== 'Serial Number' && !vals[j].includes('일련번호')) {
              info['시리얼'] = vals[j]
              break
            }
          }
          break
        }
      }
    }

    if (joined.includes('Certificate No') || joined.includes('성적서번호')) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Certificate No') || vals[i].includes('성적서번호')) {
          if (vals[i].includes(':')) {
            const after = vals[i].split(':').pop()!.trim()
            if (after && !HEADER_LABELS.has(after)) info['성적서번호'] = after
          } else {
            for (let j = i + 1; j < vals.length; j++) {
              if (vals[j] && !HEADER_LABELS.has(vals[j]) && !/^Certificate/i.test(vals[j])) {
                info['성적서번호'] = vals[j]
                break
              }
            }
          }
          break
        }
      }
    }

    if (joined.includes('Identification') || joined.includes('관리번호')) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Identification') || vals[i].includes('관리번호')) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && vals[j] !== 'Number' && vals[j] !== 'Identification Number' &&
                !vals[j].includes('관리번호')) {
              info['관리번호'] = vals[j].replace(/[\[\]]/g, '').trim()
              break
            }
          }
          break
        }
      }
    }

    if (joined.includes('Date of Calibration') || (joined.includes('Calibration') && joined.includes('Date')) ||
        joined.includes('교정일')) {
      // 한국어: 교정일 | 2023-03-17 | 차기교정일 | 2024-03-16
      if (joined.includes('교정일')) {
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] === '교정일' && !info['교정일']) {
            for (let j = i + 1; j < vals.length; j++) {
              if (vals[j] && /\d/.test(vals[j]) && !vals[j].includes('차기')) {
                info['교정일'] = normalizeDate(vals[j]) || vals[j]
                break
              }
            }
          }
          if ((vals[i] === '차기교정일' || vals[i].includes('차기교정')) && !info['차기교정일']) {
            for (let j = i + 1; j < vals.length; j++) {
              if (vals[j] && /\d/.test(vals[j])) {
                info['차기교정일'] = normalizeDate(vals[j]) || vals[j]
                break
              }
            }
          }
        }
      }
      // 영문
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Calibration') && joined.includes('Date')) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && /\d/.test(vals[j])) {
              if (!info['교정일']) info['교정일'] = normalizeDate(vals[j]) || vals[j]
              for (let k = j + 1; k < vals.length; k++) {
                if (vals[k] && /\d/.test(vals[k])) {
                  if (!info['차기교정일']) info['차기교정일'] = normalizeDate(vals[k]) || vals[k]
                  break
                }
              }
              break
            }
          }
          break
        }
      }
    }
  }

  // ─── 측정 데이터 영역 파싱 ───
  // 전략:
  //  1차: PASS/FAIL 행을 찾아 헤더 탐색 (기존 영문 시트)
  //  2차: 1차 실패 시, 헤더에서 "적합" 열을 찾고 해당 열의 O/X로 데이터 행 탐색 (한국어 시트)
  // PDF→Excel 변환 시 셀 병합이 풀리면 오차/허용오차/판정 열이 대표 행에만 남으므로,
  // 빈 열은 동일 블록 내 판정 대표 행의 값을 전파한다.

  // 헤더 탐색 공통 로직: anchorIdx(첫 판정 행)를 기준으로 위쪽 행에서 헤더 추출
  function extractHeaders(anchorIdx: number): { headers: string[]; dataStartIdx: number } {
    const candidates: { idx: number; row: string[] }[] = []
    for (let h = anchorIdx - 1; h >= Math.max(0, anchorIdx - 5); h--) {
      candidates.unshift({ idx: h, row: rows[h] })
    }

    const merged: string[][] = []
    for (let ci = candidates.length - 1; ci >= 0; ci--) {
      const row = candidates[ci].row
      const nonEmptyVals = row.filter(v => v.trim())
      if (nonEmptyVals.length === 0) break
      const allNumeric = nonEmptyVals.every(v => !isNaN(parseFloat(v.replace(/[\s,]/g, ''))))
      if (allNumeric) break
      merged.unshift(row)
    }

    if (merged.length > 0) {
      const anchorVals = rows[anchorIdx]
      const maxLen = Math.max(anchorVals.length, ...merged.map(r => r.length))
      const hdrs = Array.from({ length: maxLen }, (_, i) => {
        const parts: string[] = []
        for (const row of merged) {
          const v = (row[i] || '').trim()
          if (v) parts.push(v)
        }
        return parts.join(' ')
      })
      const startIdx = candidates[candidates.length - merged.length].idx + merged.length
      return { headers: hdrs, dataStartIdx: startIdx }
    }
    return { headers: [], dataStartIdx: anchorIdx }
  }

  let headers: string[] = []
  let dataStartIdx = -1
  // verdictCol: O/X를 판정으로 인식할 열 인덱스 (-1이면 PASS/FAIL만 사용)
  let verdictCol = -1

  // 1차: PASS/FAIL 행으로 헤더 탐색
  for (let idx = 0; idx < rows.length; idx++) {
    if (!hasPfInRow(rows[idx])) continue
    const result = extractHeaders(idx)
    headers = result.headers
    dataStartIdx = result.dataStartIdx
    break
  }

  // 2차: 1차 실패 시, 헤더 행에서 "적합" 열을 먼저 찾고 O/X 데이터 행 탐색
  if (dataStartIdx < 0) {
    // 모든 행에서 "적합" 키워드가 포함된 잠재 헤더 행을 찾기
    for (let idx = 0; idx < rows.length; idx++) {
      const vals = rows[idx]
      const vColIdx = vals.findIndex(v => /적합/i.test(v))
      if (vColIdx < 0) continue

      // 이 행 아래에서 해당 열에 O/X가 있는 첫 데이터 행 찾기
      for (let dIdx = idx + 1; dIdx < rows.length && dIdx <= idx + 5; dIdx++) {
        const dVals = rows[dIdx]
        const dv = dVals[vColIdx]
        if (dv === 'O' || dv === 'X') {
          // 찾음! 이 행을 기준으로 헤더 추출
          verdictCol = vColIdx
          const result = extractHeaders(dIdx)
          headers = result.headers
          dataStartIdx = result.dataStartIdx
          break
        }
      }
      if (dataStartIdx >= 0) break
    }
  }

  // 헤더를 못 찾은 경우 (판정 없는 시트) → 빈 결과 반환
  if (dataStartIdx < 0) {
    return { info, measurements, headers }
  }

  // verdictCol이 아직 -1이면 헤더에서 적합 열을 다시 탐색 (PASS/FAIL 시트이지만 한국어 헤더일 수 있음)
  if (verdictCol < 0) {
    verdictCol = headers.findIndex(h => /conformity|pass.*fail|적합/i.test(h))
    if (verdictCol < 0) verdictCol = headers.length - 1  // 마지막 열 fallback
  }

  // 2단계: 데이터 영역 전체 행 수집 (숫자가 있거나, "-"만 있는 특수행 포함)
  // 여러 테이블(Clockwise/Counterclockwise 등)을 블록 단위로 분리
  type DataBlock = { rows: { idx: number; vals: string[] }[]; conformity: string }
  const blocks: DataBlock[] = []
  let currentBlock: DataBlock = { rows: [], conformity: '' }

  for (let idx = dataStartIdx; idx < rows.length; idx++) {
    const vals = rows[idx]
    const joined = vals.join(' ')

    // "The end" / "보정값 =" 등 데이터 영역 종료 마커
    if (/the\s*end/i.test(joined)) break
    if (/^\s*\*?\s*보정값\s*=/.test(joined)) break

    // 테이블 구분자 감지 (Clockwise, Counterclockwise 등)
    // 새 헤더가 시작되면 현재 블록 저장 후 새 블록, 헤더 행은 건너뜀
    const isNewSectionHeader = /\b(clockwise|counterclockwise|function|range)\b/i.test(joined)
      && !vals.some(v => !isNaN(parseFloat(v.replace(/[\s,±]/g, ''))) && parseFloat(v.replace(/[\s,±]/g, '')) !== 0)
      && !/^[0-9.\-+,\s±]+$/.test(joined.replace(/\s/g, ''))

    if (isNewSectionHeader && currentBlock.rows.length > 0) {
      blocks.push(currentBlock)
      currentBlock = { rows: [], conformity: '' }

      // 새 헤더 영역 건너뛰기: 숫자 데이터가 나올 때까지
      let skipTo = idx
      for (let s = idx + 1; s < rows.length && s <= idx + 8; s++) {
        const sVals = rows[s]
        const hasNumber = sVals.some(v => {
          const n = parseFloat(v.replace(/[\s,]/g, ''))
          return !isNaN(n)
        })
        const hasPF = hasVerdictInRow(sVals, verdictCol)
        const hasDash = sVals.includes('-')
        if (hasNumber || hasPF || (hasDash && sVals.filter(v => v.trim()).length >= 2)) {
          skipTo = s - 1
          break
        }
        skipTo = s
      }
      idx = skipTo
      continue
    }

    // 빈 행: 연속 2개 이상이면 데이터 영역 종료
    const nonEmptyVals = vals.filter(v => v.trim())
    if (nonEmptyVals.length === 0) {
      if (idx + 1 < rows.length && rows[idx + 1].filter(v => v.trim()).length === 0) break
      continue
    }

    // 숫자가 1개 이상 있거나, "-"가 있는 행 → 데이터 행
    const hasNumber = vals.some(v => {
      const n = parseFloat(v.replace(/[\s,]/g, ''))
      return !isNaN(n)
    })
    const hasDash = vals.includes('-')
    const hasPF = hasVerdictInRow(vals, verdictCol)

    if (hasNumber || hasPF || (hasDash && nonEmptyVals.length >= 2)) {
      currentBlock.rows.push({ idx, vals })
      if (hasPF) {
        currentBlock.conformity = getRowVerdict(vals, verdictCol)
      }
    }
  }

  // 마지막 블록 저장
  if (currentBlock.rows.length > 0) {
    blocks.push(currentBlock)
  }

  // 3단계: 각 블록 내에서 병합 열 전파 + MeasurementPoint 생성
  for (const block of blocks) {
    // 블록 내 판정 대표 행 찾기
    const repRow = block.rows.find(r => hasVerdictInRow(r.vals, verdictCol))
    const blockConformity = block.conformity || ''

    for (const { vals } of block.rows) {
      const numbers: number[] = []
      let conformity = ''
      const nonEmpty: string[] = []
      const maxLen = Math.max(vals.length, headers.length)
      const cells = Array.from({ length: maxLen }, (_, i) => vals[i] || '')

      for (let ci = 0; ci < vals.length; ci++) {
        const sv = vals[ci]
        if (isVerdictAt(sv, ci, verdictCol)) {
          conformity = normalizeVerdict(sv)
        } else if (sv && sv !== '-' && sv !== 'None') {
          nonEmpty.push(sv)
          const num = parseFloat(sv.replace(/\s/g, '').replace(',', ''))
          if (!isNaN(num)) numbers.push(num)
        }
      }

      // 병합 전파: 이 행에 판정이 없으면 블록의 대표 값 사용
      // 단, 행 자체에 "-"가 판정 위치에 명시적으로 있으면 전파 안 함 (0점 기준 등)
      const hasExplicitDash = vals.some((v, ci) => v === '-' && ci >= Math.max(2, vals.length - 4))
      if (!conformity && blockConformity && !hasExplicitDash) {
        conformity = blockConformity
        // 대표 행의 병합 열 값도 전파 (오차/허용오차 등)
        if (repRow) {
          for (let ci = 0; ci < repRow.vals.length; ci++) {
            const rv = repRow.vals[ci]
            if (!rv || isVerdictAt(rv, ci, verdictCol)) continue
            // 현재 행에서 해당 열이 비어있으면 전파
            if (!cells[ci] && rv !== '-') {
              cells[ci] = rv
              // 숫자/원본데이터에도 추가
              if (rv !== 'None') {
                nonEmpty.push(rv)
                const num = parseFloat(rv.replace(/\s/g, '').replace(',', ''))
                if (!isNaN(num)) numbers.push(num)
              }
            }
          }
        }
      }

      // 숫자가 있고 판정이 있는 행만 측정포인트로 (순수 "-"만 있는 0점 행은 제외)
      if (conformity && numbers.length > 0) {
        measurements.push({
          원본데이터: nonEmpty,
          숫자값: numbers,
          판정: conformity as 'PASS' | 'FAIL',
          셀: cells,
        })
      }
    }
  }

  return { info, measurements, headers }
}

// ─── 교차검증 ───
function crossValidate(
  cover: Record<string, string>,
  conf: Record<string, string>,
): { 항목: string; 갑지: string; 적합성검토: string }[] {
  const fields = ['성적서번호', '제조사', '모델', '시리얼', '관리번호']
  const mismatches: { 항목: string; 갑지: string; 적합성검토: string }[] = []

  for (const field of fields) {
    const coverVal = (cover[field] ?? '').trim()
    const confVal = (conf[field] ?? '').trim()
    if (!coverVal || !confVal) continue
    if (coverVal.toLowerCase().replace(/\s/g, '') !== confVal.toLowerCase().replace(/\s/g, '')) {
      mismatches.push({ 항목: field, 갑지: coverVal, 적합성검토: confVal })
    }
  }

  return mismatches
}

// ─── 메인 파싱 함수 ───
export async function parseCertExcel(buffer: Buffer | Uint8Array): Promise<CertResult> {
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)

  const result: CertResult = {
    성적서번호: null,
    고객명: null,
    장비명: null,
    제조사: null,
    모델: null,
    시리얼: null,
    관리번호: null,
    교정일: null,
    차기교정일: null,
    적합성검토: false,
    전체판정: null,
    측정포인트수: 0,
    측정헤더: [],
    측정결과: [],
    불일치: [],
    측정요약: null,
    _llm_보강: [],
    _llm_provider: null,
    시트수: wb.worksheets.length,
    시트목록: wb.worksheets.map((ws: Worksheet) => ws.name),
    // 갑지 확장 (ISO 10012)
    온도: null,
    습도: null,
    교정장소: null,
    교정방법: null,
    기술지원코드: null,
    기술지원코드원본: null,
    기준기: [],
    교정자: null,
    승인자: null,
    승인자직위: null,
    을지파싱: false,
  }

  // 갑지 파싱
  const { info: cover, 기준기 } = parseCover(wb)
  for (const [k, v] of Object.entries(cover)) {
    if (v) (result as unknown as Record<string, unknown>)[k] = v
  }
  result.기준기 = 기준기

  // 적합성검토서 파싱
  const confWs = findConformitySheet(wb)
  if (confWs) {
    result.적합성검토 = true
    const { info: conf, measurements, headers } = parseConformity(confWs)
    result.측정헤더 = headers

    // 교차검증
    result.불일치 = crossValidate(cover, conf)

    // 갑지 우선, 적합성검토서로 보강
    for (const key of ['장비명', '교정일', '차기교정일', '성적서번호']) {
      if (conf[key] && !result[key as keyof CertResult]) {
        (result as unknown as Record<string, unknown>)[key] = conf[key]
      }
    }
    if (conf['차기교정일']) result.차기교정일 = conf['차기교정일']
    if (conf['관리번호'] && !cover['관리번호']) result.관리번호 = conf['관리번호']

    result.측정결과 = measurements
    result.측정포인트수 = measurements.length
    if (measurements.length > 0) {
      const failCnt = measurements.filter(m => m.판정 === 'FAIL').length
      result.전체판정 = failCnt === 0 ? 'PASS' : 'FAIL'
    }
  }

  return result
}

// ─── 적합성검토서 시트 → 텍스트 (LLM 입력용, 토큰 절약) ───
export function conformityToText(ws: Worksheet): string {
  const lines: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow((row: any) => {
    const vals = (row.values as CellValue[])
      .slice(1)
      .map((v: CellValue) => cellStr(v))
    // 빈칸 압축: 연속 빈칸을 하나로
    const compressed: string[] = []
    let wasEmpty = false
    for (const v of vals) {
      if (v === '') {
        if (!wasEmpty) compressed.push('')
        wasEmpty = true
      } else {
        compressed.push(v)
        wasEmpty = false
      }
    }
    // 끝 빈칸 제거
    while (compressed.length > 0 && compressed[compressed.length - 1] === '') {
      compressed.pop()
    }
    if (compressed.length > 0) {
      lines.push(compressed.join(' | '))
    }
  })
  return lines.join('\n')
}

// ─── 적합성검토서 시트 → 구조화 텍스트 (시트 전체, 셀 병합 전파) ───
// 테이블 범위 판단은 LLM에 위임. 시트 전체를 파이프 구분 텍스트로 출력.
export function conformityToStructuredText(ws: Worksheet): string {
  // 1. 셀 병합 맵 구축: (row,col) → 병합 원본 (row,col)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merges: string[] = (ws.model?.merges ?? []) as string[]
  const mergeOrigin = new Map<string, { r: number; c: number }>()
  for (const range of merges) {
    const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
    if (!m) continue
    const c1 = colLetterToNum(m[1]), r1 = parseInt(m[2])
    const c2 = colLetterToNum(m[3]), r2 = parseInt(m[4])
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r !== r1 || c !== c1) {
          mergeOrigin.set(`${r}:${c}`, { r: r1, c: c1 })
        }
      }
    }
  }

  // 2. 전체 행 순회 + 병합 전파
  const cellMap = new Map<string, string>() // "r:c" → value (1-based)
  const rawRows: { vals: string[]; rowNum: number }[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow({ includeEmpty: true }, (row: any, rowNum: number) => {
    const vals: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell({ includeEmpty: true }, (cell: any, colNum: number) => {
      while (vals.length < colNum - 1) vals.push('')
      const v = cellStr(cell.value)
      vals.push(v)
      if (v) cellMap.set(`${rowNum}:${colNum}`, v)
    })
    rawRows.push({ vals, rowNum })
  })

  // 병합 셀 값 전파
  const rows: string[][] = rawRows.map(({ vals, rowNum }) => {
    return vals.map((v, ci) => {
      if (v) return v
      const origin = mergeOrigin.get(`${rowNum}:${ci + 1}`)
      if (origin) return cellMap.get(`${origin.r}:${origin.c}`) ?? ''
      return ''
    })
  })

  // 3. k-tools PDF→Excel 변환 아티팩트 제거
  // k-tools가 PDF를 Excel로 변환할 때, 실제로는 빈 셀인데 인접한 측정값을
  // 복사해 넣는 경우가 있음. 이로 인해 오차/허용오차/적합여부 열에 측정값이
  // 들어가서 LLM이 잘못된 오차를 계산하게 됨.
  // 패턴: 같은 행에서 앞쪽 열(기준값/지시값)의 값이 뒤쪽 열(오차/허용/결과)에
  //       동일하게 반복되면, 뒤쪽의 중복값을 빈칸으로 치환.
  for (const row of rows) {
    if (row.length < 4) continue
    // 숫자값이 있는 앞쪽 열(인덱스 0~3) 수집
    const frontValues = new Set<string>()
    const numericFront = new Set<string>()
    for (let i = 0; i < Math.min(4, row.length); i++) {
      const v = row[i].trim()
      if (v && !isNaN(Number(v.replace(/,/g, '')))) {
        frontValues.add(v)
        numericFront.add(v)
      }
    }
    if (numericFront.size === 0) continue
    // 뒤쪽 열(인덱스 4~) 검사: 앞쪽 측정값과 동일한 숫자가 반복되면 제거
    let tailDupCount = 0
    let tailTotalCount = 0
    for (let i = 4; i < row.length; i++) {
      const v = row[i].trim()
      if (!v) continue
      tailTotalCount++
      if (frontValues.has(v)) tailDupCount++
    }
    // 뒤쪽 열의 모든 비어있지 않은 셀이 앞쪽 측정값의 복사본이면 제거
    if (tailDupCount > 0 && tailDupCount === tailTotalCount) {
      for (let i = 4; i < row.length; i++) {
        const v = row[i].trim()
        if (v && frontValues.has(v)) {
          row[i] = ''
        }
      }
    }
  }

  // 4. 사용 중인 최대 열 수 파악 (후행 빈 열 제거용)
  let maxCol = 0
  for (const row of rows) {
    for (let i = row.length - 1; i >= 0; i--) {
      if (row[i].trim()) { maxCol = Math.max(maxCol, i + 1); break }
    }
  }
  if (maxCol === 0) return ''

  // 5. 파이프 구분 텍스트 출력
  const lines: string[] = []
  for (const row of rows) {
    const cells = Array.from({ length: maxCol }, (_, i) => row[i] || '')
    const hasContent = cells.some(v => v.trim())
    if (hasContent) {
      lines.push(cells.join(' | '))
    } else {
      // 빈 행은 빈 줄로 출력 (LLM이 섹션 구분에 활용)
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

// 엑셀 컬럼 문자 → 숫자 변환 (A=1, B=2, ..., Z=26, AA=27, ...)
function colLetterToNum(letters: string): number {
  let num = 0
  for (let i = 0; i < letters.length; i++) {
    num = num * 26 + (letters.charCodeAt(i) - 64)
  }
  return num
}

// ─── Excel → 텍스트 변환 (LLM 입력용) ───
export async function excelToText(buffer: Buffer | Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)

  const parts: string[] = []
  for (const ws of wb.worksheets) {
    const lines: string[] = [`=== Sheet: ${ws.name} ===`]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.eachRow((row: any) => {
      const vals = (row.values as CellValue[])
        .slice(1) // row.values는 1-indexed
        .map((v: CellValue) => cellStr(v))
      if (vals.some((v: string) => v !== '')) {
        lines.push(vals.join(' | '))
      }
    })
    parts.push(lines.join('\n'))
  }

  return parts.join('\n\n')
}
