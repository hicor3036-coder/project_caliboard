'use client'

import { useState, useEffect, useMemo } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { StatusPieChart, MonthlyBarChart, HorizontalBarChart } from '@/components/charts'
import { useT, fmt } from '@/lib/i18n'
import type { ReportData } from '@/app/api/ktools/report/route'
import { loadCorrectiveActions, loadImpactAssessments, type CorrectiveAction, type ImpactAssessment } from './equipment-detail/tab-nonconformity'
import { type EquipStatusValue } from '@/lib/equipment-status'
import { triggerPrintPdf, generateExcelReport } from '@/lib/report-export'

/* ── AnalysisData 타입 (page.tsx에서 전달) ── */
interface EquipmentItem {
  acptNo: string; entpPrdNm: string; prdnCmpnNm: string
  stszNm: string; mctlNo: string; custEqpmSrno: string
  rcpnYmd: string; pgstNm: string; mngmRsprNm: string
  nxtrExrsYmd: string; exrsWrtnYmd: string; groupNm: string; groupCnt: number
}

export interface AnalysisData {
  summary: {
    총건수: number
    미처리건수: number
    교정임박건수: number
    평균소요일: number
    데이터시점: string
  }
  전체장비: EquipmentItem[]
  미처리현황: Array<{ 체류일수: number }>
  차기교정임박: {
    평균소요일: number; 여유일: number
    장기경과: number; 만료: number; d30: number; d60: number; d90: number
    items: Array<{ 구간: string }>
    제조사별: { label: string; value: number }[]
    시급건수: number
  }
  진행상태분포: { label: string; value: number }[]
  월별접수추이: { month: string; 건수: number }[]
  제조사별분포: { label: string; value: number }[]
  담당자별처리량: { label: string; value: number }[]
}

/* ── 차트 색상 ── */
const PASS_COLOR = '#22c55e'
const FAIL_COLOR = '#ef4444'
const NOJUDGE_COLOR = '#94a3b8'

const GB_COLORS: Record<string, string> = {
  conformant: '#22c55e',
  conditionalPass: '#f59e0b',
  conditionalFail: '#f97316',
  nonConformant: '#ef4444',
  noData: '#cbd5e1',
}

const UT_COLORS: Record<string, string> = {
  safe: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  noData: '#cbd5e1',
}

/* ── 커스텀 툴팁 ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-slate-700">
      {payload.map((p: { name?: string; value: number }, i: number) => (
        <p key={i} className="font-medium">
          {p.name}: <span className="text-blue-300">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

/* ── 섹션 헤더 ── */
function SectionHeader({ title, sub, requirement }: { title: string; sub: string; requirement?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-400">{sub}</p>
      {requirement && (
        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{requirement}</p>
      )}
    </div>
  )
}

/* ── 카드 래퍼 ── */
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-6 print-avoid-break ${className}`}>
      {children}
    </div>
  )
}

/* ── ISO 조항 그룹 헤더 ── */
function ClauseGroup({ clause, title, children }: { clause: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pt-6 first:pt-0">
        <span className="px-2.5 py-1 text-xs font-bold bg-slate-800 text-white rounded-md shrink-0">{clause}</span>
        <h2 className="text-lg font-bold text-slate-800 shrink-0">{title}</h2>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      {children}
    </div>
  )
}

/* ── 미니 도넛 차트 ── */
function MiniDonut({ data, colors, centerLabel }: {
  data: { name: string; value: number }[]
  colors: string[]
  centerLabel?: string
}) {
  const filtered = data.filter(d => d.value > 0)
  if (filtered.length === 0) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">No Data</div>
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={65}
          paddingAngle={2}
          strokeWidth={0}
        >
          {filtered.map((entry, i) => {
            const originalIdx = data.findIndex(d => d.name === entry.name)
            return <Cell key={i} fill={colors[originalIdx] ?? '#94a3b8'} />
          })}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
        {centerLabel && (
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="text-2xl font-bold fill-slate-700">
            {centerLabel}
          </text>
        )}
      </PieChart>
    </ResponsiveContainer>
  )
}

/* ── 메인 컴포넌트 ── */
export default function ManagementReport({ analysisData, onOpenDetail }: {
  analysisData: AnalysisData
  onOpenDetail: (groupNm: string, equipmentName: string) => void
}) {
  const { t, lang } = useT()
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/ktools/report')
      .then(r => r.json())
      .then((data: ReportData) => { if (!cancelled) setReportData(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const totalEquip = analysisData.summary.총건수
  const analyzed = reportData?.certStats.totalCached ?? 0
  const coveragePct = totalEquip > 0 ? Math.round((analyzed / totalEquip) * 100) : 0

  // 적합률
  const passRate = useMemo(() => {
    if (!reportData || reportData.certStats.totalCached === 0) return '-'
    const { passCount, totalCached } = reportData.certStats
    return `${Math.round((passCount / totalCached) * 100)}%`
  }, [reportData])

  // 평균 체류일
  const avgStay = useMemo(() => {
    const items = analysisData.미처리현황
    if (items.length === 0) return 0
    return Math.round(items.reduce((s, i) => s + i.체류일수, 0) / items.length)
  }, [analysisData.미처리현황])

  // 차기교정 구간별 건수
  const upcomingByZone = useMemo(() => {
    const zones: Record<string, number> = {}
    for (const item of analysisData.차기교정임박.items) {
      zones[item.구간] = (zones[item.구간] ?? 0) + 1
    }
    return zones
  }, [analysisData.차기교정임박.items])

  // §7.1 장비 식별 현황 통계
  const equipStats = useMemo(() => {
    const mfrSet = new Set<string>()
    const mgrSet = new Set<string>()
    for (const item of analysisData.전체장비) {
      if (item.prdnCmpnNm) mfrSet.add(item.prdnCmpnNm)
      if (item.mngmRsprNm) mgrSet.add(item.mngmRsprNm)
    }
    return { manufacturers: mfrSet.size, managers: mgrSet.size }
  }, [analysisData.전체장비])

  // §7.2 기준기 통계
  const traceabilityStats = useMemo(() => {
    if (!reportData) return null
    return {
      refStdCount: reportData.calibrationLabStats.reduce((s, l) => s + l.certCount, 0),
      labCount: reportData.calibrationLabStats.length,
    }
  }, [reportData])

  // 적합/부적합 차트 데이터
  const conformityChartData = useMemo(() => {
    if (!reportData) return []
    return [
      { name: t.report.passCount, value: reportData.certStats.passCount },
      { name: t.report.failCount, value: reportData.certStats.failCount },
      { name: t.report.noJudgment, value: reportData.certStats.noJudgment },
    ]
  }, [reportData, t])

  // Guard Band 차트 데이터
  const gbChartData = useMemo(() => {
    if (!reportData) return []
    const { guardBandStats: g } = reportData
    return [
      { name: t.report.gbConformant, value: g.conformant, fill: GB_COLORS.conformant },
      { name: t.report.gbConditionalPass, value: g.conditionalPass, fill: GB_COLORS.conditionalPass },
      { name: t.report.gbConditionalFail, value: g.conditionalFail, fill: GB_COLORS.conditionalFail },
      { name: t.report.gbNonConformant, value: g.nonConformant, fill: GB_COLORS.nonConformant },
      { name: t.report.gbNoData, value: g.noData, fill: GB_COLORS.noData },
    ].filter(d => d.value > 0)
  }, [reportData, t])

  // U/T 차트 데이터
  const utChartData = useMemo(() => {
    if (!reportData) return []
    const u = reportData.utRatioDistribution
    return [
      { name: t.report.utSafe, value: u.safe },
      { name: t.report.utWarning, value: u.warning },
      { name: t.report.utDanger, value: u.danger },
      { name: t.report.utNoData, value: u.noData },
    ]
  }, [reportData, t])

  // 교정기관 차트 데이터
  const labChartData = useMemo(() => {
    if (!reportData) return []
    return reportData.calibrationLabStats.slice(0, 10).map(l => ({
      label: l.name,
      value: l.certCount,
    }))
  }, [reportData])

  // acptNo → 장비 정보 매핑 (상세페이지 연결용)
  const equipByAcptNo = useMemo(() => {
    const map = new Map<string, EquipmentItem>()
    for (const item of analysisData.전체장비) {
      map.set(item.acptNo, item)
    }
    return map
  }, [analysisData.전체장비])

  const handleRowClick = (acptNo: string) => {
    const item = equipByAcptNo.get(acptNo)
    if (item?.groupNm) {
      onOpenDetail(item.groupNm, item.entpPrdNm)
    }
  }

  // 시정조치 통계 (localStorage)
  const caStats = useMemo(() => {
    const all = loadCorrectiveActions()
    const open = all.filter(ca => ca.status !== 'closed').length
    const closed = all.filter(ca => ca.status === 'closed')
    const avgDays = closed.length > 0
      ? Math.round(closed.reduce((s, ca) => {
          const created = new Date(ca.createdAt).getTime()
          const closedAt = ca.closedAt ? new Date(ca.closedAt).getTime() : created
          return s + (closedAt - created) / 86_400_000
        }, 0) / closed.length)
      : 0
    return { total: all.length, open, closed: closed.length, avgDays }
  }, [])

  // 격리 장비 수 (localStorage)
  const quarantineCount = useMemo(() => {
    if (typeof window === 'undefined') return 0
    let count = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('equipStatus_') && !key.endsWith('_history')) {
        try {
          const rec = JSON.parse(localStorage.getItem(key)!)
          if (rec?.status === 'quarantine' || rec?.status === 'out-of-service') count++
        } catch {}
      }
    }
    return count
  }, [])

  // 영향평가 미완료 건수
  const iaStats = useMemo(() => {
    const all = loadImpactAssessments()
    const incomplete = all.filter(ia => !ia.impactScope && !ia.disposition).length
    return { total: all.length, incomplete }
  }, [])

  const hasCertData = analyzed > 0

  const handleExportPdf = () => triggerPrintPdf()

  const handleExportExcel = async () => {
    if (!reportData) return
    setExporting(true)
    try {
      await generateExcelReport({
        analysisData, reportData, t, lang,
        caStats, quarantineCount, iaStats, upcomingByZone, equipStats,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── 인쇄 전용 공식 헤더 ── */}
      <div className="print-only mb-6 border-b-2 border-slate-800 pb-4">
        <h1 className="text-xl font-bold text-center">{t.report.printHeader}</h1>
        <p className="text-sm text-center text-slate-600 mt-1">
          {t.report.printDate}: {new Date().toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US')}
        </p>
      </div>

      {/* ── 헤더 ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 print-avoid-break">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{t.report.title}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{t.report.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPdf}
              className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              disabled={loading}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
              {t.report.exportPdf}
            </button>
            <button
              onClick={handleExportExcel}
              className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
              disabled={loading || !reportData || exporting}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              {exporting ? '...' : t.report.exportExcel}
            </button>
            <span className="text-xs text-slate-500 ml-2 no-print">
              {analysisData.summary.데이터시점}
            </span>
          </div>
        </div>

        {/* 커버리지 진행바 */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>{t.report.coverage}</span>
            <span>{fmt(t.report.coverageDesc, totalEquip, analyzed, coveragePct)}</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full transition-all duration-500 bg-blue-500"
              style={{ width: `${Math.max(coveragePct, 1)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── ISO 10012 조항 커버리지 매트릭스 ── */}
      <CoverageMatrix />

      {/* ── 요약 KPI 카드 4개 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 print-grid-4">
        <SummaryCard label={t.report.totalEquip} value={totalEquip.toLocaleString()} color="bg-blue-500" />
        <SummaryCard label={t.report.analyzed} value={analyzed.toLocaleString()} color="bg-indigo-500" sub={`${coveragePct}%`} />
        <SummaryCard label={t.report.passRate} value={passRate} color={passRate === '-' ? 'bg-slate-400' : 'bg-green-500'} />
        <SummaryCard label={t.report.avgDays} value={String(Math.round(analysisData.summary.평균소요일))} color="bg-amber-500" sub={t.summary.days} />
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* §5 경영 책임                                     */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ClauseGroup clause="§5" title={t.report.clauseS5}>
        {/* §5.1~5.3 placeholder */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 print-grid-3">
          <PlaceholderCard clause="§5.1" title={t.report.s51Title} requirement={t.report.s51Req} />
          <PlaceholderCard clause="§5.2" title={t.report.s52Title} requirement={t.report.s52Req} />
          <PlaceholderCard clause="§5.3" title={t.report.s53Title} requirement={t.report.s53Req} />
        </div>

        {/* §7.1.1/§8.2.4 측정학적 확인 적합성 + Guard Band */}
        <Card>
          <SectionHeader title={t.report.sectionConformity} sub={t.report.sectionConformitySub} requirement={t.report.sectionConformityReq} />
          {hasCertData ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print-grid-2">
              {/* 적합/부적합 도넛 */}
              <div>
                <p className="text-sm font-medium text-slate-600 mb-2">{t.report.conformityChart}</p>
                <MiniDonut
                  data={conformityChartData}
                  colors={[PASS_COLOR, FAIL_COLOR, NOJUDGE_COLOR]}
                  centerLabel={passRate}
                />
                <div className="flex justify-center gap-3 mt-1">
                  {conformityChartData.filter(d => d.value > 0).map((d, i) => (
                    <div key={i} className="flex items-center gap-1 text-[11px] text-slate-600">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: [PASS_COLOR, FAIL_COLOR, NOJUDGE_COLOR][i] }} />
                      {d.name} {d.value}
                    </div>
                  ))}
                </div>
              </div>

              {/* Guard Band 분포 */}
              <div>
                <p className="text-sm font-medium text-slate-600 mb-2">{t.report.guardBandDist}</p>
                {gbChartData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={[{ name: 'GB', ...Object.fromEntries(gbChartData.map(d => [d.name, d.value])) }]} layout="vertical" margin={{ left: 0, right: 20 }}>
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" hide />
                        <Tooltip content={<ChartTooltip />} />
                        {gbChartData.map((d) => (
                          <Bar key={d.name} dataKey={d.name} stackId="gb" fill={d.fill} radius={0} barSize={28} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-3 mt-2">
                      {gbChartData.map((d) => (
                        <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                          {d.name} {d.value}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-[100px] text-slate-400 text-sm">{t.report.gbNoData}</div>
                )}
              </div>
            </div>
          ) : (
            <EmptyState message={t.report.noCertData} desc={t.report.noCertDataDesc} />
          )}
        </Card>

        {/* §8.4.2 시정조치 + §8.2.2 고객피드백 + §8.2.3 심사결과 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 print-grid-3">
          {/* §8.4.2 시정조치 — 실제 데이터 */}
          <Card className="!p-4">
            <div className="flex items-start gap-2 mb-3">
              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded shrink-0 mt-0.5">§8.4.2</span>
              <div>
                <p className="text-sm font-semibold text-slate-700">{t.report.correctiveAction}</p>
                <p className="text-[10px] text-slate-400">{t.report.correctiveActionSub}</p>
              </div>
            </div>
            {caStats.total > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-red-50 rounded-lg p-2 text-center border border-red-100">
                  <p className="text-xl font-bold text-red-700">{caStats.open}</p>
                  <p className="text-[10px] text-red-500">{t.report.caOpenCount}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-2 text-center border border-green-100">
                  <p className="text-xl font-bold text-green-700">{caStats.closed}</p>
                  <p className="text-[10px] text-green-500">{t.report.caClosed}</p>
                </div>
                {caStats.avgDays > 0 && (
                  <div className="col-span-2 bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <p className="text-sm font-semibold text-slate-700">{t.report.caAvgDays}: {caStats.avgDays}{t.common.days}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-300 italic">{t.detail.caNoItems}</p>
            )}
          </Card>
          <PlaceholderCard clause="§8.2.2" title={t.report.customerFeedback} requirement={t.report.customerFeedbackSub} />
          <PlaceholderCard clause="§8.2.3" title={t.report.auditResult} requirement={t.report.auditResultSub} />
        </div>

        {/* §8.2.4 측정 프로세스 성과 모니터링 */}
        <div>
          <SectionHeader title={t.report.sectionPerformance} sub={t.report.sectionPerformanceSub} requirement={t.report.sectionPerformanceReq} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid-2">
            <MonthlyBarChart data={analysisData.월별접수추이} />
            <StatusPieChart data={analysisData.진행상태분포} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 print-grid-2">
            {/* 차기교정 임박 요약 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">{t.report.upcomingSummary}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(upcomingByZone).map(([zone, count]) => (
                  <span key={zone} className={`px-2 py-1 rounded text-xs font-medium ${zoneColor(zone)}`}>
                    {zone} {count}
                  </span>
                ))}
                <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">
                  {fmt(t.report.urgentCount, analysisData.차기교정임박.시급건수)}
                </span>
              </div>
            </div>
            {/* 미처리 현황 요약 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">{t.report.unprocessedSummary}</p>
              <div className="flex items-baseline gap-4">
                <span className="text-2xl font-bold text-slate-800">{analysisData.summary.미처리건수}</span>
                <span className="text-xs text-slate-500">{fmt(t.report.avgStay, avgStay)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* §6.4 외부공급자 (교정기관) 품질평가 */}
        <Card>
          <SectionHeader title={t.report.sectionSupplier} sub={t.report.sectionSupplierSub} requirement={t.report.sectionSupplierReq} />
          {hasCertData && reportData && reportData.calibrationLabStats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="py-2 px-3">{t.report.labName}</th>
                    <th className="py-2 px-3 text-center">{t.report.certCount}</th>
                    <th className="py-2 px-3 text-center">{t.detail.labPassRate}</th>
                    <th className="py-2 px-3 text-center">{t.detail.labAvgUt}</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.calibrationLabStats.map(lab => (
                    <tr key={lab.name} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-slate-700">{lab.name}</td>
                      <td className="py-2 px-3 text-center text-slate-600">{lab.certCount}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                          lab.passRate >= 90 ? 'bg-green-100 text-green-700' :
                          lab.passRate >= 70 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {lab.passRate}%
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {lab.avgUtRatio > 0 ? (
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                            lab.avgUtRatio <= 33 ? 'bg-green-50 text-green-700' :
                            lab.avgUtRatio <= 50 ? 'bg-amber-50 text-amber-700' :
                            'bg-red-50 text-red-700'
                          }`}>
                            {lab.avgUtRatio}%
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message={hasCertData ? t.report.noSupplierData : t.report.noCertData} desc={hasCertData ? '' : t.report.noCertDataDesc} />
          )}
        </Card>
      </ClauseGroup>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* §6 자원 관리                                     */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ClauseGroup clause="§6" title={t.report.clauseS6}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid-2">
          <PlaceholderCard clause="§6.1" title={t.report.s61Title} requirement={t.report.s61Req} />
          <PlaceholderCard clause="§6.2" title={t.report.s62Title} requirement={t.report.s62Req} />
          <PlaceholderCard clause="§6.3" title={t.report.s63Title} requirement={t.report.s63Req} />
          <PlaceholderCard clause="§6.4" title={t.report.s64Title} requirement={t.report.s64Req} />
        </div>
      </ClauseGroup>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* §7 계량 확인 및 측정 프로세스                      */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="print-break-before">
      <ClauseGroup clause="§7" title={t.report.clauseS7}>
        {/* §7.1 계량 확인 — 장비 식별 + 교정 주기 현황 */}
        <Card>
          <SectionHeader title={`§7.1 ${t.report.s71Title}`} sub={t.report.s71Req} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print-grid-2">
            {/* 장비 식별 현황 */}
            <div>
              <p className="text-sm font-medium text-slate-600 mb-3">{t.report.s71EquipSummary}</p>
              <div className="grid grid-cols-3 gap-3 print-grid-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-100">
                  <p className="text-2xl font-bold text-blue-700">{totalEquip.toLocaleString()}</p>
                  <p className="text-[11px] text-blue-500 mt-0.5">{t.report.totalEquip}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center border border-slate-100">
                  <p className="text-2xl font-bold text-slate-700">{equipStats.manufacturers}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t.report.s71Manufacturers}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center border border-slate-100">
                  <p className="text-2xl font-bold text-slate-700">{equipStats.managers}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t.report.s71Managers}</p>
                </div>
              </div>
            </div>
            {/* 교정 주기 현황 */}
            <div>
              <p className="text-sm font-medium text-slate-600 mb-3">{t.report.s71CalCycleSummary}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(upcomingByZone).map(([zone, count]) => (
                  <div key={zone} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${zoneColor(zone)}`}>
                    <span>{zone}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* §7.2 측정 소급성 */}
        <Card>
          <SectionHeader title={`§7.2 ${t.report.s72Title}`} sub={t.report.s72Req} />
          {hasCertData && traceabilityStats ? (
            <div className="grid grid-cols-2 gap-4 print-grid-2">
              <div className="bg-indigo-50 rounded-lg p-4 text-center border border-indigo-100">
                <p className="text-3xl font-bold text-indigo-700">{traceabilityStats.refStdCount}</p>
                <p className="text-xs text-indigo-500 mt-1">{t.report.s72RefStdCount}</p>
              </div>
              <div className="bg-indigo-50 rounded-lg p-4 text-center border border-indigo-100">
                <p className="text-3xl font-bold text-indigo-700">{traceabilityStats.labCount}</p>
                <p className="text-xs text-indigo-500 mt-1">{t.report.s72CalLabCount}</p>
              </div>
            </div>
          ) : (
            <EmptyState message={t.report.noCertData} desc={t.report.noCertDataDesc} />
          )}
        </Card>

        {/* §7.3 / §7.3.1 측정불확도 현황 */}
        <Card>
          <SectionHeader title={t.report.sectionUncertainty} sub={t.report.sectionUncertaintySub} requirement={t.report.sectionUncertaintyReq} />
          {hasCertData ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print-grid-2">
              {/* U/T 도넛 */}
              <div className="overflow-hidden">
                <p className="text-sm font-medium text-slate-600 mb-2">{t.report.utDistribution}</p>
                <MiniDonut
                  data={utChartData}
                  colors={[UT_COLORS.safe, UT_COLORS.warning, UT_COLORS.danger, UT_COLORS.noData]}
                />
                <div className="flex flex-wrap justify-center gap-2 mt-1">
                  {utChartData.filter(d => d.value > 0).map((d, i) => (
                    <div key={i} className="flex items-center gap-1 text-[11px] text-slate-600">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: [UT_COLORS.safe, UT_COLORS.warning, UT_COLORS.danger, UT_COLORS.noData][i] }} />
                      {d.name} {d.value}
                    </div>
                  ))}
                </div>
              </div>
              {/* 위험 등급별 카드 */}
              <div>
                <p className="text-sm font-medium text-slate-600 mb-2">{t.report.riskLevel}</p>
                <div className="grid grid-cols-2 gap-3 mt-4 print-grid-2">
                  <RiskCard label={t.report.utSafe} value={reportData!.utRatioDistribution.safe} color="bg-green-50 text-green-700 border-green-200" dot="bg-green-500" />
                  <RiskCard label={t.report.utWarning} value={reportData!.utRatioDistribution.warning} color="bg-amber-50 text-amber-700 border-amber-200" dot="bg-amber-500" />
                  <RiskCard label={t.report.utDanger} value={reportData!.utRatioDistribution.danger} color="bg-red-50 text-red-700 border-red-200" dot="bg-red-500" />
                  <RiskCard label={t.report.utNoData} value={reportData!.utRatioDistribution.noData} color="bg-slate-50 text-slate-500 border-slate-200" dot="bg-slate-400" />
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message={t.report.noCertData} desc={t.report.noCertDataDesc} />
          )}
        </Card>
      </ClauseGroup>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* §8 분석 및 개선                                   */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="print-break-before">
      <ClauseGroup clause="§8" title={t.report.clauseS8}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid-2">
          <PlaceholderCard clause="§8.1" title={t.report.s81Title} requirement={t.report.s81Req} />
          <PlaceholderCard clause="§8.2" title={t.report.s82Title} requirement={t.report.s82Req} />
        </div>

        {/* §8.3 부적합 관리 — 격리 장비 + 영향평가 + 부적합 테이블 */}
        <Card>
          <SectionHeader title={`§8.3 ${t.report.s83Title}`} sub={t.report.s83Req} />
          {/* 격리 장비 + 영향평가 KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4 print-grid-3">
            <div className={`rounded-lg p-3 text-center border ${quarantineCount > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-2xl font-bold ${quarantineCount > 0 ? 'text-red-700' : 'text-green-700'}`}>{quarantineCount}</p>
              <p className={`text-[11px] ${quarantineCount > 0 ? 'text-red-500' : 'text-green-500'}`}>{t.report.quarantineCount}</p>
            </div>
            <div className={`rounded-lg p-3 text-center border ${caStats.open > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-2xl font-bold ${caStats.open > 0 ? 'text-amber-700' : 'text-green-700'}`}>{caStats.open}</p>
              <p className={`text-[11px] ${caStats.open > 0 ? 'text-amber-500' : 'text-green-500'}`}>{t.report.caOpenCount}</p>
            </div>
            <div className={`rounded-lg p-3 text-center border ${iaStats.incomplete > 0 ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-2xl font-bold ${iaStats.incomplete > 0 ? 'text-orange-700' : 'text-green-700'}`}>{iaStats.incomplete}</p>
              <p className={`text-[11px] ${iaStats.incomplete > 0 ? 'text-orange-500' : 'text-green-500'}`}>{t.report.iaIncomplete}</p>
            </div>
          </div>
          {hasCertData ? (
            reportData!.nonConformantList.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-600 bg-slate-700 text-white text-left text-xs font-bold uppercase tracking-wide [&>th:first-child]:rounded-tl-lg [&>th:last-child]:rounded-tr-lg">
                      <th className="py-2.5 px-3">{t.table.acptNo}</th>
                      <th className="py-2.5 px-3">{t.report.equipName}</th>
                      <th className="py-2.5 px-3">{t.report.verdict}</th>
                      <th className="py-2.5 px-3">{t.report.guardBand}</th>
                      <th className="py-2.5 px-3">{t.report.calDate}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData!.nonConformantList.map((item) => {
                      const equip = equipByAcptNo.get(item.acptNo)
                      const clickable = !!equip?.groupNm
                      return (
                      <tr key={item.acptNo} onClick={clickable ? () => handleRowClick(item.acptNo) : undefined} className={`border-b border-gray-50 hover:bg-gray-50${clickable ? ' cursor-pointer' : ''}`}>
                        <td className="py-2 px-3 font-mono text-xs">
                          {clickable ? (
                            <span className="text-blue-600 hover:underline">{item.acptNo}</span>
                          ) : item.acptNo}
                        </td>
                        <td className="py-2 px-3">{equip?.entpPrdNm ?? item.장비명 ?? '-'}</td>
                        <td className="py-2 px-3">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                            item.판정 === 'FAIL' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {item.판정}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {item.guardBand ? (
                            <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${gbBadgeColor(item.guardBand)}`}>
                              {gbLabel(item.guardBand, t)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="py-2 px-3 text-slate-500">{item.교정일 ?? '-'}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 text-sm">{t.report.noNonConformant}</div>
            )
          ) : (
            <EmptyState message={t.report.noCertData} desc={t.report.noCertDataDesc} />
          )}
        </Card>
      </ClauseGroup>
      </div>

      {/* 로딩 오버레이 */}
      {loading && (
        <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-slate-200 px-4 py-2 flex items-center gap-2 text-sm text-slate-600">
          <div className="w-4 h-4 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
          Loading...
        </div>
      )}
    </div>
  )
}

/* ── 보조 컴포넌트들 ── */

function SummaryCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className={`inline-block w-2 h-2 rounded-full ${color} mb-1`} />
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-0.5">
        {value}
        {sub && <span className="text-xs font-normal text-slate-400 ml-1">{sub}</span>}
      </p>
    </div>
  )
}

function RiskCard({ label, value, color, dot }: { label: string; value: number; color: string; dot: string }) {
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

function EmptyState({ message, desc }: { message: string; desc: string }) {
  return (
    <div className="py-10 text-center">
      <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-slate-500 font-medium">{message}</p>
      {desc && <p className="text-xs text-slate-400 mt-1">{desc}</p>}
    </div>
  )
}

function PlaceholderCard({ clause, title, requirement }: { clause: string; title: string; requirement: string }) {
  const { t } = useT()
  return (
    <div className="bg-slate-50 rounded-lg border border-dashed border-slate-300 p-5 print-compact-placeholder">
      <div className="flex items-start gap-3">
        <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-200 text-slate-600 rounded shrink-0 mt-0.5">{clause}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-600">{title}</p>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed print-hide-in-placeholder">{requirement}</p>
          <p className="text-[10px] text-slate-300 mt-2 italic print-hide-in-placeholder">{t.report.comingSoon}</p>
        </div>
      </div>
    </div>
  )
}

/* ── ISO 10012 커버리지 매트릭스 ── */

type CoverageStatus = 'implemented' | 'ai' | 'placeholder'

interface CoverageItem {
  clause: string
  titleKo: string
  titleEn: string
  status: CoverageStatus
}

interface CoverageGroup {
  group: string
  titleKey: 'clauseS5' | 'clauseS6' | 'clauseS7' | 'clauseS8'
  items: CoverageItem[]
}

const ISO_COVERAGE: CoverageGroup[] = [
  { group: '§5', titleKey: 'clauseS5', items: [
    { clause: '§5.1', titleKo: '계량 기능', titleEn: 'Metrological Function', status: 'placeholder' },
    { clause: '§5.2', titleKo: '고객 중심', titleEn: 'Customer Focus', status: 'placeholder' },
    { clause: '§5.3', titleKo: '품질 목표', titleEn: 'Quality Objectives', status: 'placeholder' },
    { clause: '§5.4', titleKo: '경영 검토', titleEn: 'Management Review', status: 'ai' },
  ]},
  { group: '§6', titleKey: 'clauseS6', items: [
    { clause: '§6.1', titleKo: '인적 자원', titleEn: 'Human Resources', status: 'implemented' },
    { clause: '§6.2.1', titleKo: '절차', titleEn: 'Procedures', status: 'placeholder' },
    { clause: '§6.2.2', titleKo: '소프트웨어', titleEn: 'Software', status: 'placeholder' },
    { clause: '§6.2.3', titleKo: '기록', titleEn: 'Records', status: 'implemented' },
    { clause: '§6.2.4', titleKo: '식별', titleEn: 'Identification', status: 'implemented' },
    { clause: '§6.3.1', titleKo: '측정장비', titleEn: 'Equipment', status: 'implemented' },
    { clause: '§6.3.2', titleKo: '환경 조건', titleEn: 'Environment', status: 'implemented' },
    { clause: '§6.4', titleKo: '외부공급자', titleEn: 'Ext. Suppliers', status: 'implemented' },
  ]},
  { group: '§7', titleKey: 'clauseS7', items: [
    { clause: '§7.1.1', titleKo: '측정학적 확인', titleEn: 'Confirmation', status: 'ai' },
    { clause: '§7.1.2', titleKo: '확인 주기', titleEn: 'Intervals', status: 'ai' },
    { clause: '§7.1.3', titleKo: '조정 관리', titleEn: 'Adjustment Control', status: 'placeholder' },
    { clause: '§7.1.4', titleKo: '확인 기록', titleEn: 'Records', status: 'implemented' },
    { clause: '§7.2.1', titleKo: '일반사항', titleEn: 'General', status: 'placeholder' },
    { clause: '§7.2.2', titleKo: '프로세스 설계', titleEn: 'Process Design', status: 'ai' },
    { clause: '§7.2.3', titleKo: '프로세스 실현', titleEn: 'Realization', status: 'placeholder' },
    { clause: '§7.3.1', titleKo: '측정 불확도', titleEn: 'Uncertainty', status: 'implemented' },
    { clause: '§7.3.2', titleKo: '소급성', titleEn: 'Traceability', status: 'implemented' },
  ]},
  { group: '§8', titleKey: 'clauseS8', items: [
    { clause: '§8.1', titleKo: '일반사항', titleEn: 'General', status: 'placeholder' },
    { clause: '§8.2.1', titleKo: '일반사항', titleEn: 'General', status: 'placeholder' },
    { clause: '§8.2.2', titleKo: '고객만족', titleEn: 'Customer Satisfaction', status: 'placeholder' },
    { clause: '§8.2.3', titleKo: '심사', titleEn: 'Audit', status: 'placeholder' },
    { clause: '§8.2.4', titleKo: '모니터링', titleEn: 'Monitoring', status: 'ai' },
    { clause: '§8.3.1', titleKo: '부적합 시스템', titleEn: 'System NC', status: 'placeholder' },
    { clause: '§8.3.2', titleKo: '부적합 프로세스', titleEn: 'Process NC', status: 'placeholder' },
    { clause: '§8.3.3', titleKo: '부적합 장비', titleEn: 'Equipment NC', status: 'implemented' },
    { clause: '§8.4.1', titleKo: '일반사항', titleEn: 'General', status: 'placeholder' },
    { clause: '§8.4.2', titleKo: '시정조치', titleEn: 'Corrective', status: 'implemented' },
    { clause: '§8.4.3', titleKo: '예방조치', titleEn: 'Preventive', status: 'ai' },
  ]},
]

function CoverageMatrix() {
  const { t, lang } = useT()

  const allItems = ISO_COVERAGE.flatMap(g => g.items)
  const implCount = allItems.filter(i => i.status !== 'placeholder').length
  const aiCount = allItems.filter(i => i.status === 'ai').length
  const totalCount = allItems.length
  const pct = Math.round((implCount / totalCount) * 100)

  const PILL: Record<CoverageStatus, string> = {
    ai: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    implemented: 'bg-blue-50 text-blue-700 border-blue-200',
    placeholder: 'bg-slate-50 text-slate-400 border-slate-200 border-dashed',
  }

  return (
    <Card>
      {/* 헤더 행: 제목 + 퍼센트 + 범례 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-slate-800">{t.report.coverageMatrix}</h3>
          <span className="text-xl font-bold text-slate-800">{pct}%</span>
          <span className="text-sm text-slate-400">({implCount}/{totalCount})</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />AI ({aiCount})</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400" />{t.report.coverageImpl} ({implCount - aiCount})</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-200" />{t.report.coveragePlan} ({totalCount - implCount})</span>
        </div>
      </div>

      {/* 진행바 */}
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden mb-5">
        <div className="h-full rounded-full flex">
          <div className="bg-emerald-500" style={{ width: `${(aiCount / totalCount) * 100}%` }} />
          <div className="bg-blue-400" style={{ width: `${((implCount - aiCount) / totalCount) * 100}%` }} />
        </div>
      </div>

      {/* 조항 그리드 — 그룹별 한 행씩 */}
      <div className="space-y-3">
        {ISO_COVERAGE.map(group => (
          <div key={group.group} className="flex items-start gap-2.5">
            {/* 그룹 라벨 */}
            <span className="shrink-0 w-[56px] mt-0.5 px-2 py-1 text-xs font-bold bg-slate-800 text-white rounded text-center">{group.group}</span>
            {/* 칩들 */}
            <div className="flex flex-wrap gap-1.5">
              {group.items.map(item => (
                <span
                  key={item.clause}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-xs font-medium leading-none ${PILL[item.status]}`}
                >
                  {item.status === 'ai' && (
                    <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  )}
                  {item.status === 'implemented' && (
                    <svg className="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  )}
                  <span className="font-bold">{item.clause}</span>
                  <span className="font-normal opacity-70">{lang === 'ko' ? item.titleKo : item.titleEn}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ── 유틸 함수 ── */

function gbBadgeColor(gb: string): string {
  switch (gb) {
    case 'conformant': return 'bg-green-100 text-green-700'
    case 'conditional-pass': return 'bg-amber-100 text-amber-700'
    case 'conditional-fail': return 'bg-orange-100 text-orange-700'
    case 'non-conformant': return 'bg-red-100 text-red-700'
    default: return 'bg-slate-100 text-slate-600'
  }
}

function gbLabel(gb: string, t: { report: Record<string, string> }): string {
  switch (gb) {
    case 'conformant': return t.report.gbConformant
    case 'conditional-pass': return t.report.gbConditionalPass
    case 'conditional-fail': return t.report.gbConditionalFail
    case 'non-conformant': return t.report.gbNonConformant
    default: return gb
  }
}

function zoneColor(zone: string): string {
  switch (zone) {
    case '임박': return 'bg-red-100 text-red-700'
    case '최근만료': case '최근 만료': return 'bg-orange-100 text-orange-700'
    case '예비': return 'bg-amber-100 text-amber-700'
    case '안전': return 'bg-green-100 text-green-700'
    case '방치': return 'bg-slate-200 text-slate-600'
    default: return 'bg-blue-100 text-blue-700'
  }
}
