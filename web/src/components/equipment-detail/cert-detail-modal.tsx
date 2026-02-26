/**
 * 성적서 파싱 결과 상세 모달
 * — equipment-detail-page.tsx에서 추출
 */
'use client'

import { useState, useMemo } from 'react'
import type { CertResult } from '@/lib/cert-cache'
import { useT, fmt, type Lang } from '@/lib/i18n'
import { groupByQuantity, quantityLabel } from './shared-utils'

interface Props {
  acptNo: string
  cert: CertResult
  onClose: () => void
}

export default function CertDetailModal({ acptNo, cert, onClose }: Props) {
  const { t, lang } = useT()
  const measurements = cert.측정결과 ?? []
  const quantityGroups = useMemo(() => groupByQuantity(measurements), [measurements])
  const quantityKeys = useMemo(() => Array.from(quantityGroups.keys()), [quantityGroups])
  const hasMultiQuantity = quantityKeys.length > 1
  const [activeQuantity, setActiveQuantity] = useState<string>(quantityKeys[0] || '전체')
  const currentMeasurements = hasMultiQuantity
    ? (quantityGroups.get(activeQuantity) ?? measurements)
    : measurements

  const fields: [string, string | null, string][] = [
    [t.detail.certNo, cert.성적서번호, '성적서번호'],
    [t.detail.customer, cert.고객명, '고객명'],
    [t.detail.equipName, cert.장비명, '장비명'],
    [t.detail.manufacturer, cert.제조사, '제조사'],
    [t.detail.model, cert.모델, '모델'],
    [t.detail.deviceNo, cert.시리얼, '기기번호'],
    [t.detail.mgmtNo, cert.관리번호, '관리번호'],
    [t.detail.calDate, cert.교정일, '교정일'],
    [t.detail.nextCalDateLabel, cert.차기교정일, '차기교정일'],
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-800">{t.detail.parseResult}</h2>
            <p className="text-sm text-slate-400 font-mono mt-0.5">{acptNo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 기본정보 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{t.detail.basicInfo}</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {fields.map(([label, value, koKey]) => (
                <div key={koKey} className="flex items-baseline gap-2">
                  <span className="text-xs text-gray-400 min-w-[60px] shrink-0">{label}</span>
                  <span className={`text-sm font-medium truncate ${
                    cert._llm_보강?.includes(koKey) ? 'text-indigo-600' : 'text-slate-700'
                  }`} title={value || '-'}>
                    {value || '-'}
                    {cert._llm_보강?.includes(koKey) && (
                      <span className="ml-1 text-[9px] text-indigo-400">(AI)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 적합성검토 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{t.detail.conformity}</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{t.detail.conformityDoc}</span>
                <span className={`text-sm font-medium ${cert.적합성검토 ? 'text-green-600' : 'text-slate-400'}`}>
                  {cert.적합성검토 ? t.detail.exists : t.detail.notExists}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{t.detail.overallVerdict}</span>
                {cert.전체판정 === 'PASS' ? (
                  <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-bold">PASS</span>
                ) : cert.전체판정 === 'FAIL' ? (
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-bold">FAIL</span>
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{t.detail.mpCount}</span>
                <span className="text-sm font-medium text-slate-700">{fmt(t.detail.mpCountUnit, cert.측정포인트수)}</span>
              </div>
            </div>

            {/* 물리량 탭 */}
            {hasMultiQuantity && (
              <div className="flex gap-1 mb-3 bg-gray-50 rounded-lg p-1">
                {quantityKeys.map(q => (
                  <button
                    key={q}
                    onClick={() => setActiveQuantity(q)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      activeQuantity === q
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {quantityLabel(q, lang, t.detail.allQuantities)}
                    <span className="ml-1 text-[11px] text-gray-400">({quantityGroups.get(q)?.length ?? 0})</span>
                  </button>
                ))}
              </div>
            )}

            {/* 측정결과 테이블 */}
            {currentMeasurements.length > 0 && (() => {
              const hasStructured = currentMeasurements.some(mp => mp.기준값 != null || mp.지시값 != null)

              if (hasStructured) {
                const cols: { key: string; label: string; unitKey: string }[] = [
                  { key: '기준값', label: t.detail.refValue, unitKey: '기준단위' },
                  { key: '지시값', label: t.detail.indication, unitKey: '지시단위' },
                  { key: '오차', label: t.detail.error, unitKey: '오차단위' },
                  { key: '허용오차', label: t.detail.toleranceVal, unitKey: '허용오차단위' },
                  { key: '불확도', label: t.detail.uncertainty, unitKey: '불확도단위' },
                ]
                const usedCols = cols.filter(c =>
                  currentMeasurements.some(mp => (mp as unknown as Record<string, unknown>)[c.key] != null)
                )

                return (
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-center py-1.5 px-2 text-gray-400 font-medium">#</th>
                          {usedCols.map(c => (
                            <th key={c.key} className="text-center py-1.5 px-2 text-gray-400 font-medium whitespace-nowrap">
                              {c.label}
                            </th>
                          ))}
                          <th className="text-center py-1.5 px-2 text-gray-400 font-medium">{t.detail.verdict}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentMeasurements.map((mp, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="py-1.5 px-2 text-gray-400 text-center">{i + 1}</td>
                            {usedCols.map(c => {
                              const val = (mp as unknown as Record<string, unknown>)[c.key] as string | null
                              const unit = (mp as unknown as Record<string, unknown>)[c.unitKey] as string | null
                              return (
                                <td key={c.key} className="py-1.5 px-2 text-center whitespace-nowrap font-mono text-slate-600">
                                  {val ?? '-'}
                                  {unit && <span className="text-slate-400 text-[11px] ml-0.5">{unit}</span>}
                                </td>
                              )
                            })}
                            <td className="py-1.5 px-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                mp.판정 === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>{mp.판정}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }

              return (
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left py-1.5 px-2 text-gray-400 font-medium">#</th>
                        <th className="text-left py-1.5 px-2 text-gray-400 font-medium">{t.detail.dataCol}</th>
                        <th className="text-center py-1.5 px-2 text-gray-400 font-medium">{t.detail.verdict}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentMeasurements.map((mp, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-1.5 px-2 text-gray-400">{i + 1}</td>
                          <td className="py-1.5 px-2 text-slate-600 font-mono">{mp.원본데이터.join(' | ')}</td>
                          <td className="py-1.5 px-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              mp.판정 === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>{mp.판정}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </section>

          {/* 불일치 항목 */}
          {(cert.불일치?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-amber-600 uppercase tracking-wide mb-2">{t.detail.discrepancy}</h3>
              <div className="space-y-1.5">
                {(cert.불일치 ?? []).map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                    <svg className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="leading-relaxed">
                      <span className="font-medium text-amber-700">{item.항목}</span>
                      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 bg-white rounded text-amber-700 font-mono">{item.갑지}</span>
                        <span className="text-amber-400 text-xs">{t.detail.coverSheet}</span>
                        <span className="text-amber-300 mx-0.5">vs</span>
                        <span className="px-1.5 py-0.5 bg-white rounded text-amber-700 font-mono">{item.적합성검토}</span>
                        <span className="text-amber-400 text-xs">{t.detail.conformDoc}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI 보강 정보 */}
          {cert._llm_provider && (
            <section>
              <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wide mb-2">{t.detail.aiEnhance}</h3>
              <div className="bg-indigo-50/50 rounded-lg p-3 border border-indigo-100">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-indigo-400">{t.detail.aiAnalysis}</span>
                  <span className="font-medium text-indigo-600">KTL AI</span>
                  {(cert._llm_보강?.length ?? 0) > 0 && (
                    <>
                      <span className="text-indigo-300">|</span>
                      <span className="text-indigo-400">{t.detail.aiEnhancedFields}</span>
                      <span className="text-indigo-600">{(cert._llm_보강 ?? []).join(', ')}</span>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 메타 정보 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">{t.detail.meta}</h3>
            <div className="flex items-center gap-4 text-sm text-slate-500">
              <span>{fmt(t.detail.sheetCount, cert.시트수)}</span>
              <span className="text-slate-300">|</span>
              <span className="truncate" title={(cert.시트목록 ?? []).join(', ')}>{(cert.시트목록 ?? []).join(', ')}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
