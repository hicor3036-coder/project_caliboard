/**
 * 개요 탭 — 기본정보(ISO 10012 §7.1 측정학적 확인) + 교정이력(§8 측정관리시스템 분석 및 개선) 통합
 */
'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import type { CertResult } from '@/lib/cert-cache'
import { useT, fmt } from '@/lib/i18n'
import DataTable, { type Column, fmtDate } from '../data-table'
import type { DetailItem, TableRow, CertProgress } from './shared-utils'
import { parseYmd, daysBetween } from './shared-utils'
import { InfoRow, SectionHeader } from './shared-components'

// ─── 장비 상태 관리 (ISO 10012 §7.1 측정학적 확인 + §8.3 부적합 관리) ───

export type EquipStatusValue = 'in-service' | 'quarantine' | 'out-of-service'

export interface EquipmentStatusRecord {
  status: EquipStatusValue
  reason?: string
  changedAt: string
  changedBy?: string
}

const EQUIP_STATUS_PREFIX = 'equipStatus_'

export function loadEquipStatus(groupNm: string): EquipmentStatusRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(EQUIP_STATUS_PREFIX + groupNm)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function loadEquipStatusHistory(groupNm: string): EquipmentStatusRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(EQUIP_STATUS_PREFIX + groupNm + '_history')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveEquipStatus(groupNm: string, record: EquipmentStatusRecord) {
  const key = EQUIP_STATUS_PREFIX + groupNm
  localStorage.setItem(key, JSON.stringify(record))
  // 이력도 추가
  const histKey = key + '_history'
  try {
    const hist: EquipmentStatusRecord[] = JSON.parse(localStorage.getItem(histKey) || '[]')
    hist.unshift(record)
    localStorage.setItem(histKey, JSON.stringify(hist.slice(0, 50))) // 최대 50건
  } catch {
    localStorage.setItem(histKey, JSON.stringify([record]))
  }
}

const STATUS_BADGE: Record<EquipStatusValue, { bg: string; text: string; border: string }> = {
  'in-service':     { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  'quarantine':     { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  'out-of-service': { bg: 'bg-slate-100', text: 'text-slate-600',  border: 'border-slate-300' },
}

// ─── 허용오차 타입 ───

interface ToleranceData {
  value: number
  unit: string
  note: string | null
}

// ─── Props ───

interface Props {
  // 기본정보
  groupNm: string
  info: DetailItem
  items: DetailItem[]
  imageUrl: string | null
  thumbnailUrl: string | null
  imageLoading: boolean
  imageError: boolean
  setThumbnailUrl: (v: string | null) => void
  setImageError: (v: boolean) => void
  equipmentName: string
  tolerance: ToleranceData | null
  mpePercent: number | null
  onSpecChange: (tolerance: ToleranceData | null, mpePercent: number | null) => void
  // 교정이력
  certs: Map<string, CertResult>
  certErrors: Map<string, string>
  certProgress: CertProgress
  certLoading: boolean
  certDone: boolean
  fetchCerts: (refresh?: boolean) => void
  onSelectCert: (acptNo: string, cert: CertResult) => void
}

// ─── 메인 ───

export default function TabOverview({
  groupNm, info, items, imageUrl, thumbnailUrl, imageLoading, imageError,
  setThumbnailUrl, setImageError, equipmentName, tolerance, mpePercent, onSpecChange,
  certs, certErrors, certProgress, certLoading, certDone, fetchCerts, onSelectCert,
}: Props) {
  const { t } = useT()

  // ── 장비 상태 관리 ──
  const [equipStatus, setEquipStatus] = useState<EquipmentStatusRecord | null>(null)
  const [statusHistory, setStatusHistory] = useState<EquipmentStatusRecord[]>([])
  const [statusChangeOpen, setStatusChangeOpen] = useState(false)
  const [newStatus, setNewStatus] = useState<EquipStatusValue>('in-service')
  const [statusReason, setStatusReason] = useState('')
  const [statusChangedBy, setStatusChangedBy] = useState('')
  const [showStatusHistory, setShowStatusHistory] = useState(false)

  useEffect(() => {
    setEquipStatus(loadEquipStatus(groupNm))
    setStatusHistory(loadEquipStatusHistory(groupNm))
  }, [groupNm])

  const handleStatusChange = useCallback(() => {
    const record: EquipmentStatusRecord = {
      status: newStatus,
      reason: statusReason || undefined,
      changedAt: new Date().toISOString(),
      changedBy: statusChangedBy || undefined,
    }
    saveEquipStatus(groupNm, record)
    setEquipStatus(record)
    setStatusHistory(loadEquipStatusHistory(groupNm))
    setStatusChangeOpen(false)
    setStatusReason('')
    setStatusChangedBy('')
  }, [groupNm, newStatus, statusReason, statusChangedBy])

  const currentStatus = equipStatus?.status ?? 'in-service'
  const statusLabel = (s: EquipStatusValue) =>
    s === 'in-service' ? t.detail.statusInService :
    s === 'quarantine' ? t.detail.statusQuarantine :
    t.detail.statusOutOfService

  // ── 허용오차 편집 상태 ──
  const [editOpen, setEditOpen] = useState(false)
  const [editTolValue, setEditTolValue] = useState('')
  const [editTolUnit, setEditTolUnit] = useState('')
  const [editTolNote, setEditTolNote] = useState('')
  const [editMpe, setEditMpe] = useState('')
  const [saving, setSaving] = useState(false)
  const effectiveMpe = mpePercent ?? 100

  const openEdit = () => {
    setEditTolValue(tolerance?.value?.toString() ?? '')
    setEditTolUnit(tolerance?.unit ?? '')
    setEditTolNote(tolerance?.note ?? '')
    setEditMpe(effectiveMpe === 100 ? '' : effectiveMpe.toString())
    setEditOpen(true)
  }

  const saveSpec = async () => {
    if (!items.length) return
    setSaving(true)
    try {
      const newTol: ToleranceData | null = editTolValue
        ? { value: parseFloat(editTolValue), unit: editTolUnit, note: editTolNote || null }
        : null
      const newMpe = editMpe ? parseFloat(editMpe) : 100
      const infoItem = items[0]
      const res = await fetch(`/api/profiles?manufacturer=${encodeURIComponent(infoItem.prdnCmpnNm)}&model=${encodeURIComponent(infoItem.stszNm)}`)
      let profile = res.ok ? await res.json() : null
      if (!profile) {
        profile = {
          manufacturer: infoItem.prdnCmpnNm, model: infoItem.stszNm,
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
      await fetch('/api/profiles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
      onSpecChange(newTol, newMpe)
      setEditOpen(false)
    } finally { setSaving(false) }
  }

  const deleteSpec = async () => {
    if (!items.length) return
    setSaving(true)
    try {
      const infoItem = items[0]
      const res = await fetch(`/api/profiles?manufacturer=${encodeURIComponent(infoItem.prdnCmpnNm)}&model=${encodeURIComponent(infoItem.stszNm)}`)
      const profile = res.ok ? await res.json() : null
      if (profile) {
        profile.spec.tolerance = null
        profile.spec.mpe_percent = null
        profile.spec.manual_tolerance = null
        await fetch('/api/profiles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
      }
      onSpecChange(null, null)
      setEditOpen(false)
    } finally { setSaving(false) }
  }

  // ── 교정이력 데이터 ──
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
      {/* ════════ 섹션 1: 장비 프로필 ════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 이미지 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center justify-center min-h-[240px]">
          {imageLoading ? (
            <div className="w-full h-full bg-gray-50 rounded-lg animate-pulse flex items-center justify-center min-h-[200px]">
              <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          ) : (thumbnailUrl || imageUrl) && !imageError ? (
            <img
              src={thumbnailUrl || imageUrl!}
              alt={equipmentName}
              className="max-w-full max-h-[240px] object-contain rounded-lg"
              onError={() => {
                if (thumbnailUrl && imageUrl) setThumbnailUrl(null)
                else setImageError(true)
              }}
            />
          ) : (
            <div className="w-full min-h-[200px] bg-gray-50 rounded-lg flex flex-col items-center justify-center text-gray-400">
              <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="text-xs">{t.detail.noImage}</span>
            </div>
          )}
        </div>

        {/* 장비 정보 카드 */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 장비 식별 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <SectionHeader
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />}
              title={t.detail.equipmentInfo}
              color="text-slate-400"
              clause="ISO 10012 §7.1 : 측정학적 확인 (Metrological confirmation)"
              requirement={t.detail.reqS71}
            />
            <div className="space-y-2.5">
              {/* 장비 상태 (§8.3 부적합 관리) */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-medium min-w-[72px]">{t.detail.equipStatus}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[currentStatus].bg} ${STATUS_BADGE[currentStatus].text} ${STATUS_BADGE[currentStatus].border}`}>
                    {statusLabel(currentStatus)}
                  </span>
                  <button
                    onClick={() => { setNewStatus(currentStatus); setStatusChangeOpen(true) }}
                    className="p-1 text-slate-300 hover:text-slate-500 transition-colors rounded"
                    title={t.detail.statusChange}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              </div>
              <InfoRow label={t.detail.manufacturer} value={info.prdnCmpnNm} />
              <InfoRow label={t.detail.model} value={info.stszNm} />
              <InfoRow label={t.detail.deviceNo} value={info.mctlNo} />
              <InfoRow label={t.detail.mgmtNo} value={info.custEqpmSrno} />
              <InfoRow label={t.detail.productName} value={info.prdNm} />
            </div>
          </div>

          {/* 장비 상태 변경 모달 */}
          {statusChangeOpen && (
            <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setStatusChangeOpen(false)}>
              <div className="bg-white rounded-xl shadow-xl w-96 p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {t.detail.statusChange}
                </h3>

                <div className="space-y-3">
                  {/* 상태 선택 */}
                  <div className="flex gap-2">
                    {(['in-service', 'quarantine', 'out-of-service'] as EquipStatusValue[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setNewStatus(s)}
                        className={`flex-1 px-2 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                          newStatus === s
                            ? `${STATUS_BADGE[s].bg} ${STATUS_BADGE[s].text} ${STATUS_BADGE[s].border} ring-2 ring-offset-1 ${s === 'in-service' ? 'ring-green-300' : s === 'quarantine' ? 'ring-red-300' : 'ring-slate-300'}`
                            : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>

                  {/* 사유 */}
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">{t.detail.statusReason}</label>
                    <input
                      type="text"
                      value={statusReason}
                      onChange={e => setStatusReason(e.target.value)}
                      placeholder={t.detail.statusReasonPlaceholder}
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  {/* 변경자 */}
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">{t.detail.statusChangedBy}</label>
                    <input
                      type="text"
                      value={statusChangedBy}
                      onChange={e => setStatusChangedBy(e.target.value)}
                      placeholder={t.detail.manager}
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                </div>

                <div className="flex justify-between mt-4 pt-3 border-t border-slate-100">
                  {/* 이력 보기 */}
                  <button
                    onClick={() => { setStatusChangeOpen(false); setShowStatusHistory(v => !v) }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >{t.detail.statusHistory}</button>
                  <div className="flex gap-2">
                    <button onClick={() => setStatusChangeOpen(false)}
                      className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
                    >취소</button>
                    <button onClick={handleStatusChange}
                      className={`px-3 py-1.5 text-xs text-white rounded-lg transition-colors ${
                        newStatus === 'quarantine' ? 'bg-red-600 hover:bg-red-700' :
                        newStatus === 'out-of-service' ? 'bg-slate-600 hover:bg-slate-700' :
                        'bg-green-600 hover:bg-green-700'
                      }`}
                    >{t.detail.caSave}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 상태 변경 이력 */}
          {showStatusHistory && statusHistory.length > 0 && (
            <div className="sm:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-slate-500">{t.detail.statusHistory}</h4>
                <button onClick={() => setShowStatusHistory(false)} className="text-slate-300 hover:text-slate-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {statusHistory.map((rec, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded-full font-medium border ${STATUS_BADGE[rec.status].bg} ${STATUS_BADGE[rec.status].text} ${STATUS_BADGE[rec.status].border}`}>
                      {statusLabel(rec.status)}
                    </span>
                    {rec.reason && <span className="text-slate-500">{rec.reason}</span>}
                    <span className="ml-auto text-slate-400">{new Date(rec.changedAt).toLocaleDateString()}</span>
                    {rec.changedBy && <span className="text-slate-400">{rec.changedBy}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 교정 관리 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <SectionHeader
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
              title={t.detail.calMgmt}
              color="text-blue-400"
            />
            <div className="space-y-2.5">
              <InfoRow label={t.detail.calCycle} value={info.affcCyclCd ? `${info.affcCyclCd}${t.detail.months}` : '-'} />
              <InfoRow label={t.detail.nextCal} value={fmtDate(info.nxtrExrsYmd)} />
              <InfoRow label={t.detail.latestCal} value={fmtDate(info.exrsWrtnYmd)} />
              <InfoRow label={t.detail.calHistory} value={fmt(t.detail.historyUnit, items.length)} />
              <InfoRow label={t.detail.manager} value={info.mngmRsprNm} />
            </div>
          </div>
        </div>
      </div>

      {/* ════════ 섹션 2: 허용오차 & MPE 설정 ════════ */}
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
                <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">ISO 10012 §7.1 : 측정학적 확인 (Metrological confirmation)</span>
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
            <p className="text-xs text-slate-300 mt-1">허용오차를 설정하면 측정분석 탭에서 MPE 판정이 표시됩니다</p>
          </div>
        )}
      </div>

      {/* 허용오차 편집 모달 */}
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
                  type="number" step="any"
                  placeholder="0.5"
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
                  type="number" step="any" min="1" max="100"
                  placeholder="100"
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

      {/* ════════ 섹션 3: 교정 타임라인 ════════ */}
      {timelineData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-700">{t.detail.calTimeline}</h3>
                <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">ISO 10012 §8 : 측정관리시스템 분석 및 개선 (Analysis and improvement)</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{t.detail.reqS8}</p>
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

      {/* ════════ 섹션 4: 교정성적서 분석 ════════ */}
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

// ─── 테이블 컬럼 훅 ───

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
