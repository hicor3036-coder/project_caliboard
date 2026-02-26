/**
 * 탭 2: 교정이력 (ISO 10012 Clause 8 기록관리)
 * — 타임라인 + 성적서 분석 (로드 버튼 + 테이블)
 */
'use client'

import { useState, useMemo } from 'react'
import type { CertResult } from '@/lib/cert-cache'
import { useT, fmt } from '@/lib/i18n'
import DataTable, { type Column, fmtDate } from '../data-table'
import type { DetailItem, TableRow, CertProgress } from './shared-utils'
import { parseYmd, daysBetween } from './shared-utils'

interface Props {
  items: DetailItem[]
  certs: Map<string, CertResult>
  certErrors: Map<string, string>
  certProgress: CertProgress
  certLoading: boolean
  certDone: boolean
  fetchCerts: (refresh?: boolean) => void
  onSelectCert: (acptNo: string, cert: CertResult) => void
}

export default function TabHistory({
  items, certs, certErrors, certProgress, certLoading, certDone,
  fetchCerts, onSelectCert,
}: Props) {
  const { t } = useT()
  const [historyTableOpen, setHistoryTableOpen] = useState(false)

  const columns = useHistoryColumns()

  const tableData: TableRow[] = useMemo(() =>
    [...items]
      .sort((a, b) => (b.rcpnYmd ?? '').localeCompare(a.rcpnYmd ?? ''))
      .map((item, idx) => ({ ...item, no: idx + 1 })),
    [items]
  )

  const timelineData = useMemo(() =>
    [...items]
      .filter(item => item.rcpnYmd)
      .sort((a, b) => a.rcpnYmd.localeCompare(b.rcpnYmd))
      .map(item => {
        const rcpn = parseYmd(item.rcpnYmd)
        const exrs = parseYmd(item.exrsWrtnYmd)
        return {
          rcpnYmd: item.rcpnYmd,
          exrsWrtnYmd: item.exrsWrtnYmd,
          prjcCd: item.prjcCd,
          pgstNm: item.pgstNm,
          소요일: rcpn && exrs ? daysBetween(rcpn, exrs) : null,
          acptNo: item.acptNo,
        }
      }),
    [items]
  )

  return (
    <div className="space-y-6">
      {/* 타임라인 */}
      {timelineData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-700">{t.detail.calTimeline}</h3>
              <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">ISO 10012 §8 : 기록관리</span>
            </div>
            <button
              onClick={() => setHistoryTableOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              {historyTableOpen ? t.detail.hideDetail : t.detail.showDetail}
              <svg
                className={`w-3.5 h-3.5 transition-transform ${historyTableOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <div className="overflow-x-auto">
            <div className="flex items-start gap-0 min-w-max px-4 pb-2">
              {timelineData.map((item, idx) => {
                const isLast = idx === timelineData.length - 1
                const statusColor = item.pgstNm.includes('완료') ? 'bg-green-500' :
                  item.pgstNm.includes('미처리') ? 'bg-amber-500' : 'bg-blue-500'

                let gapDays: number | null = null
                if (!isLast) {
                  const curEnd = parseYmd(item.exrsWrtnYmd)
                  const nextStart = parseYmd(timelineData[idx + 1].rcpnYmd)
                  if (curEnd && nextStart) gapDays = daysBetween(curEnd, nextStart)
                }

                return (
                  <div key={item.acptNo} className="flex items-start">
                    <div className="flex flex-col items-center min-w-[120px] group relative">
                      <div className={`w-3.5 h-3.5 rounded-full ${statusColor} ring-4 ring-white shadow-sm z-10`} />
                      <div className="mt-2 text-center">
                        <p className="text-sm font-medium text-slate-700">{fmtDate(item.rcpnYmd)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{item.prjcCd}</p>
                        {item.소요일 !== null && (
                          <p className="text-xs text-blue-500 mt-0.5">{fmt(t.detail.elapsed, item.소요일)}</p>
                        )}
                        <span className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${
                          item.pgstNm.includes('완료') ? 'bg-green-50 text-green-600' :
                          item.pgstNm.includes('미처리') ? 'bg-amber-50 text-amber-600' :
                          'bg-gray-50 text-gray-500'
                        }`}>{item.pgstNm}</span>
                      </div>
                    </div>
                    {!isLast && (
                      <div className="flex flex-col items-center mt-[6px]">
                        <div className="w-20 h-0.5 bg-gray-200" />
                        {gapDays !== null && (
                          <span className="text-xs text-slate-400 mt-1 whitespace-nowrap">
                            {fmt(t.detail.gapDays, gapDays)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {historyTableOpen && (
            <div className="mt-5 border-t border-gray-100 pt-5">
              {tableData.length === 0 ? (
                <div className="text-center py-8 text-gray-400">{t.detail.noHistory}</div>
              ) : (
                <DataTable columns={columns} data={tableData} rowKey={i => `${i.acptNo}-${i.no}`} defaultSort={{ key: 'no', direction: 'asc' }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* 교정성적서 분석 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-700">{t.detail.certAnalysis}</h3>

          <div className="ml-auto flex items-center gap-2">
            {certDone && certs.size > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-600 rounded-full">
                {fmt(t.detail.certDone, certs.size)}
              </span>
            )}
            {certErrors.size > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-medium bg-red-50 text-red-500 rounded-full">
                {fmt(t.detail.certFail, certErrors.size)}
              </span>
            )}
            {!certLoading && !certDone && (
              <button onClick={() => fetchCerts()}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
              >{t.detail.loadCerts}</button>
            )}
            {certDone && (
              <button onClick={() => fetchCerts(true)}
                className="px-2 py-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >{t.detail.refresh}</button>
            )}
          </div>
        </div>

        {/* 프로그레스바 */}
        {certLoading && certProgress.total > 0 && (() => {
          const completed = certs.size + certErrors.size
          return (
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span>
                  {certProgress.status === 'cached' ? t.detail.certCached : certProgress.status === 'downloading' ? t.detail.certDownloading : t.detail.certAnalyzing}
                  {certProgress.acptNo && <span className="text-slate-400 ml-1">({certProgress.acptNo})</span>}
                </span>
                <span className="font-medium">{completed} / {certProgress.total}</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${(completed / certProgress.total) * 100}%` }} />
              </div>
            </div>
          )
        })()}

        {certLoading && certProgress.total === 0 && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t.detail.certLoading}
          </div>
        )}

        {!certLoading && !certDone && certs.size === 0 && (
          <div className="bg-slate-50 rounded-lg p-4 border border-dashed border-slate-200">
            <p className="text-sm text-slate-400 leading-relaxed">{t.detail.certDesc}</p>
          </div>
        )}

        {certs.size > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.acptNo}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.manufacturer}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.model}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.deviceNo}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.mgmtNo}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.calDate}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.nextCalDateLabel}</th>
                  <th className="text-center py-2 px-2 text-slate-400 font-medium">{t.detail.verdict}</th>
                  <th className="text-center py-2 px-2 text-slate-400 font-medium">{t.detail.mpCount}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(certs.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([acptNo, cert]) => (
                  <tr key={acptNo}
                    className="border-b border-gray-50 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => onSelectCert(acptNo, cert)}
                  >
                    <td className="py-2 px-2 font-mono text-slate-500">{acptNo}</td>
                    <td className="py-2 px-2 text-slate-700">{cert.제조사 || '-'}</td>
                    <td className="py-2 px-2 text-slate-700">{cert.모델 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.시리얼 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.관리번호 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.교정일 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{cert.차기교정일 || '-'}</td>
                    <td className="py-2 px-2 text-center">
                      {cert.전체판정 === 'PASS' ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">PASS</span>
                      ) : cert.전체판정 === 'FAIL' ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">FAIL</span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center text-slate-500">{cert.측정포인트수 || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {certErrors.size > 0 && (
          <div className="mt-3 space-y-1">
            {Array.from(certErrors.entries()).map(([acptNo, errMsg]) => (
              <div key={acptNo} className="flex items-center gap-2 text-sm text-red-500 bg-red-50 rounded px-3 py-1.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-mono">{acptNo}</span>
                <span className="text-red-400">{errMsg}</span>
              </div>
            ))}
          </div>
        )}

        {certDone && certs.size === 0 && certErrors.size === 0 && (
          <div className="text-center py-6 text-sm text-slate-400">{t.detail.noCertResult}</div>
        )}
      </div>
    </div>
  )
}

// 테이블 컬럼 훅
function useHistoryColumns(): Column<TableRow>[] {
  const { t } = useT()
  return useMemo(() => [
    { key: 'no', header: 'No', align: 'center' as const, sortValue: (i: TableRow) => i.no, render: (i: TableRow) => <span className="text-gray-400">{i.no}</span> },
    { key: 'prjcCd', header: t.detail.project, sortValue: (i: TableRow) => i.prjcCd, render: (i: TableRow) => <span className="font-mono text-gray-500">{i.prjcCd}</span> },
    { key: 'acptNo', header: t.detail.acptNo, sortValue: (i: TableRow) => i.acptNo, render: (i: TableRow) => <span className="font-mono text-gray-500">{i.acptNo}</span> },
    { key: 'rcpnYmd', header: t.detail.rcpnDate, sortValue: (i: TableRow) => i.rcpnYmd, render: (i: TableRow) => <span className="text-gray-600">{fmtDate(i.rcpnYmd)}</span> },
    { key: 'exrsWrtnYmd', header: t.detail.calComplete, sortValue: (i: TableRow) => i.exrsWrtnYmd, render: (i: TableRow) => <span className="text-gray-600">{fmtDate(i.exrsWrtnYmd)}</span> },
    { key: 'nxtrExrsYmd', header: t.detail.nextCalDate, sortValue: (i: TableRow) => i.nxtrExrsYmd, render: (i: TableRow) => <span className="text-gray-600">{fmtDate(i.nxtrExrsYmd)}</span> },
    { key: 'totalSum', header: t.detail.cost, sortValue: (i: TableRow) => i.totalSum, render: (i: TableRow) => <span className="text-gray-600">{i.totalSum ? fmt(t.detail.costUnit, i.totalSum.toLocaleString()) : '-'}</span> },
    {
      key: 'pgstNm', header: t.detail.status, sortValue: (i: TableRow) => i.pgstNm,
      render: (i: TableRow) => {
        const s = i.pgstNm
        const color = s.includes('미처리') ? 'bg-amber-100 text-amber-700' : s.includes('완료') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
        return <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${color}`}>{s || '-'}</span>
      },
    },
    { key: 'mngmRsprNm', header: t.detail.calManager, sortValue: (i: TableRow) => i.mngmRsprNm, render: (i: TableRow) => <span className="text-gray-600">{i.mngmRsprNm || '-'}</span> },
  ], [t])
}
