/**
 * 탭 5: AI 분석 (ISO 10012 Clause 5 관리)
 * — 교정 지시서 + 건강검진 서브탭
 */
'use client'

import { useState } from 'react'
import { useT } from '@/lib/i18n'
import EquipmentHealthPanel from '../equipment-health-panel'
import CalibrationInstructionPanel from '../calibration-instruction-panel'
import type { ConformityTrend, DetailItem } from './shared-utils'

interface Props {
  conformityTrend: ConformityTrend | null
  info: DetailItem
  equipmentName: string
}

export default function TabAiAnalysis({ conformityTrend, info, equipmentName }: Props) {
  const { t } = useT()
  const [activeAiTab, setActiveAiTab] = useState<'health' | 'instruction'>('health')

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
      {/* 서브탭 헤더 */}
      <div className="flex items-center border-b border-gray-100 px-6 pt-4">
        <button
          onClick={() => setActiveAiTab('health')}
          className={`pb-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
            activeAiTab === 'health'
              ? 'border-emerald-500 text-emerald-600'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >{t.detail.aiHealthTab}</button>
        <button
          onClick={() => setActiveAiTab('instruction')}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
            activeAiTab === 'instruction'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >{t.detail.aiInstructionTab}</button>
        <div className="ml-auto mb-3 text-right">
          <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">ISO 10012 §5 : 관리책임</span>
          <p className="text-[11px] text-slate-400 mt-0.5">{t.detail.reqS5}</p>
        </div>
      </div>

      {/* 서브탭 콘텐츠 */}
      <div className="p-6">
        {activeAiTab === 'health' ? (
          <EquipmentHealthPanel
            series={conformityTrend.series}
            calDates={conformityTrend.calDates}
            certCount={conformityTrend.certCount}
            affcCyclCd={info.affcCyclCd}
            embedded
          />
        ) : (
          <CalibrationInstructionPanel
            series={conformityTrend.series}
            calDates={conformityTrend.calDates}
            certCount={conformityTrend.certCount}
            affcCyclCd={info.affcCyclCd}
            equipmentName={equipmentName}
            manufacturer={info.prdnCmpnNm || ''}
            model={info.stszNm || ''}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            byQuantity={conformityTrend.byQuantity as any}
            quantityKeys={conformityTrend.quantityKeys}
            embedded
          />
        )}
      </div>
    </div>
  )
}
