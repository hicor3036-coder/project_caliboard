'use client'

import { useState, useEffect, useMemo } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { StatusPieChart, MonthlyBarChart, HorizontalBarChart } from '@/components/charts'
import { useT, fmt } from '@/lib/i18n'
import type { ReportData } from '@/app/api/ktools/report/route'

/* ── AnalysisData 타입 (page.tsx에서 전달) ── */
interface EquipmentItem {
  acptNo: string; entpPrdNm: string; prdnCmpnNm: string
  stszNm: string; mctlNo: string; custEqpmSrno: string
  rcpnYmd: string; pgstNm: string; mngmRsprNm: string
  nxtrExrsYmd: string; exrsWrtnYmd: string; groupNm: string; groupCnt: number
}

interface AnalysisData {
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
function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}

/* ── 카드 래퍼 ── */
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-6 ${className}`}>
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
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
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
  const { t } = useT()
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

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

  const hasCertData = analyzed > 0

  return (
    <div className="space-y-6">
      {/* ── 헤더 ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{t.report.title}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{t.report.subtitle}</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            {analysisData.summary.데이터시점}
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

      {/* ── 요약 카드 4개 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label={t.report.totalEquip} value={totalEquip.toLocaleString()} color="bg-blue-500" />
        <SummaryCard label={t.report.analyzed} value={analyzed.toLocaleString()} color="bg-indigo-500" sub={`${coveragePct}%`} />
        <SummaryCard label={t.report.passRate} value={passRate} color={passRate === '-' ? 'bg-slate-400' : 'bg-green-500'} />
        <SummaryCard label={t.report.avgDays} value={String(Math.round(analysisData.summary.평균소요일))} color="bg-amber-500" sub={t.summary.days} />
      </div>

      {/* ── §5.4(a) 측정관리 체계 적합성 ── */}
      <Card>
        <SectionHeader title={t.report.sectionConformity} sub={t.report.sectionConformitySub} />
        {hasCertData ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 적합/부적합 도넛 */}
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">{t.report.conformityChart}</p>
              <MiniDonut
                data={conformityChartData}
                colors={[PASS_COLOR, FAIL_COLOR, NOJUDGE_COLOR]}
                centerLabel={passRate}
              />
              <div className="flex justify-center gap-4 mt-2">
                {conformityChartData.filter(d => d.value > 0).map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: [PASS_COLOR, FAIL_COLOR, NOJUDGE_COLOR][i] }} />
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
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={[{ name: 'GB', ...Object.fromEntries(gbChartData.map(d => [d.name, d.value])) }]} layout="vertical" margin={{ left: 0, right: 20 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" hide />
                      <Tooltip content={<ChartTooltip />} />
                      {gbChartData.map((d) => (
                        <Bar key={d.name} dataKey={d.name} stackId="gb" fill={d.fill} radius={0} barSize={32} />
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
                <div className="flex items-center justify-center h-[220px] text-slate-400 text-sm">{t.report.gbNoData}</div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState message={t.report.noCertData} desc={t.report.noCertDataDesc} />
        )}
      </Card>

      {/* ── §5.4(e) 부적합 장비 현황 ── */}
      <Card>
        <SectionHeader title={t.report.sectionNonConformant} sub={t.report.sectionNonConformantSub} />
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

      {/* ── §5.4(h) 측정 프로세스 성과 ── */}
      <Card>
        <SectionHeader title={t.report.sectionPerformance} sub={t.report.sectionPerformanceSub} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MonthlyBarChart data={analysisData.월별접수추이} />
          <StatusPieChart data={analysisData.진행상태분포} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          {/* 차기교정 임박 요약 */}
          <div className="bg-slate-50 rounded-lg p-4">
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
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm font-semibold text-slate-700 mb-2">{t.report.unprocessedSummary}</p>
            <div className="flex items-baseline gap-4">
              <span className="text-2xl font-bold text-slate-800">{analysisData.summary.미처리건수}</span>
              <span className="text-xs text-slate-500">{fmt(t.report.avgStay, avgStay)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── §5.4(i) 교정기관 평가 ── */}
      <Card>
        <SectionHeader title={t.report.sectionSupplier} sub={t.report.sectionSupplierSub} />
        {hasCertData && labChartData.length > 0 ? (
          <HorizontalBarChart data={labChartData} title={t.report.certCount} />
        ) : (
          <EmptyState message={hasCertData ? t.report.noSupplierData : t.report.noCertData} desc={hasCertData ? '' : t.report.noCertDataDesc} />
        )}
      </Card>

      {/* ── §7.3.1 측정불확도 현황 ── */}
      <Card>
        <SectionHeader title={t.report.sectionUncertainty} sub={t.report.sectionUncertaintySub} />
        {hasCertData ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* U/T 도넛 */}
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">{t.report.utDistribution}</p>
              <MiniDonut
                data={utChartData}
                colors={[UT_COLORS.safe, UT_COLORS.warning, UT_COLORS.danger, UT_COLORS.noData]}
              />
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {utChartData.filter(d => d.value > 0).map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: [UT_COLORS.safe, UT_COLORS.warning, UT_COLORS.danger, UT_COLORS.noData][i] }} />
                    {d.name} {d.value}
                  </div>
                ))}
              </div>
            </div>
            {/* 위험 등급별 카드 */}
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">{t.report.riskLevel}</p>
              <div className="grid grid-cols-2 gap-3 mt-4">
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

      {/* ── §5.4(b,d,g) 향후 확장 ── */}
      <Card>
        <SectionHeader title={t.report.sectionFuture} sub="" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <PlaceholderCard title={t.report.correctiveAction} sub={t.report.correctiveActionSub} />
          <PlaceholderCard title={t.report.auditResult} sub={t.report.auditResultSub} />
          <PlaceholderCard title={t.report.customerFeedback} sub={t.report.customerFeedbackSub} />
        </div>
      </Card>

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
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className={`inline-block w-2 h-2 rounded-full ${color} mb-2`} />
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold mt-1">
        {value}
        {sub && <span className="text-sm font-normal text-slate-400 ml-1">{sub}</span>}
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

function PlaceholderCard({ title, sub }: { title: string; sub: string }) {
  const { t } = useT()
  return (
    <div className="bg-slate-50 rounded-lg border border-dashed border-slate-300 p-6 text-center">
      <svg className="w-8 h-8 text-slate-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
      <p className="text-xs text-slate-400 mt-2 italic">{t.report.comingSoon}</p>
    </div>
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
