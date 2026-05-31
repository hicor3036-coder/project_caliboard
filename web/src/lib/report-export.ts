/**
 * ISO 10012 경영검토 보고서 내보내기 (PDF + Excel)
 */

import type { AnalysisData } from '@/components/management-report'
import type { ReportData } from '@/app/api/supabase/report-stats/route'
import type { Dict } from '@/lib/i18n'
import type { Worksheet, FillPattern, Font, Borders } from 'exceljs'

/* ── PDF (브라우저 인쇄) ── */

export function triggerPrintPdf() {
  requestAnimationFrame(() => window.print())
}

/* ── Excel (ExcelJS 클라이언트) ── */

export interface ExcelExportParams {
  analysisData: AnalysisData
  reportData: ReportData
  t: Dict
  lang: string
  // 사전 계산된 통계 (management-report.tsx useMemo에서 전달)
  caStats: { total: number; open: number; closed: number; avgDays: number }
  quarantineCount: number
  iaStats: { total: number; incomplete: number }
  upcomingByZone: Record<string, number>
  equipStats: { manufacturers: number; managers: number }
}

export async function generateExcelReport(params: ExcelExportParams) {
  const { analysisData, reportData, t, lang, caStats, quarantineCount, iaStats, upcomingByZone, equipStats } = params
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CaliBoard'
  wb.created = new Date()

  const totalEquip = analysisData.summary.총건수
  const analyzed = reportData.certStats.totalCached
  const coveragePct = totalEquip > 0 ? Math.round((analyzed / totalEquip) * 100) : 0
  const passRate = analyzed > 0 ? Math.round((reportData.certStats.passCount / analyzed) * 100) : 0

  // ── 공통 스타일 ──
  const HEADER_FILL: FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  const HEADER_FONT: Partial<Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  const SECTION_FILL: FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
  const SECTION_FONT: Partial<Font> = { bold: true, size: 11 }
  const THIN_BORDER: Partial<Borders> = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  }

  function addSectionTitle(ws: Worksheet, row: number, title: string, colSpan: number) {
    ws.mergeCells(row, 1, row, colSpan)
    const cell = ws.getCell(row, 1)
    cell.value = title
    cell.fill = SECTION_FILL
    cell.font = SECTION_FONT
    cell.border = THIN_BORDER
  }

  function addTableHeader(ws: Worksheet, row: number, headers: string[]) {
    headers.forEach((h, i) => {
      const cell = ws.getCell(row, i + 1)
      cell.value = h
      cell.fill = HEADER_FILL
      cell.font = HEADER_FONT
      cell.border = THIN_BORDER
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
  }

  function addKpiRow(ws: Worksheet, row: number, label: string, value: string | number) {
    const labelCell = ws.getCell(row, 1)
    labelCell.value = label
    labelCell.font = { bold: true }
    labelCell.border = THIN_BORDER
    const valCell = ws.getCell(row, 2)
    valCell.value = value
    valCell.alignment = { horizontal: 'right' }
    valCell.border = THIN_BORDER
  }

  function autoWidth(ws: Worksheet, minWidth = 12, maxWidth = 40) {
    ws.columns.forEach((col: Partial<import('exceljs').Column>) => {
      let max = minWidth
      col.eachCell?.({ includeEmpty: false }, (cell: import('exceljs').Cell) => {
        const len = String(cell.value ?? '').length
        if (len > max) max = len
      })
      if (col.width !== undefined) col.width = Math.min(max + 2, maxWidth)
      else (col as { width?: number }).width = Math.min(max + 2, maxWidth)
    })
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sheet 1: 요약
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const wsSummary = wb.addWorksheet(t.report.sheetSummary)
  // 보고서 제목
  wsSummary.mergeCells('A1:D1')
  const titleCell = wsSummary.getCell('A1')
  titleCell.value = t.report.printHeader
  titleCell.font = { bold: true, size: 14 }
  titleCell.alignment = { horizontal: 'center' }

  wsSummary.mergeCells('A2:D2')
  const dateCell = wsSummary.getCell('A2')
  dateCell.value = `${t.report.printDate}: ${new Date().toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US')}  |  ${analysisData.summary.데이터시점}`
  dateCell.font = { size: 10, color: { argb: 'FF64748B' } }
  dateCell.alignment = { horizontal: 'center' }

  // KPI
  let r = 4
  addSectionTitle(wsSummary, r, 'KPI', 2); r++
  addKpiRow(wsSummary, r, t.report.totalEquip, totalEquip); r++
  addKpiRow(wsSummary, r, t.report.analyzed, `${analyzed} (${coveragePct}%)`); r++
  addKpiRow(wsSummary, r, t.report.passRate, `${passRate}%`); r++
  addKpiRow(wsSummary, r, t.report.avgDays, `${Math.round(analysisData.summary.평균소요일)} ${t.common.days}`); r++
  autoWidth(wsSummary)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sheet 2: §5 경영책임
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const wsS5 = wb.addWorksheet(t.report.sheetS5)
  r = 1

  // §7.1.1 + §8.2.4 적합성
  addSectionTitle(wsS5, r, `§7.1.1/§8.2.4 ${t.report.sectionConformity}`, 4); r++
  addTableHeader(wsS5, r, [t.report.passCount, t.report.failCount, t.report.noJudgment, t.report.totalEquip]); r++
  ;[reportData.certStats.passCount, reportData.certStats.failCount, reportData.certStats.noJudgment, analyzed].forEach((v, i) => {
    const cell = wsS5.getCell(r, i + 1)
    cell.value = v
    cell.alignment = { horizontal: 'center' }
    cell.border = THIN_BORDER
  }); r += 2

  // Guard Band
  addSectionTitle(wsS5, r, `§7.3.1 ${t.report.guardBandDist}`, 5); r++
  addTableHeader(wsS5, r, [t.report.gbConformant, t.report.gbConditionalPass, t.report.gbConditionalFail, t.report.gbNonConformant, t.report.gbNoData]); r++
  const gbStats = reportData.guardBandStats
  ;[gbStats.conformant, gbStats.conditionalPass, gbStats.conditionalFail, gbStats.nonConformant, gbStats.noData].forEach((v, i) => {
    const cell = wsS5.getCell(r, i + 1)
    cell.value = v
    cell.alignment = { horizontal: 'center' }
    cell.border = THIN_BORDER
  }); r += 2

  // §8.4.2 시정조치
  addSectionTitle(wsS5, r, `§8.4.2 ${t.report.correctiveAction}`, 3); r++
  addTableHeader(wsS5, r, [t.report.caOpenCount, t.report.caClosed, t.report.caAvgDays]); r++
  ;[caStats.open, caStats.closed, `${caStats.avgDays} ${t.common.days}`].forEach((v, i) => {
    const cell = wsS5.getCell(r, i + 1)
    cell.value = v
    cell.alignment = { horizontal: 'center' }
    cell.border = THIN_BORDER
  }); r += 2

  // §8.2.4 월별접수추이
  addSectionTitle(wsS5, r, `§8.2.4 ${t.chart.monthlyTrend}`, 2); r++
  addTableHeader(wsS5, r, [lang === 'ko' ? '월' : 'Month', lang === 'ko' ? '건수' : 'Count']); r++
  for (const item of analysisData.월별접수추이) {
    wsS5.getCell(r, 1).value = item.month
    wsS5.getCell(r, 1).border = THIN_BORDER
    wsS5.getCell(r, 2).value = item.건수
    wsS5.getCell(r, 2).alignment = { horizontal: 'right' }
    wsS5.getCell(r, 2).border = THIN_BORDER
    r++
  }; r++

  // 진행상태 분포
  addSectionTitle(wsS5, r, `§8.2.4 ${t.chart.statusDist}`, 2); r++
  addTableHeader(wsS5, r, [lang === 'ko' ? '상태' : 'Status', lang === 'ko' ? '건수' : 'Count']); r++
  for (const item of analysisData.진행상태분포) {
    wsS5.getCell(r, 1).value = item.label
    wsS5.getCell(r, 1).border = THIN_BORDER
    wsS5.getCell(r, 2).value = item.value
    wsS5.getCell(r, 2).alignment = { horizontal: 'right' }
    wsS5.getCell(r, 2).border = THIN_BORDER
    r++
  }; r++

  // 차기교정 구간
  addSectionTitle(wsS5, r, `§7.1.2 ${t.report.upcomingSummary}`, 2); r++
  addTableHeader(wsS5, r, [lang === 'ko' ? '구간' : 'Zone', lang === 'ko' ? '건수' : 'Count']); r++
  for (const [zone, count] of Object.entries(upcomingByZone)) {
    wsS5.getCell(r, 1).value = zone
    wsS5.getCell(r, 1).border = THIN_BORDER
    wsS5.getCell(r, 2).value = count
    wsS5.getCell(r, 2).alignment = { horizontal: 'right' }
    wsS5.getCell(r, 2).border = THIN_BORDER
    r++
  }; r++

  // 미처리 현황
  addSectionTitle(wsS5, r, `§8.2.4 ${t.report.unprocessedSummary}`, 2); r++
  addKpiRow(wsS5, r, lang === 'ko' ? '미처리 건수' : 'Unprocessed Count', analysisData.summary.미처리건수); r++
  const avgStay = analysisData.미처리현황.length > 0
    ? Math.round(analysisData.미처리현황.reduce((s, i) => s + i.체류일수, 0) / analysisData.미처리현황.length)
    : 0
  addKpiRow(wsS5, r, lang === 'ko' ? '평균 체류일' : 'Avg. Stay (days)', avgStay); r++

  autoWidth(wsS5)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sheet 3: §7 계량확인
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const wsS7 = wb.addWorksheet(t.report.sheetS7)
  r = 1

  // §7.1 장비 식별
  addSectionTitle(wsS7, r, `§7.1 ${t.report.s71Title}`, 2); r++
  addKpiRow(wsS7, r, t.report.totalEquip, totalEquip); r++
  addKpiRow(wsS7, r, t.report.s71Manufacturers, equipStats.manufacturers); r++
  addKpiRow(wsS7, r, t.report.s71Managers, equipStats.managers); r += 2

  // 교정주기 구간
  addSectionTitle(wsS7, r, `§7.1 ${t.report.s71CalCycleSummary}`, 2); r++
  addTableHeader(wsS7, r, [lang === 'ko' ? '구간' : 'Zone', lang === 'ko' ? '건수' : 'Count']); r++
  for (const [zone, count] of Object.entries(upcomingByZone)) {
    wsS7.getCell(r, 1).value = zone
    wsS7.getCell(r, 1).border = THIN_BORDER
    wsS7.getCell(r, 2).value = count
    wsS7.getCell(r, 2).alignment = { horizontal: 'right' }
    wsS7.getCell(r, 2).border = THIN_BORDER
    r++
  }; r++

  // §7.2 소급성
  addSectionTitle(wsS7, r, `§7.2 ${t.report.s72Title}`, 2); r++
  const refStdCount = reportData.calibrationLabStats.reduce((s, l) => s + l.certCount, 0)
  addKpiRow(wsS7, r, t.report.s72RefStdCount, refStdCount); r++
  addKpiRow(wsS7, r, t.report.s72CalLabCount, reportData.calibrationLabStats.length); r += 2

  // §7.3 U/T 분포
  addSectionTitle(wsS7, r, `§7.3 ${t.report.sectionUncertainty}`, 2); r++
  const ut = reportData.utRatioDistribution
  addKpiRow(wsS7, r, t.report.utSafe, ut.safe); r++
  addKpiRow(wsS7, r, t.report.utWarning, ut.warning); r++
  addKpiRow(wsS7, r, t.report.utDanger, ut.danger); r++
  addKpiRow(wsS7, r, t.report.utNoData, ut.noData); r++

  autoWidth(wsS7)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sheet 4: §8 분석개선
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const wsS8 = wb.addWorksheet(t.report.sheetS8)
  r = 1

  addSectionTitle(wsS8, r, `§8.3 ${t.report.s83Title}`, 2); r++
  addKpiRow(wsS8, r, t.report.quarantineCount, quarantineCount); r++
  addKpiRow(wsS8, r, t.report.caOpenCount, caStats.open); r++
  addKpiRow(wsS8, r, t.report.iaIncomplete, iaStats.incomplete); r++

  autoWidth(wsS8)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sheet 5: 교정기관평가
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const wsLab = wb.addWorksheet(t.report.sheetLabEval)
  r = 1

  addSectionTitle(wsLab, r, `§6.4 ${t.report.sectionSupplier}`, 4); r++
  addTableHeader(wsLab, r, [t.report.labName, t.report.certCount, t.detail.labPassRate, t.detail.labAvgUt]); r++

  for (const lab of reportData.calibrationLabStats) {
    wsLab.getCell(r, 1).value = lab.name
    wsLab.getCell(r, 1).border = THIN_BORDER
    wsLab.getCell(r, 2).value = lab.certCount
    wsLab.getCell(r, 2).alignment = { horizontal: 'center' }
    wsLab.getCell(r, 2).border = THIN_BORDER
    wsLab.getCell(r, 3).value = `${lab.passRate}%`
    wsLab.getCell(r, 3).alignment = { horizontal: 'center' }
    wsLab.getCell(r, 3).border = THIN_BORDER
    // 적합률 색상
    if (lab.passRate < 70) wsLab.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
    else if (lab.passRate < 90) wsLab.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } }
    wsLab.getCell(r, 4).value = lab.avgUtRatio > 0 ? `${lab.avgUtRatio}%` : '-'
    wsLab.getCell(r, 4).alignment = { horizontal: 'center' }
    wsLab.getCell(r, 4).border = THIN_BORDER
    r++
  }

  // autoFilter
  if (reportData.calibrationLabStats.length > 0) {
    wsLab.autoFilter = { from: { row: 2, column: 1 }, to: { row: r - 1, column: 4 } }
  }
  autoWidth(wsLab)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sheet 6: 부적합장비
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const wsNC = wb.addWorksheet(t.report.sheetNonConformant)
  r = 1

  addSectionTitle(wsNC, r, `§8.3 ${t.report.sectionNonConformant}`, 5); r++
  addTableHeader(wsNC, r, [t.table.acptNo, t.report.equipName, t.report.verdict, t.report.guardBand, t.report.calDate]); r++

  const gbLabelMap: Record<string, string> = {
    'conformant': t.report.gbConformant,
    'conditional-pass': t.report.gbConditionalPass,
    'conditional-fail': t.report.gbConditionalFail,
    'non-conformant': t.report.gbNonConformant,
  }

  const GB_FILLS: Record<string, FillPattern> = {
    'conditional-pass': { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } },
    'conditional-fail': { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } },
    'non-conformant': { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } },
  }

  for (const item of reportData.nonConformantList) {
    wsNC.getCell(r, 1).value = item.acptNo
    wsNC.getCell(r, 1).font = { name: 'Consolas', size: 10 }
    wsNC.getCell(r, 1).border = THIN_BORDER
    wsNC.getCell(r, 2).value = item.장비명 ?? '-'
    wsNC.getCell(r, 2).border = THIN_BORDER
    wsNC.getCell(r, 3).value = item.판정
    wsNC.getCell(r, 3).alignment = { horizontal: 'center' }
    wsNC.getCell(r, 3).border = THIN_BORDER
    if (item.판정 === 'FAIL') wsNC.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
    wsNC.getCell(r, 4).value = item.guardBand ? (gbLabelMap[item.guardBand] ?? item.guardBand) : '-'
    wsNC.getCell(r, 4).alignment = { horizontal: 'center' }
    wsNC.getCell(r, 4).border = THIN_BORDER
    if (item.guardBand && GB_FILLS[item.guardBand]) wsNC.getCell(r, 4).fill = GB_FILLS[item.guardBand]
    wsNC.getCell(r, 5).value = item.교정일 ?? '-'
    wsNC.getCell(r, 5).alignment = { horizontal: 'center' }
    wsNC.getCell(r, 5).border = THIN_BORDER
    r++
  }

  if (reportData.nonConformantList.length > 0) {
    wsNC.autoFilter = { from: { row: 2, column: 1 }, to: { row: r - 1, column: 5 } }
  }
  autoWidth(wsNC)

  // ── 다운로드 ──
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${t.report.exportFilename}_${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
