'use client'

import { useMemo, useState, type ClipboardEvent } from 'react'
import { useT, fmt } from '@/lib/i18n'
import ReceptionCheckHelp from './reception-check-help'

// page.tsx 의 전체장비 항목 중 대조에 필요한 필드
interface ReceptionItem {
  acptNo: string       // 마크애니 성적서 조회용
  entpPrdNm: string
  prdnCmpnNm: string
  stszNm: string
  mctlNo: string
  custEqpmSrno: string
  rcpnYmd: string      // YYYY-MM-DD (toEquipmentList에서 포맷됨)
  pgstNm: string       // 진행상태
  mngmRsprNm: string   // 담당자
}

// 접수일(YYYY-MM-DD)로부터 오늘까지 경과일. 파싱 불가 시 null
function elapsedDays(rcpnYmd: string): number | null {
  if (!rcpnYmd) return null
  const d = new Date(rcpnYmd)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  const diff = today.getTime() - d.getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

// 교정관리번호 정규화: 공백 제거 + 대문자 (정규화 후 완전일치)
function normalizeKey(v: string): string {
  return v.replace(/\s/g, '').toUpperCase()
}

// 헤더로 인식할 교정관리번호 키워드 (우선순위 순)
const KEY_HEADER_KEYWORDS = ['교정관리번호', '관리번호', '교정번호']

type Grid = string[][]

// HTML <table> → 2차원 그리드. 셀 내용은 그대로 보존(공백 분리 안 함)
function parseHtmlTable(html: string): Grid | null {
  if (typeof window === 'undefined') return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null
  const grid: Grid = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.querySelectorAll('th, td')).map(td =>
      (td.textContent ?? '').replace(/\s+/g, ' ').trim()
    )
    if (cells.some(c => c.length > 0)) grid.push(cells)
  }
  return grid.length > 0 ? grid : null
}

// text/plain (탭 구분 + 줄바꿈) → 그리드. 탭이 없으면 null (그리드화 불가)
function parsePlainTable(text: string): Grid | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return null
  const hasTab = lines.some(l => l.includes('\t'))
  if (!hasTab) return null
  const grid = lines.map(l => l.split('\t').map(c => c.trim()))
  return grid.length > 0 ? grid : null
}

// 모든 행을 최대 열 수에 맞춰 패딩.
// 헤더 행(키워드 포함)이 데이터 행보다 짧으면, 데이터에 추가된 선행 컬럼(예: 순번)과
// 정렬되도록 앞쪽으로 패딩한다. 그 외 행은 뒤쪽으로 패딩.
function normalizeGrid(grid: Grid): Grid {
  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0)
  return grid.map(r => {
    const row = [...r]
    const pad = maxCols - row.length
    if (pad <= 0) return row
    const isHeader = row.some(cell => KEY_HEADER_KEYWORDS.some(kw => cell.replace(/\s/g, '').includes(kw)))
    if (isHeader) {
      return [...Array(pad).fill(''), ...row] // 헤더는 앞쪽 패딩 → 우측 정렬
    }
    return [...row, ...Array(pad).fill('')] // 데이터는 뒤쪽 패딩
  })
}

// 교정관리번호 값 패턴: 영문 1~3자 + 숫자 4자 이상 (예: B30952, A62091, MQC010208, E70094)
const MGMT_NO_PATTERN = /^[A-Za-z]{1,3}\d{4,}$/

// 헤더 키워드를 포함하는 헤더 행 인덱스 탐지 (없으면 -1)
function detectHeaderRow(grid: Grid): number {
  for (let r = 0; r < Math.min(grid.length, 5); r++) {
    if (grid[r].some(cell => KEY_HEADER_KEYWORDS.some(kw => cell.replace(/\s/g, '').includes(kw)))) {
      return r
    }
  }
  return -1
}

// 교정관리번호 열 자동 탐지
// 1차: 각 열의 값 패턴 적중률(영문+숫자) → 최고 점수 열
// 보조: 헤더 행에 "관리번호" 키워드가 있으면 해당 열에 가점
function detectKeyColumn(grid: Grid, headerRowIdx: number): number | null {
  const colCount = grid.reduce((m, r) => Math.max(m, r.length), 0)
  if (colCount === 0) return null

  let bestCol = -1
  let bestScore = -1

  for (let c = 0; c < colCount; c++) {
    // 데이터 행에서 패턴 적중률 계산 (헤더 행 제외)
    let total = 0
    let hit = 0
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRowIdx) continue
      const v = (grid[r][c] ?? '').trim()
      if (!v) continue
      total++
      if (MGMT_NO_PATTERN.test(v)) hit++
    }
    let score = total > 0 ? hit / total : 0

    // 헤더 키워드 가점: 해당 열 헤더가 "관리번호" 계열이면 +0.5
    if (headerRowIdx >= 0) {
      const header = (grid[headerRowIdx][c] ?? '').replace(/\s/g, '')
      if (KEY_HEADER_KEYWORDS.some(kw => header.includes(kw))) score += 0.5
    }

    if (score > bestScore) {
      bestScore = score
      bestCol = c
    }
  }

  // 패턴 적중도 키워드 가점도 전혀 없으면 자동선택 포기
  return bestScore > 0 ? bestCol : null
}

type Status = 'matched' | 'missing' | 'empty'
interface RowResult {
  status: Status          // empty = 데이터 행이 아님(헤더/빈 키)
  acptNo: string          // 마크애니 성적서 조회용 (matched일 때만 채워짐)
  접수일: string
  경과일: number | null
  담당자: string
  진행상태: string
}

export default function ReceptionCheck({ items }: { items: ReceptionItem[] | null }) {
  const { t } = useT()
  const rt = t.reception

  const [grid, setGrid] = useState<Grid | null>(null)
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(-1)
  const [keyCol, setKeyCol] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [markanyLoading, setMarkanyLoading] = useState<string | null>(null)  // 로딩 중인 acptNo

  const hasData = (items?.length ?? 0) > 0

  // k-tools custEqpmSrno 정규화 인덱스
  const ktoolsIndex = useMemo(() => {
    const map = new Map<string, ReceptionItem>()
    for (const it of items ?? []) {
      const k = normalizeKey(it.custEqpmSrno ?? '')
      if (k) map.set(k, it)
    }
    return map
  }, [items])

  // 그리드 각 행에 대한 대조 결과 (grid 행 인덱스 → RowResult). 붙여넣기 즉시 자동 계산.
  const rowResults = useMemo<RowResult[]>(() => {
    if (!grid || keyCol === null) return []
    return grid.map((row, r) => {
      const raw = (row[keyCol] ?? '').trim()
      const norm = normalizeKey(raw)
      const isHeaderKw = KEY_HEADER_KEYWORDS.some(k => norm.includes(normalizeKey(k)))
      if (r === headerRowIdx || !norm || isHeaderKw) {
        return { status: 'empty' as const, acptNo: '', 접수일: '', 경과일: null, 담당자: '', 진행상태: '' }
      }
      const hit = ktoolsIndex.get(norm)
      return {
        status: (hit ? 'matched' : 'missing') as Status,
        acptNo: hit?.acptNo || '',
        접수일: hit?.rcpnYmd || '',
        경과일: hit ? elapsedDays(hit.rcpnYmd) : null,
        담당자: hit?.mngmRsprNm || '',
        진행상태: hit?.pgstNm || '',
      }
    })
  }, [grid, keyCol, headerRowIdx, ktoolsIndex])

  // 요약: 중복 키 제외하고 집계
  const summary = useMemo(() => {
    if (!grid || keyCol === null) return null
    const seen = new Set<string>()
    let matched = 0, missing = 0
    grid.forEach((row, r) => {
      if (rowResults[r]?.status === 'empty') return
      const norm = normalizeKey((row[keyCol] ?? '').trim())
      if (seen.has(norm)) return
      seen.add(norm)
      if (rowResults[r].status === 'matched') matched++
      else if (rowResults[r].status === 'missing') missing++
    })
    return { total: matched + missing, matched, missing }
  }, [grid, keyCol, rowResults])

  // 빠른 조회: 입력값이 관리번호(custEqpmSrno) 또는 기기번호(mctlNo)에 부분일치하는 항목
  const quickResults = useMemo(() => {
    const q = normalizeKey(query.trim())
    if (!q) return null
    return (items ?? []).filter(it =>
      normalizeKey(it.custEqpmSrno ?? '').includes(q) ||
      normalizeKey(it.mctlNo ?? '').includes(q)
    )
  }, [query, items])

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const plain = e.clipboardData.getData('text/plain')

    let parsed = html ? parseHtmlTable(html) : null
    if (!parsed) parsed = parsePlainTable(plain)
    // 탭이 전혀 없는 단일 컬럼 텍스트 → 줄 단위 1열 그리드로 폴백
    if (!parsed) {
      const lines = plain.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length > 0) parsed = lines.map(l => [l])
    }
    if (!parsed) return

    const g = normalizeGrid(parsed)
    setGrid(g)

    const hRow = detectHeaderRow(g)
    setHeaderRowIdx(hRow)
    setKeyCol(detectKeyColumn(g, hRow))
  }

  function updateCell(r: number, c: number, value: string) {
    setGrid(prev => {
      if (!prev) return prev
      const next = prev.map(row => row.slice())
      next[r][c] = value
      return next
    })
  }

  function handleClear() {
    setGrid(null)
    setHeaderRowIdx(-1)
    setKeyCol(null)
    setEditing(null)
  }

  const colCount = grid ? (grid[0]?.length ?? 0) : 0

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{rt.title}</h1>
          <p className="text-sm text-slate-500 mt-1">{rt.desc}</p>
        </div>
        <button
          onClick={() => setHelpOpen(true)}
          title="사용 가이드 열기"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 hover:border-slate-400 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          도움말
        </button>
      </div>

      <ReceptionCheckHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {!hasData && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
          {rt.noData}
        </div>
      )}

      {/* ① 빠른 조회 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-white text-xs font-bold shrink-0">1</span>
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h2 className="text-base font-bold text-slate-800">{rt.quickTitle}</h2>
            <p className="text-xs text-slate-400">{rt.quickHint}</p>
          </div>
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={rt.quickPlaceholder}
            disabled={!hasData}
            className="w-full pl-10 pr-9 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:bg-slate-50 disabled:text-slate-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={rt.clear}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {quickResults !== null && (
          quickResults.length === 0 ? (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {fmt(rt.quickNoMatch, query.trim())}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">{fmt(rt.quickResultCount, quickResults.length)}</p>
              <div className="overflow-auto border border-slate-200 rounded-lg max-h-[320px]">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide sticky top-0">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{rt.colMgmtNo}</th>
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{t.table.mctlNo}</th>
                      <th className="text-left font-semibold px-4 py-2.5">{rt.colEquip}</th>
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{rt.colRcpnYmd}</th>
                      <th className="text-center font-semibold px-4 py-2.5 whitespace-nowrap">{rt.colElapsed}</th>
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{rt.colManager}</th>
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{rt.colProgress}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quickResults.map((it, i) => {
                      const days = elapsedDays(it.rcpnYmd)
                      const elapsedCls =
                        days === null ? 'text-slate-400'
                        : days > 30 ? 'bg-red-100 text-red-700'
                        : days > 14 ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-600'
                      return (
                        <tr key={`${it.custEqpmSrno}-${it.mctlNo}-${i}`} className="border-t border-gray-100">
                          <td className="px-4 py-2.5 font-mono text-slate-700 whitespace-nowrap">{it.custEqpmSrno || '-'}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">{it.mctlNo || '-'}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            <span className="text-slate-800 font-medium">{it.entpPrdNm || '-'}</span>
                            {it.prdnCmpnNm && <span className="text-slate-400 ml-2">{it.prdnCmpnNm}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{it.rcpnYmd || '-'}</td>
                          <td className="px-4 py-2.5 text-center whitespace-nowrap">
                            {days === null ? (
                              <span className="text-slate-400">-</span>
                            ) : (
                              <span className={`inline-block min-w-[36px] px-1.5 py-0.5 rounded font-medium ${elapsedCls}`}>
                                {days}{rt.daysUnit}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{it.mngmRsprNm || '-'}</td>
                          <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{it.pgstNm || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>

      {/* 구분선 (또는) */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{rt.orDivider}</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* ② 메일 표 대조 */}
      <div className="flex items-center gap-2.5 px-1">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-white text-xs font-bold shrink-0">2</span>
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <h2 className="text-base font-bold text-slate-800">{rt.pasteTitle}</h2>
          <p className="text-xs text-slate-400">{rt.pasteSubtitle}</p>
        </div>
      </div>

      {/* 붙여넣기 전: 안내 + 드롭존 */}
      {!grid ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
          <p className="text-sm text-slate-500">{rt.pasteHint}</p>
          <div
            onPaste={handlePaste}
            tabIndex={0}
            role="textbox"
            aria-label={rt.pasteBox}
            className="min-h-[160px] rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-center cursor-text focus:outline-none focus:border-slate-500 focus:bg-slate-50 transition-colors"
          >
            <svg className="w-8 h-8 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-slate-500 font-medium">{rt.pasteBox}</p>
            <p className="text-xs text-slate-400 mt-1">{rt.pasteBoxSub}</p>
          </div>
        </div>
      ) : (
        <>
          {/* 요약 카운터 (표 위) */}
          {summary && (
            <div className="flex flex-wrap items-center gap-3">
              <SummaryChip label={rt.summaryRequested} value={summary.total} tone="neutral" />
              <SummaryChip label={rt.summaryMatched} value={summary.matched} tone="ok" />
              <SummaryChip label={rt.summaryMissing} value={summary.missing} tone={summary.missing > 0 ? 'danger' : 'neutral'} />
              {summary.missing === 0 && summary.total > 0 && (
                <span className="text-sm text-green-600 ml-1">{rt.allMatched}</span>
              )}
            </div>
          )}

          {/* 통합 표: 원본 그리드 + 결과 컬럼(우측 고정) */}
          <div className="rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-slate-600">{rt.columnPick}</p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{fmt(rt.rowsCols, grid.length, colCount)}</span>
                <button
                  onClick={handleClear}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-slate-50 hover:text-slate-800 hover:border-gray-400 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {rt.clear}
                </button>
              </div>
            </div>

            <div className="inline-block max-w-full overflow-auto border border-slate-200 rounded-lg max-h-[600px] bg-white shadow-sm">
              <table className="text-xs border-collapse">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className="bg-slate-100 border-b border-r border-slate-200 px-2 py-1.5 text-slate-400 font-normal w-10 sticky left-0 z-10">#</th>
                    {/* 원본 열 머리글 (클릭으로 키 열 지정) */}
                    {Array.from({ length: colCount }, (_, c) => {
                      const isKey = keyCol === c
                      return (
                        <th
                          key={c}
                          onClick={() => setKeyCol(c)}
                          className={`border-b border-r border-slate-200 px-3 py-1.5 cursor-pointer select-none whitespace-nowrap transition-colors ${
                            isKey
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'bg-slate-100 text-slate-500 font-medium hover:bg-blue-50 hover:text-blue-700'
                          }`}
                          title={fmt(rt.colHeaderN, c + 1)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {isKey && (
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                              </svg>
                            )}
                            {fmt(rt.colHeaderN, c + 1)}
                          </span>
                        </th>
                      )
                    })}
                    {/* 결과 열 머리글 (우측 고정, 좌측 굵은 경계) */}
                    <th className="bg-slate-700 text-white border-b border-slate-600 px-3 py-1.5 whitespace-nowrap font-semibold border-l-2 border-l-slate-400">{rt.colStatus}</th>
                    <th className="bg-slate-700 text-white border-b border-slate-600 px-3 py-1.5 whitespace-nowrap font-semibold">{rt.colRcpnYmd}</th>
                    <th className="bg-slate-700 text-white border-b border-slate-600 px-3 py-1.5 whitespace-nowrap font-semibold text-center">{rt.colElapsed}</th>
                    <th className="bg-slate-700 text-white border-b border-slate-600 px-3 py-1.5 whitespace-nowrap font-semibold">{rt.colManager}</th>
                    <th className="bg-slate-700 text-white border-b border-slate-600 px-3 py-1.5 whitespace-nowrap font-semibold">{rt.colProgress}</th>
                    <th className="bg-slate-700 text-white border-b border-slate-600 px-3 py-1.5 whitespace-nowrap font-semibold text-center">성적서</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, r) => {
                    const isHeader = r === headerRowIdx
                    const res = rowResults[r]
                    const isMissing = res?.status === 'missing'
                    const isEmpty = !res || res.status === 'empty'
                    const days = res?.경과일 ?? null
                    const elapsedCls =
                      days === null ? 'text-slate-400'
                      : days > 30 ? 'bg-red-100 text-red-700'
                      : days > 14 ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600'
                    const rowBg = isHeader ? 'bg-amber-50' : isMissing ? 'bg-red-50' : 'odd:bg-white even:bg-slate-50/40'
                    return (
                      <tr key={r} className={rowBg}>
                        <td className="border-b border-r border-slate-200 px-2 py-1 text-slate-300 text-center sticky left-0 z-10 bg-inherit">
                          {r + 1}
                        </td>
                        {Array.from({ length: colCount }, (_, c) => {
                          const isKey = keyCol === c
                          const isEditing = editing?.r === r && editing?.c === c
                          const cellValue = row[c]
                          return (
                            <td
                              key={c}
                              onClick={() => { if (!isEditing) setEditing({ r, c }) }}
                              title={!isEditing && cellValue ? cellValue : undefined}
                              className={`border-b border-r border-slate-100 px-3 py-1 cursor-text max-w-[120px] ${
                                isKey ? 'bg-blue-50 text-blue-800 font-medium' : 'text-slate-600'
                              } ${isHeader ? 'font-semibold text-slate-700' : ''} ${
                                isEditing ? 'p-0' : 'hover:bg-blue-50/40'
                              }`}
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  value={cellValue}
                                  onChange={e => updateCell(r, c, e.target.value)}
                                  onBlur={() => setEditing(null)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === 'Escape') {
                                      e.preventDefault()
                                      setEditing(null)
                                    }
                                  }}
                                  className="w-full min-w-[80px] px-3 py-1 text-xs bg-white border-2 border-blue-500 rounded outline-none text-slate-800"
                                />
                              ) : (
                                <div className="truncate">{cellValue}</div>
                              )}
                            </td>
                          )
                        })}
                        {/* 결과 셀 */}
                        {isHeader ? (
                          <td colSpan={6} className="border-b border-slate-100 px-3 py-1 text-slate-300 border-l-2 border-l-slate-300" />
                        ) : isEmpty ? (
                          <td colSpan={6} className="border-b border-slate-100 px-3 py-1 border-l-2 border-l-slate-300" />
                        ) : (
                          <>
                            <td className="border-b border-slate-100 px-3 py-1 whitespace-nowrap border-l-2 border-l-slate-300">
                              {isMissing ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  {rt.statusMissing}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                  {rt.statusMatched}
                                </span>
                              )}
                            </td>
                            <td className="border-b border-slate-100 px-3 py-1 whitespace-nowrap text-slate-600">
                              {isMissing ? <span className="text-slate-400">-</span> : (res.접수일 || '-')}
                            </td>
                            <td className="border-b border-slate-100 px-3 py-1 whitespace-nowrap text-center">
                              {isMissing || days === null ? (
                                <span className="text-slate-400">-</span>
                              ) : (
                                <span className={`inline-block min-w-[36px] px-1.5 py-0.5 rounded font-medium ${elapsedCls}`}>
                                  {days}{rt.daysUnit}
                                </span>
                              )}
                            </td>
                            <td className="border-b border-slate-100 px-3 py-1 whitespace-nowrap text-slate-600">
                              {isMissing ? <span className="text-slate-400">-</span> : (res.담당자 || '-')}
                            </td>
                            <td className="border-b border-slate-100 px-3 py-1 whitespace-nowrap text-slate-600">
                              {isMissing ? <span className="text-slate-400">-</span> : (res.진행상태 || '-')}
                            </td>
                            <td className="border-b border-slate-100 px-3 py-1 whitespace-nowrap text-center">
                              {(() => {
                                if (isMissing || !res.acptNo) return <span className="text-slate-300">-</span>
                                const isCompleted = (res.진행상태 || '').includes('완료')
                                if (!isCompleted) return <span className="text-slate-300">-</span>
                                const isLoading = markanyLoading === res.acptNo
                                return (
                                  <button
                                    disabled={!!markanyLoading}
                                    title="마크애니 성적서 보기"
                                    className="inline-flex items-center justify-center p-1 rounded hover:bg-indigo-50 text-indigo-500 hover:text-indigo-700 transition-colors disabled:opacity-50"
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      if (markanyLoading) return
                                      setMarkanyLoading(res.acptNo)
                                      try {
                                        const r = await fetch(`/api/ktools/edms?acptNo=${encodeURIComponent(res.acptNo)}`)
                                        if (!r.ok) {
                                          const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
                                          alert(err.error || '성적서 조회 실패')
                                          return
                                        }
                                        const data = await r.json()
                                        window.open(data.url, '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes')
                                      } catch {
                                        alert('성적서 열기 중 오류가 발생했습니다.')
                                      } finally {
                                        setMarkanyLoading(null)
                                      }
                                    }}
                                  >
                                    {isLoading ? (
                                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                      </svg>
                                    ) : (
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    )}
                                  </button>
                                )
                              })()}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {keyCol === null && (
              <p className="text-xs text-amber-600">{rt.noKeyColumn}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'ok' | 'danger' }) {
  const styles = {
    neutral: 'bg-white border-gray-100',
    ok: 'bg-white border-gray-100',
    danger: 'bg-red-50 border-red-200',
  }[tone]
  const valueColor = {
    neutral: 'text-slate-800',
    ok: 'text-emerald-600',
    danger: 'text-red-600',
  }[tone]
  return (
    <div className={`rounded-xl shadow-sm border px-5 py-3 min-w-[120px] ${styles}`}>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value.toLocaleString()}</p>
    </div>
  )
}
