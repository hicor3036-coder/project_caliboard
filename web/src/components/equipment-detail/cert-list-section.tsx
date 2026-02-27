/**
 * 교정성적서 목록 섹션 (ISO 10012 §7.1.4 기록)
 * Tab1(장비 식별)과 Tab2(측정학적 확인) 양쪽에서 재사용
 */
'use client'

import { useT, fmt } from '@/lib/i18n'
import type { CertResult } from '@/lib/cert-cache'
import type { CertProgress } from './shared-utils'

interface Props {
  certs: Map<string, CertResult>
  certErrors: Map<string, string>
  certProgress: CertProgress
  certLoading: boolean
  certDone: boolean
  fetchCerts: (refresh?: boolean) => void
  onSelectCert: (acptNo: string, cert: CertResult) => void
}

export default function CertListSection({
  certs, certErrors, certProgress, certLoading, certDone, fetchCerts, onSelectCert,
}: Props) {
  const { t } = useT()

  return (
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
  )
}
