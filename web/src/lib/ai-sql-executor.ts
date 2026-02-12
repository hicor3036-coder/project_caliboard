// AI SQL 실행기: sql.js wrapper + 에러 재시도 로직
import initSqlJs, { Database } from 'sql.js'
import { KtoolsItem } from './ktools-fetch'
import path from 'path'

// SQL 실행 결과 타입
export interface SqlExecutionResult {
  success: boolean
  data?: unknown[]
  error?: string
  rowCount?: number
}

// 위험한 SQL 패턴 (보안)
const DANGEROUS_PATTERNS = [
  /\bDROP\b/i,
  /\bDELETE\b/i,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bALTER\b/i,
  /\bCREATE\s+TABLE\b/i,
  /\bTRUNCATE\b/i,
]

/**
 * SQL 쿼리 안전성 검증
 * @param sql SQL 쿼리 문자열
 * @returns 안전하면 true
 */
function isSafeSql(sql: string): boolean {
  return !DANGEROUS_PATTERNS.some(pattern => pattern.test(sql))
}

// sql.js DB 캐시 (재사용)
let cachedDb: Database | null = null
let cachedDataHash: string | null = null

/**
 * 배열 데이터를 sql.js 임시 테이블로 생성
 * @param items 데이터 배열
 * @returns Database 인스턴스
 */
async function createTempDb(items: KtoolsItem[]): Promise<Database> {
  // 데이터 해시 (재사용 여부 판단)
  const dataHash = JSON.stringify(items.slice(0, 5)) // 간단히 첫 5건으로 해시

  if (cachedDb && cachedDataHash === dataHash) {
    return cachedDb
  }

  // sql.js 초기화 (public 폴더의 WASM 파일 사용)
  const wasmPath = path.join(process.cwd(), 'public', 'sql-wasm.wasm')
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  })

  const db = new SQL.Database()

  // 테이블 생성 (컬럼 추출)
  if (items.length === 0) {
    throw new Error('데이터가 비어있습니다')
  }

  const sampleItem = items[0]
  const columns = Object.keys(sampleItem)

  // SQLite는 컬럼명 대소문자 구분 안함 → 소문자 기준 중복 제거
  const seen = new Set<string>()
  const uniqueColumns: string[] = []
  for (const col of columns) {
    const lower = col.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      uniqueColumns.push(col)
    }
  }
  console.log(`[SQL Executor] Total keys: ${columns.length}, After dedup (case-insensitive): ${uniqueColumns.length}`)

  // CREATE TABLE (컬럼명을 따옴표로 감싸서 예약어 충돌 방지)
  const columnDefs = uniqueColumns.map(col => `"${col}" TEXT`).join(', ')
  db.run(`CREATE TABLE items (${columnDefs})`)

  // INSERT 데이터 (uniqueColumns 기반)
  const placeholders = uniqueColumns.map(() => '?').join(', ')
  const insertStmt = db.prepare(`INSERT INTO items VALUES (${placeholders})`)

  for (const item of items) {
    const values = uniqueColumns.map(col => {
      const val = (item as Record<string, unknown>)[col]
      return val === null || val === undefined ? null : String(val)
    })
    insertStmt.run(values)
  }

  insertStmt.free()

  cachedDb = db
  cachedDataHash = dataHash

  return db
}

/**
 * sql.js로 인메모리 SQL 실행
 * @param sql SQL 쿼리
 * @param items 데이터 배열
 * @returns 실행 결과
 */
export async function executeSQL(
  sql: string,
  items: KtoolsItem[]
): Promise<SqlExecutionResult> {
  // 보안 검증
  if (!isSafeSql(sql)) {
    return {
      success: false,
      error: '허용되지 않는 SQL 명령어입니다 (SELECT만 가능)',
    }
  }

  try {
    const db = await createTempDb(items)

    // SQL 실행
    const results = db.exec(sql)

    if (results.length === 0) {
      return {
        success: true,
        data: [],
        rowCount: 0,
      }
    }

    // 결과를 객체 배열로 변환
    const result = results[0]
    const data = result.values.map(row => {
      const obj: Record<string, unknown> = {}
      result.columns.forEach((col, idx) => {
        obj[col] = row[idx]
      })
      return obj
    })

    return {
      success: true,
      data,
      rowCount: data.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * SQL 실행 실패 시 에러 메시지 분석 및 힌트 생성
 * @param error 에러 메시지
 * @param items 원본 데이터
 * @returns LLM에게 전달할 에러 컨텍스트
 */
export function generateErrorContext(
  error: string,
  items: KtoolsItem[]
): string {
  // 실제 컬럼명 목록 추출 (첫 번째 아이템 기준)
  const sampleItem = items[0]
  const actualColumns = sampleItem ? Object.keys(sampleItem) : []

  // 컬럼 없음 에러
  if (error.includes('not found') || error.includes('does not exist')) {
    return `
SQL 실행 실패: ${error}

실제 사용 가능한 컬럼명 목록:
${actualColumns.join(', ')}

위 컬럼명을 정확히 사용하여 SQL을 다시 생성하세요.
`
  }

  // 문법 에러
  if (error.includes('syntax') || error.includes('Syntax')) {
    return `
SQL 문법 오류: ${error}

AlaSQL은 표준 SQL을 지원하지만 일부 함수는 사용할 수 없습니다.
- 사용 불가: DATEDIFF, DATEADD, CONVERT 등
- 날짜 계산이 필요하면 needsResult=true로 설정하세요

SQL을 수정하여 다시 생성하세요.
`
  }

  // 기타 에러
  return `
SQL 실행 실패: ${error}

가능한 원인:
1. 컬럼명 오타 (정확한 컬럼명: ${actualColumns.slice(0, 10).join(', ')}, ...)
2. AlaSQL 미지원 함수 사용
3. 문법 오류

SQL을 수정하여 다시 생성하세요.
`
}

/**
 * 결과 데이터에서 필요한 컬럼만 추출 (토큰 절약)
 * @param data 원본 결과 데이터
 * @param columns 필요한 컬럼 목록
 * @returns 컬럼 필터링된 데이터
 */
export function filterColumns(
  data: unknown[],
  columns: string[]
): unknown[] {
  if (!columns || columns.length === 0) return data

  return data.map(row => {
    if (typeof row !== 'object' || row === null) return row

    const filtered: Record<string, unknown> = {}
    for (const col of columns) {
      filtered[col] = (row as Record<string, unknown>)[col]
    }
    return filtered
  })
}

/**
 * 결과 데이터를 LLM에게 전달할 텍스트로 변환
 * @param data 결과 데이터
 * @param maxRows 최대 포함 행 수
 * @returns 텍스트 형식 결과
 */
export function formatResultForLLM(
  data: unknown[],
  maxRows: number = 50
): string {
  if (data.length === 0) return '결과 없음 (0건)'

  const limited = data.slice(0, maxRows)
  const hasMore = data.length > maxRows

  let text = `결과: ${data.length}건${hasMore ? ` (상위 ${maxRows}건만 표시)` : ''}\n\n`

  // JSON 형식으로 변환
  text += JSON.stringify(limited, null, 2)

  return text
}
