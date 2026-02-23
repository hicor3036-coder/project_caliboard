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

import type { CertResult, MeasurementPoint } from './cert-cache'

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
      if (joined.includes('CONFORMITY')) {
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
function parseCover(wb: Workbook): Record<string, string> {
  const info: Record<string, string> = {}
  const ws = wb.getWorksheet('Page 1') ?? wb.worksheets[0]
  if (!ws) return info

  // 모든 셀을 (행, 열) → 값 딕셔너리로 변환
  const cells = new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow((row: any, rowNum: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell((cell: any, colNum: number) => {
      const val = cellStr(cell.value)
      if (val) cells.set(`${rowNum},${colNum}`, val)
    })
  })

  const getCell = (r: number, c: number) => cells.get(`${r},${c}`) || ''

  let foundClient = false
  const sortedEntries = [...cells.entries()].sort((a, b) => {
    const [ar, ac] = a[0].split(',').map(Number)
    const [br, bc] = b[0].split(',').map(Number)
    return ar !== br ? ar - br : ac - bc
  })

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
    if (val.includes('Manufacturer and Model')) {
      const modelVal = getCell(r, c + 4) || getCell(r, c + 3) || getCell(r, c + 2)
      if (modelVal) {
        const parts = modelVal.split('/')
        info['제조사'] = parts[0].trim()
        info['모델'] = parts.length > 1 ? parts[1].trim() : ''
      }
    }

    // 시리얼
    if (val.startsWith('Serial Number') || val.startsWith('시리얼') || val.includes('일련번호')) {
      const snVal = getCell(r, c + 2) || getCell(r, c + 1)
      if (snVal && !info['시리얼']) {
        info['시리얼'] = snVal.split('[')[0].trim()
        if (snVal.includes('[')) {
          info['관리번호'] = snVal.split(':').pop()!.trim().replace(']', '')
        }
      }
    }

    // 교정일
    if (val.includes('Date of Calibration') || val.includes('교정일자')) {
      if (!info['교정일']) {
        // 1) 현재 셀 자체에 날짜가 포함된 경우 (라벨+값 합쳐짐)
        const fromSelf = extractDateFromCell(val)
        if (fromSelf) {
          info['교정일'] = fromSelf
        } else {
          // 2) 우측 셀에서 날짜 찾기
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
            info['차기교정일'] = normalized || dateVal.trim()
          }
        }
      }
    }
  }

  // 후처리: 영문 라벨이 값으로 잘못 파싱된 경우 제거
  for (const key of Object.keys(info)) {
    if (BAD_VALUES.has(info[key])) {
      delete info[key]
    }
  }

  return info
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

    if (joined.includes('Serial Number')) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Serial Number') || vals[i] === 'Serial Number') {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && vals[j] !== 'Serial Number') {
              info['시리얼'] = vals[j]
              break
            }
          }
          break
        }
      }
    }

    if (joined.includes('Certificate No')) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Certificate No')) {
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

    if (joined.includes('Identification')) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Identification')) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && vals[j] !== 'Number' && vals[j] !== 'Identification Number') {
              info['관리번호'] = vals[j]
              break
            }
          }
          break
        }
      }
    }

    if (joined.includes('Date of Calibration') || (joined.includes('Calibration') && joined.includes('Date'))) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].includes('Calibration') && joined.includes('Date')) {
          for (let j = i + 1; j < vals.length; j++) {
            if (vals[j] && /\d/.test(vals[j])) {
              info['교정일'] = normalizeDate(vals[j]) || vals[j]
              for (let k = j + 1; k < vals.length; k++) {
                if (vals[k] && /\d/.test(vals[k])) {
                  info['차기교정일'] = normalizeDate(vals[k]) || vals[k]
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
  // 전략: PASS/FAIL이 있는 첫 행으로 헤더를 찾고, 헤더 아래 모든 데이터 행을 수집.
  // PDF→Excel 변환 시 셀 병합이 풀리면 오차/허용오차/판정 열이 대표 행에만 남으므로,
  // 빈 열은 동일 블록 내 PASS/FAIL 대표 행의 값을 전파한다.

  let headers: string[] = []
  let dataStartIdx = -1  // 헤더 바로 다음 행 인덱스

  // 1단계: 첫 번째 PASS/FAIL 행을 기준으로 헤더 탐색
  for (let idx = 0; idx < rows.length; idx++) {
    const vals = rows[idx]
    if (!vals.includes('PASS') && !vals.includes('FAIL')) continue

    // 위로 최대 5행까지 후보 수집
    const candidates: { idx: number; row: string[] }[] = []
    for (let h = idx - 1; h >= Math.max(0, idx - 5); h--) {
      candidates.unshift({ idx: h, row: rows[h] })
    }

    // 헤더 행 찾기: 숫자가 아닌 텍스트가 주로 있는 행
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
      const maxLen = Math.max(vals.length, ...merged.map(r => r.length))
      headers = Array.from({ length: maxLen }, (_, i) => {
        const parts: string[] = []
        for (const row of merged) {
          const v = (row[i] || '').trim()
          if (v) parts.push(v)
        }
        return parts.join(' ')
      })
      // 데이터 시작: 헤더 후보 중 마지막 행 바로 다음
      dataStartIdx = candidates[candidates.length - merged.length].idx + merged.length
    } else {
      dataStartIdx = idx
    }
    break
  }

  // 헤더를 못 찾은 경우 (PASS/FAIL 없는 시트) → 빈 결과 반환
  if (dataStartIdx < 0) {
    return { info, measurements, headers }
  }

  // 2단계: 데이터 영역 전체 행 수집 (숫자가 있거나, "-"만 있는 특수행 포함)
  // 여러 테이블(Clockwise/Counterclockwise 등)을 블록 단위로 분리
  type DataBlock = { rows: { idx: number; vals: string[] }[]; conformity: string }
  const blocks: DataBlock[] = []
  let currentBlock: DataBlock = { rows: [], conformity: '' }

  for (let idx = dataStartIdx; idx < rows.length; idx++) {
    const vals = rows[idx]
    const joined = vals.join(' ')

    // "The end" → 데이터 영역 종료
    if (/the\s*end/i.test(joined)) break

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
        const hasPF = sVals.includes('PASS') || sVals.includes('FAIL')
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
    const hasPF = vals.includes('PASS') || vals.includes('FAIL')

    if (hasNumber || hasPF || (hasDash && nonEmptyVals.length >= 2)) {
      currentBlock.rows.push({ idx, vals })
      if (hasPF) {
        currentBlock.conformity = vals.includes('FAIL') ? 'FAIL' : 'PASS'
      }
    }
  }

  // 마지막 블록 저장
  if (currentBlock.rows.length > 0) {
    blocks.push(currentBlock)
  }

  // 3단계: 각 블록 내에서 병합 열 전파 + MeasurementPoint 생성
  // 판정 열 인덱스: 헤더에서 Conformity/PASS 포함하는 열
  let conformityColIdx = headers.findIndex(h => /conformity|pass.*fail/i.test(h))
  if (conformityColIdx < 0) conformityColIdx = headers.length - 1  // 마지막 열 fallback

  for (const block of blocks) {
    // 블록 내 PASS/FAIL 대표 행 찾기
    const repRow = block.rows.find(r => r.vals.includes('PASS') || r.vals.includes('FAIL'))
    const blockConformity = block.conformity || ''

    for (const { vals } of block.rows) {
      const numbers: number[] = []
      let conformity = ''
      const nonEmpty: string[] = []
      const maxLen = Math.max(vals.length, headers.length)
      const cells = Array.from({ length: maxLen }, (_, i) => vals[i] || '')

      for (let ci = 0; ci < vals.length; ci++) {
        const sv = vals[ci]
        if (sv === 'PASS' || sv === 'FAIL') {
          conformity = sv
        } else if (sv && sv !== '-' && sv !== 'None') {
          nonEmpty.push(sv)
          const num = parseFloat(sv.replace(/\s/g, '').replace(',', ''))
          if (!isNaN(num)) numbers.push(num)
        }
      }

      // 병합 전파: 이 행에 PASS/FAIL이 없으면 블록의 대표 값 사용
      // 단, 행 자체에 "-"가 판정 위치에 명시적으로 있으면 전파 안 함 (0점 기준 등)
      const hasExplicitDash = vals.some((v, ci) => v === '-' && ci >= Math.max(2, vals.length - 4))
      if (!conformity && blockConformity && !hasExplicitDash) {
        conformity = blockConformity
        // 대표 행의 병합 열 값도 전파 (오차/허용오차 등)
        if (repRow) {
          for (let ci = 0; ci < repRow.vals.length; ci++) {
            const rv = repRow.vals[ci]
            if (!rv || rv === 'PASS' || rv === 'FAIL') continue
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
  }

  // 갑지 파싱
  const cover = parseCover(wb)
  for (const [k, v] of Object.entries(cover)) {
    if (v) (result as unknown as Record<string, unknown>)[k] = v
  }

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

  // 3. 사용 중인 최대 열 수 파악 (후행 빈 열 제거용)
  let maxCol = 0
  for (const row of rows) {
    for (let i = row.length - 1; i >= 0; i--) {
      if (row[i].trim()) { maxCol = Math.max(maxCol, i + 1); break }
    }
  }
  if (maxCol === 0) return ''

  // 4. 파이프 구분 텍스트 출력
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
