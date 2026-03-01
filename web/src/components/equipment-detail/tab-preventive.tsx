/**
 * 탭 5: AI 예방분석 (AI Preventive Analysis)
 * ISO 10012 §8.2.4 모니터링 + §7.1.2 확인주기 + §8.4.3 예방조치
 * — 물리량 선택 → 건강검진 + 교정 지시서 (한 화면에 위아래 배치)
 */
'use client'

import { useState, useMemo } from 'react'
import { useT } from '@/lib/i18n'
import EquipmentHealthPanel from '../equipment-health-panel'
import CalibrationInstructionPanel from '../calibration-instruction-panel'
import type { ConformityTrend, DetailItem } from './shared-utils'
import { quantityLabel } from './shared-utils'

interface Props {
  conformityTrend: ConformityTrend | null
  info: DetailItem
  equipmentName: string
}

export default function TabPreventive({ conformityTrend, info, equipmentName }: Props) {
  const { t, lang } = useT()

  // ── 물리량 선택 (최상위) ──
  const quantityTabs = useMemo(() => {
    if (!conformityTrend) return []
    const { quantityKeys, byQuantity } = conformityTrend
    const filtered = quantityKeys.filter(q => q !== '전체' && byQuantity.has(q))
    return filtered.length >= 2 ? filtered : []
  }, [conformityTrend])
  const hasMultiQ = quantityTabs.length >= 2
  const [selectedQuantity, setSelectedQuantity] = useState<string | null>(null)

  // 선택된 물리량에 해당하는 series
  const filteredSeries = useMemo(() => {
    if (!conformityTrend) return []
    if (hasMultiQ && selectedQuantity && conformityTrend.byQuantity.has(selectedQuantity)) {
      return conformityTrend.byQuantity.get(selectedQuantity)!.series
    }
    return conformityTrend.series
  }, [conformityTrend, hasMultiQ, selectedQuantity])

  // 선택된 물리량 라벨 (AI 호출용)
  const selectedQuantityLabel = useMemo(() => {
    if (!hasMultiQ || !selectedQuantity) return undefined
    return quantityLabel(selectedQuantity, lang, t.detail.allQuantities)
  }, [hasMultiQ, selectedQuantity, lang, t])

  if (!conformityTrend) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex gap-6">
          <div className="flex-1 text-center py-8">
            <svg className="w-8 h-8 text-slate-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className="text-sm text-slate-400">{t.detail.aiHealthTitle}</p>
            <p className="text-xs text-slate-300 mt-1">{t.detail.aiHealthDesc}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      {/* 물리량 선택 (최상위) */}
      {hasMultiQ && (
        <div className="px-6 pt-4 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <span className="text-xs font-medium text-slate-400">{lang === 'ko' ? '분석 대상 물리량' : 'Analysis Target'}</span>
          </div>
          <div className="flex gap-1 bg-gray-50 rounded-lg p-1">
            <button
              onClick={() => setSelectedQuantity(null)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                !selectedQuantity ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.detail.allQuantities}
            </button>
            {quantityTabs.map(q => (
              <button
                key={q}
                onClick={() => setSelectedQuantity(q)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  selectedQuantity === q ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {quantityLabel(q, lang, t.detail.allQuantities)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI 건강검진 */}
      <div className="p-6 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-emerald-600">{t.detail.aiHealthTab}</span>
            <span className="text-[10px] text-slate-400">§8.2.4 · §7.1.2 · §8.4.3</span>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">
            ISO 10012 §8.2.4 모니터링 · §7.1.2 확인주기 · §8.4.3 예방조치
          </span>
        </div>
        <EquipmentHealthPanel
          series={filteredSeries}
          calDates={conformityTrend.calDates}
          certCount={conformityTrend.certCount}
          affcCyclCd={info.affcCyclCd}
          embedded
        />
      </div>

      {/* 구분선 */}
      <div className="border-t border-gray-100" />

      {/* AI 교정 지시서 */}
      <div className="p-6 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-blue-600">{t.detail.aiInstructionTab}</span>
            <span className="text-[10px] text-slate-400">§7.2.2</span>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">
            ISO 10012 §7.2.2 측정프로세스 설계
          </span>
        </div>
        <CalibrationInstructionPanel
          series={filteredSeries}
          calDates={conformityTrend.calDates}
          certCount={conformityTrend.certCount}
          affcCyclCd={info.affcCyclCd}
          equipmentName={equipmentName}
          manufacturer={info.prdnCmpnNm || ''}
          model={info.stszNm || ''}
          quantityLabel={selectedQuantityLabel}
          embedded
        />
      </div>
    </div>
  )
}
