/**
 * 탭 4: 소급성·환경 (ISO 10012 Clause 7.2/7.4)
 * — 최신 cert 갑지 데이터: 환경조건, 교정방법, 기준기, 교정자/승인자
 */
'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import type { CertResult } from '@/lib/cert-cache'
import { useT } from '@/lib/i18n'
import { InfoRow, SectionHeader } from './shared-components'

// 반복 문장 제거 (LLM 파싱 아티팩트 대응)
function dedup(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length < 40) return s
  // 반복 패턴 탐지: 정규화된 문자열에서 길이 20~절반까지 시도
  for (let len = 20; len <= s.length / 2; len++) {
    const chunk = s.slice(0, len)
    // chunk가 2회 이상 연속 반복되는지 확인
    let pos = len
    while (s.slice(pos, pos + len) === chunk) pos += len
    if (pos >= len * 2) {
      // 반복 확인됨 — 원본에서 첫 반복 단위만 추출
      return chunk.trim()
    }
  }
  return s
}

// 긴 텍스트 접기/펼치기
function CollapsibleText({ label, text }: { label: string; text: string }) {
  const MAX_H = 96 // 약 4줄
  const cleaned = dedup(text)
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (ref.current && ref.current.scrollHeight > MAX_H + 8) setOverflows(true)
  }, [cleaned])

  return (
    <div>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <div>
        <div
          ref={ref}
          className="text-sm text-slate-700 leading-relaxed overflow-hidden transition-[max-height] duration-300"
          style={{ maxHeight: expanded ? `${ref.current?.scrollHeight ?? 9999}px` : `${MAX_H}px` }}
        >
          {cleaned}
        </div>
        {overflows && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-1.5 text-xs text-violet-500 hover:text-violet-700 font-medium"
          >
            {expanded ? '접기 ▲' : '더 보기 ▼'}
          </button>
        )}
      </div>
    </div>
  )
}

interface Props {
  certs: Map<string, CertResult>
  certDone: boolean
  onGoHistory: () => void
}

export default function TabTraceability({ certs, certDone, onGoHistory }: Props) {
  const { t } = useT()

  // 최신 cert (교정일 기준)
  const latestCert = useMemo(() => {
    if (certs.size === 0) return null
    let latest: CertResult | null = null
    let latestDate = ''
    for (const [, cert] of certs) {
      if ((cert.교정일 ?? '') > latestDate) {
        latestDate = cert.교정일 ?? ''
        latest = cert
      }
    }
    return latest
  }, [certs])

  // cert 미로드 상태
  if (certs.size === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
        <svg className="w-12 h-12 text-slate-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm text-slate-500 mb-2">{t.detail.traceNoCert}</p>
        <button onClick={onGoHistory}
          className="px-4 py-2 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
        >{t.detail.traceGoHistory}</button>
      </div>
    )
  }

  if (!latestCert) return null

  const hasEnvData = latestCert.온도 || latestCert.습도 || latestCert.교정장소
  const hasTraceData = latestCert.교정방법 || latestCert.기술지원코드원본
  const hasRefStd = (latestCert.기준기?.length ?? 0) > 0
  const hasPersonnel = latestCert.교정자 || latestCert.승인자
  const hasAnyData = hasEnvData || hasTraceData || hasRefStd || hasPersonnel

  if (!hasAnyData) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
        <svg className="w-12 h-12 text-slate-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
        <p className="text-sm text-slate-500">{t.detail.traceNoData}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 교정 환경 */}
      {hasEnvData && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />}
            title={t.detail.traceEnvTitle}
            color="text-cyan-500"
            clause="ISO 10012 §7.4 : 환경조건"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
            {latestCert.온도 && (
              <div className="rounded-lg bg-cyan-50 border border-cyan-100 px-4 py-3">
                <p className="text-[11px] text-cyan-500 mb-0.5">{t.detail.traceEnvTemp}</p>
                <p className="text-base font-bold text-cyan-800">{latestCert.온도}</p>
              </div>
            )}
            {latestCert.습도 && (
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-[11px] text-blue-500 mb-0.5">{t.detail.traceEnvHumidity}</p>
                <p className="text-base font-bold text-blue-800">{latestCert.습도}</p>
              </div>
            )}
            {latestCert.교정장소 && (
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[11px] text-slate-400 mb-0.5">{t.detail.traceEnvLocation}</p>
                <p className="text-sm font-medium text-slate-700">{latestCert.교정장소}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 소급성 (교정방법 + 기술지원코드) */}
      {hasTraceData && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />}
            title="소급성 (Traceability)"
            color="text-violet-500"
            clause="ISO 10012 §7.2 : 소급성"
          />
          <div className="space-y-3 mt-3">
            {latestCert.교정방법 && (
              <CollapsibleText label={t.detail.traceMethod} text={latestCert.교정방법} />
            )}
            {latestCert.기술지원코드원본 && (
              <InfoRow label={t.detail.traceTechCode} value={latestCert.기술지원코드원본} />
            )}
          </div>
        </div>
      )}

      {/* 기준기 테이블 */}
      {hasRefStd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />}
            title={t.detail.traceRefStd}
            color="text-emerald-500"
            clause="ISO 10012 §7.2 : 소급성"
          />
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">#</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.traceRefStdName}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.traceRefStdMfr}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.traceRefStdSerial}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.traceRefStdValid}</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">{t.detail.traceRefStdOrg}</th>
                </tr>
              </thead>
              <tbody>
                {latestCert.기준기.map((ref, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-slate-50">
                    <td className="py-2 px-2 text-slate-400">{i + 1}</td>
                    <td className="py-2 px-2 text-slate-700 font-medium">{ref.장비명 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{ref.제조사모델 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600 font-mono">{ref.시리얼 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{ref.유효일 || '-'}</td>
                    <td className="py-2 px-2 text-slate-600">{ref.교정기관 || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 교정자 / 승인자 */}
      {hasPersonnel && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />}
            title="교정 인력"
            color="text-slate-400"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {latestCert.교정자 && (
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[11px] text-slate-400 mb-0.5">{t.detail.tracePerformer}</p>
                <p className="text-sm font-medium text-slate-700">{latestCert.교정자}</p>
              </div>
            )}
            {latestCert.승인자 && (
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[11px] text-slate-400 mb-0.5">{t.detail.traceApprover}</p>
                <p className="text-sm font-medium text-slate-700">
                  {latestCert.승인자}
                  {latestCert.승인자직위 && <span className="text-slate-400 ml-1">({latestCert.승인자직위})</span>}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
