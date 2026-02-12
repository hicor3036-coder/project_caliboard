// AI Text-to-SQL: 실제 데이터에서 스키마를 동적 생성
// 수동 유지보수 불필요 — 데이터가 바뀌어도 자동으로 맞춰짐

import { KtoolsItem } from './ktools-fetch'

// 오늘 날짜 (YYYYMMDD)
function getToday(): string {
  const d = new Date()
  return d.getFullYear().toString() +
    (d.getMonth() + 1).toString().padStart(2, '0') +
    d.getDate().toString().padStart(2, '0')
}

// 주요 컬럼 한글 설명 (고정, 도메인 지식)
export const COLUMN_LABELS: Record<string, string> = {
  acptNo: '접수번호 (고유 ID)',
  entpPrdNm: '업체품명 (장비명)',
  prdnCmpnNm: '제조사',
  stszNm: '진행상태',
  pgstNm: '처리상태 (미처리 판별용)',
  mngmRsprNm: '담당자명',
  mngmDvsnNm: '담당부서',
  rcpnYmd: '접수일자 (YYYYMMDD)',
  fnshScdlYmd: '완료예정일 (YYYYMMDD)',
  exrsWrtnYmd: '발행일자 (YYYYMMDD)',
  nxtrExrsYmd: '차기교정일 (YYYYMMDD)',
  isncYmd: '출고일자 (YYYYMMDD)',
  snctYmd: '결재일자 (YYYYMMDD)',
  mctlNo: '관리번호',
  custEqpmSrno: '고객장비 S/N',
  affcCyclCd: '교정주기 (개월)',
  prjcCd: '과제코드',
  totalFee: '총수수료 (원, VAT 제외)',
  totalSum: '총합계 (원, VAT 포함)',
  gyeoljeStatus: '결제상태코드',
  apcnCmnm: '신청회사명',
  apcnNm: '신청자명',
  prdNm: '제품명',
}

// DISTINCT 값을 추출할 카테고리 컬럼
const CATEGORY_COLUMNS = ['stszNm', 'pgstNm', 'mngmRsprNm', 'mngmDvsnNm', 'affcCyclCd', 'gyeoljeStatus']

// 날짜 컬럼 (범위 추출)
const DATE_COLUMNS = ['rcpnYmd', 'fnshScdlYmd', 'exrsWrtnYmd', 'nxtrExrsYmd', 'isncYmd', 'snctYmd']

/**
 * 실제 데이터에서 메타데이터 추출
 */
function extractMetadata(items: KtoolsItem[]) {
  // 카테고리 값 추출 (최대 20개)
  const categories: Record<string, string[]> = {}
  for (const col of CATEGORY_COLUMNS) {
    const values = new Set<string>()
    for (const item of items) {
      const val = (item as Record<string, unknown>)[col]
      if (val && typeof val === 'string' && val.trim()) {
        values.add(val.trim())
      }
      if (values.size >= 20) break
    }
    categories[col] = Array.from(values).sort()
  }

  // 날짜 범위 추출
  const dateRanges: Record<string, { min: string; max: string }> = {}
  for (const col of DATE_COLUMNS) {
    let min = 'zzzzzzzz'
    let max = '00000000'
    for (const item of items) {
      const val = (item as Record<string, unknown>)[col]
      if (val && typeof val === 'string' && val.length === 8) {
        if (val < min) min = val
        if (val > max) max = val
      }
    }
    if (min !== 'zzzzzzzz') {
      dateRanges[col] = { min, max }
    }
  }

  // 샘플 데이터 3건 (주요 컬럼만)
  const sampleCols = ['acptNo', 'entpPrdNm', 'prdnCmpnNm', 'stszNm', 'pgstNm', 'rcpnYmd', 'mngmRsprNm']
  const samples = items.slice(0, 3).map(item => {
    const obj: Record<string, unknown> = {}
    for (const col of sampleCols) {
      obj[col] = (item as Record<string, unknown>)[col] ?? null
    }
    return obj
  })

  return { categories, dateRanges, samples }
}

/**
 * 실제 데이터 기반 SQL 스키마 동적 생성
 */
export function getSqlSchema(items?: KtoolsItem[]): string {
  const today = getToday()

  // 메타데이터 추출 (데이터 있을 때만)
  let metaSection = ''
  if (items && items.length > 0) {
    const meta = extractMetadata(items)

    // 컬럼 목록 (실제 데이터 기반)
    const allColumns = Object.keys(items[0])
    const columnList = allColumns
      .map(col => {
        const label = COLUMN_LABELS[col]
        return label ? `- ${col}: ${label}` : `- ${col}`
      })
      .join('\n')

    // 카테고리 값
    const categorySection = Object.entries(meta.categories)
      .map(([col, vals]) => {
        const label = COLUMN_LABELS[col] || col
        return `**${col}** (${label}): ${vals.map(v => `"${v}"`).join(', ')}`
      })
      .join('\n')

    // 날짜 범위
    const dateSection = Object.entries(meta.dateRanges)
      .map(([col, range]) => {
        const label = COLUMN_LABELS[col] || col
        return `- ${col} (${label}): ${range.min} ~ ${range.max}`
      })
      .join('\n')

    metaSection = `
## 컬럼 목록 (총 ${allColumns.length}개, 주요 컬럼만 설명)
${columnList}

## 카테고리 컬럼의 실제 값
${categorySection}

## 날짜 컬럼 범위
${dateSection}

## 샘플 데이터 (${items.length}건 중 3건)
\`\`\`json
${JSON.stringify(meta.samples, null, 2)}
\`\`\`
`
  }

  return `당신은 교정장비 관리 데이터베이스 쿼리 전문가입니다.

**오늘 날짜: ${today}** (YYYYMMDD 형식, 반드시 이 날짜를 기준으로 계산하세요)

# 데이터베이스 스키마

테이블명: items (교정장비 위탁 접수 데이터${items ? `, ${items.length}건` : ''})
${metaSection}
## 핵심 비즈니스 규칙

1. **미처리 판별**: pgstNm 컬럼에 '미처리' 문자열이 포함된 건 → \`pgstNm LIKE '%미처리%'\`
2. **날짜 형식**: 모든 날짜는 YYYYMMDD 문자열 → 문자열 비교로 충분
3. **숫자 비교**: totalFee, totalSum은 TEXT로 저장됨 → \`CAST(totalFee AS INTEGER)\` 필요

## 자주 사용되는 쿼리 패턴

### 미처리 건수
\`SELECT COUNT(*) as 건수 FROM items WHERE pgstNm LIKE '%미처리%'\`

### 담당자별 미처리
\`SELECT acptNo, entpPrdNm, rcpnYmd FROM items WHERE mngmRsprNm = '담당자명' AND pgstNm LIKE '%미처리%'\`

### 담당자별 처리량
\`SELECT mngmRsprNm as 담당자, COUNT(*) as 건수 FROM items WHERE mngmRsprNm IS NOT NULL AND mngmRsprNm != '' GROUP BY mngmRsprNm ORDER BY 건수 DESC\`

### 키워드 검색
\`SELECT acptNo, entpPrdNm, prdnCmpnNm FROM items WHERE entpPrdNm LIKE '%키워드%' OR prdnCmpnNm LIKE '%키워드%' LIMIT 50\`

# 응답 형식 (반드시 JSON만 출력)

\`\`\`json
{
  "sql": "SELECT ... FROM items WHERE ...",
  "needsResult": true 또는 false,
  "reasoning": "판단 이유",
  "columnsNeeded": ["col1", "col2"] (needsResult=true일 때만),
  "localProcessing": "처리 설명" (needsResult=false일 때만)
}
\`\`\`

## needsResult 판단
- **false**: 결과가 숫자 1개뿐인 단순 집계 (COUNT 1건, SUM 1건 등)
- **true**: 여러 행 반환, 목록, 순위, 비교, GROUP BY 결과 등

# 주의사항
1. 위 컬럼 목록에 있는 컬럼명만 정확히 사용
2. SQLite 문법만 사용 (sql.js 기반)
3. 키워드 검색처럼 범위가 넓은 쿼리만 LIMIT 200 추가. 특정 담당자/조건 필터링은 LIMIT 없이 전체 반환
4. NULL 필터: \`컬럼 IS NOT NULL AND 컬럼 != ''\`
5. JSON만 응답, 다른 설명 없이
6. 집계 별칭은 한글로: \`COUNT(*) as 건수\`, \`SUM(...) as 합계\`
7. 순위/목록 쿼리에는 ORDER BY 반드시 포함
`
}
