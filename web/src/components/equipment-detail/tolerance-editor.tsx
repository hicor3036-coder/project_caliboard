/**
 * 허용오차 & MPE 편집 모달 (ISO 10012 §7.1.1 측정학적 확인)
 */
'use client'

import { useState } from 'react'
import { useT, fmt } from '@/lib/i18n'

export interface ToleranceData {
  value: number
  unit: string
  note: string | null
}

interface Props {
  tolerance: ToleranceData | null
  mpePercent: number | null
  /** items[0]의 제조사/모델 정보 */
  manufacturer: string
  model: string
  onSpecChange: (tolerance: ToleranceData | null, mpePercent: number | null) => void
}

export default function ToleranceEditor({ tolerance, mpePercent, manufacturer, model, onSpecChange }: Props) {
  const { t } = useT()
  const effectiveMpe = mpePercent ?? 100

  const [editOpen, setEditOpen] = useState(false)
  const [editTolValue, setEditTolValue] = useState('')
  const [editTolUnit, setEditTolUnit] = useState('')
  const [editTolNote, setEditTolNote] = useState('')
  const [editMpe, setEditMpe] = useState('')
  const [saving, setSaving] = useState(false)

  const openEdit = () => {
    setEditTolValue(tolerance?.value?.toString() ?? '')
    setEditTolUnit(tolerance?.unit ?? '')
    setEditTolNote(tolerance?.note ?? '')
    setEditMpe(effectiveMpe === 100 ? '' : effectiveMpe.toString())
    setEditOpen(true)
  }

  const saveSpec = async () => {
    setSaving(true)
    try {
      const newTol: ToleranceData | null = editTolValue
        ? { value: parseFloat(editTolValue), unit: editTolUnit, note: editTolNote || null }
        : null
      const newMpe = editMpe ? parseFloat(editMpe) : 100
      const res = await fetch(`/api/supabase/profiles?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}`)
      let profile = res.ok ? await res.json() : null
      if (!profile) {
        profile = {
          manufacturer, model,
          category: null, source: 'manual_input', verified: false, source_urls: [],
          spec: { range: null, accuracy: null, resolution: null, units: null, overload_limit: null, manual_tolerance: null, tolerance: null, mpe_percent: null },
          environment: { operating_temp: null, storage_temp: null, operating_humidity: null, ip_rating: null, warmup_time: null },
          power: { type: null, battery: null, battery_life: null, charge_time: null },
          interface: { output: null, software: null, wireless: null, memory: null },
          calibration: { recommended_cycle: null, self_calibration: null, standards: null, stability_spec: null, drift_spec: null },
          maintenance: [], cautions: [],
          meta: { country: null, discontinued: null, successor_model: null, alternatives: [], approx_price: null, support_url: null, manual_url: null },
          updated_at: '',
        }
      }
      profile.spec.tolerance = newTol
      profile.spec.mpe_percent = newMpe
      profile.spec.manual_tolerance = null
      await fetch('/api/supabase/profiles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
      onSpecChange(newTol, newMpe)
      setEditOpen(false)
    } finally { setSaving(false) }
  }

  const deleteSpec = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/supabase/profiles?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}`)
      const profile = res.ok ? await res.json() : null
      if (profile) {
        profile.spec.tolerance = null
        profile.spec.mpe_percent = null
        profile.spec.manual_tolerance = null
        await fetch('/api/supabase/profiles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
      }
      onSpecChange(null, null)
      setEditOpen(false)
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700">{t.detail.toleranceSetting}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">ISO 10012 §7.1.1 : 측정학적 확인 일반 (Metrological confirmation — General)</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">{t.detail.reqS71}</p>
          </div>
        </div>
        <button
          onClick={openEdit}
          className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200"
        >
          {tolerance ? t.detail.toleranceEdit : `+ ${t.detail.toleranceSetting}`}
        </button>
      </div>

      {tolerance ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
            <p className="text-[11px] text-blue-400 mb-0.5">{t.detail.toleranceValue}</p>
            <p className="text-base font-bold text-blue-700">
              ±{tolerance.value}{tolerance.unit ? ` ${tolerance.unit}` : ''}
            </p>
          </div>
          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
            <p className="text-[11px] text-red-400 mb-0.5">{t.detail.mpe}</p>
            <p className="text-base font-bold text-red-700">
              {fmt(t.detail.mpePercent, effectiveMpe)}
            </p>
          </div>
          {tolerance.note && (
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 sm:col-span-2">
              <p className="text-[11px] text-slate-400 mb-0.5">{t.detail.toleranceNote}</p>
              <p className="text-sm text-slate-600">{tolerance.note}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-slate-50 rounded-lg p-4 border border-dashed border-slate-200 text-center">
          <p className="text-sm text-slate-400">{t.detail.toleranceNotSet}</p>
          <p className="text-xs text-slate-300 mt-1">허용오차를 설정하면 측정학적 확인 탭에서 MPE 판정이 표시됩니다</p>
        </div>
      )}

      {/* 편집 모달 */}
      {editOpen && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-96 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              {t.detail.toleranceSetting}
            </h3>

            <div className="space-y-2 mb-4">
              <label className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{t.detail.toleranceValue}</label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-blue-600 w-4">±</span>
                <input
                  type="number" step="any" placeholder="0.5"
                  value={editTolValue} onChange={e => setEditTolValue(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                  autoFocus
                />
                <input
                  type="text" placeholder="단위 (N·m, °C...)"
                  value={editTolUnit} onChange={e => setEditTolUnit(e.target.value)}
                  className="w-28 px-2.5 py-1.5 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <input
                type="text" placeholder="설정 근거 (제조사 스펙, 공정 요구...)"
                value={editTolNote} onChange={e => setEditTolNote(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="space-y-2 mb-4">
              <label className="text-xs font-semibold text-red-600 uppercase tracking-wide">{t.detail.mpe}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" step="any" min="1" max="100" placeholder="100"
                  value={editMpe} onChange={e => setEditMpe(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200"
                />
                <span className="text-sm text-red-500">%</span>
              </div>
              <p className="text-[11px] text-slate-400">허용오차의 몇 %까지 사용을 허용할지 설정합니다 (비워두면 100%)</p>
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
              {tolerance && (
                <button onClick={deleteSpec} disabled={saving}
                  className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >삭제</button>
              )}
              <button onClick={() => setEditOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
              >취소</button>
              <button disabled={!editTolValue || saving} onClick={saveSpec}
                className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >{saving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
