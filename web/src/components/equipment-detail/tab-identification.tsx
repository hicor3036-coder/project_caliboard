/**
 * 탭 1: 장비 식별 (Equipment Identification)
 * ISO 10012 §6.2.4 식별 + §6.3.1 측정장비 + §7.1.2 확인주기
 */
'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import type { CertResult } from '@/lib/cert-cache'
import { useT, fmt } from '@/lib/i18n'
import {
  type EquipStatusValue, type EquipmentStatusRecord,
  loadEquipStatus, loadEquipStatusHistory, saveEquipStatus, STATUS_BADGE,
} from '@/lib/equipment-status'
import DataTable, { type Column, fmtDate } from '../data-table'
import type { DetailItem, TableRow, CertProgress } from './shared-utils'
import { parseYmd, daysBetween } from './shared-utils'
import { InfoRow, SectionHeader } from './shared-components'
import ToleranceEditor, { type ToleranceData } from './tolerance-editor'
import CertListSection from './cert-list-section'

// re-export for backward compatibility
export type { EquipStatusValue } from '@/lib/equipment-status'

interface Props {
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
  certs: Map<string, CertResult>
  certErrors: Map<string, string>
  certProgress: CertProgress
  certLoading: boolean
  certDone: boolean
  fetchCerts: (refresh?: boolean) => void
  onSelectCert: (acptNo: string, cert: CertResult) => void
}

export default function TabIdentification({
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
              clause="ISO 10012 §6.2.4 : 식별 (Identification)"
              requirement={t.detail.reqS624}
            />
            <div className="space-y-2.5">
              {/* 장비 상태 (§6.2.4 측정학적 확인 상태 식별) */}
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
            <StatusChangeModal
              currentStatus={currentStatus}
              newStatus={newStatus}
              setNewStatus={setNewStatus}
              statusReason={statusReason}
              setStatusReason={setStatusReason}
              statusChangedBy={statusChangedBy}
              setStatusChangedBy={setStatusChangedBy}
              onSave={handleStatusChange}
              onClose={() => setStatusChangeOpen(false)}
              onShowHistory={() => { setStatusChangeOpen(false); setShowStatusHistory(v => !v) }}
              statusLabel={statusLabel}
              t={t}
            />
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
      <ToleranceEditor
        tolerance={tolerance}
        mpePercent={mpePercent}
        manufacturer={info.prdnCmpnNm}
        model={info.stszNm}
        onSpecChange={onSpecChange}
      />

      {/* ════════ 섹션 3: 교정 타임라인 ════════ */}
      {timelineData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-700">{t.detail.calTimeline}</h3>
                <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">ISO 10012 §6.2.3 : 기록 (Records) / §7.1.2 : 확인주기 (Confirmation intervals)</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{t.detail.reqS712}</p>
            </div>
            <button
              onClick={() => setHistoryTableOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              {historyTableOpen ? t.detail.hideDetail : t.detail.showDetail}
              <svg className={`w-3.5 h-3.5 transition-transform ${historyTableOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <CertListSection
        certs={certs}
        certErrors={certErrors}
        certProgress={certProgress}
        certLoading={certLoading}
        certDone={certDone}
        fetchCerts={fetchCerts}
        onSelectCert={onSelectCert}
      />
    </div>
  )
}

// ─── 상태 변경 모달 (분리된 서브 컴포넌트) ───

function StatusChangeModal({
  currentStatus: _currentStatus, newStatus, setNewStatus,
  statusReason, setStatusReason, statusChangedBy, setStatusChangedBy,
  onSave, onClose, onShowHistory, statusLabel, t,
}: {
  currentStatus: EquipStatusValue
  newStatus: EquipStatusValue
  setNewStatus: (s: EquipStatusValue) => void
  statusReason: string
  setStatusReason: (s: string) => void
  statusChangedBy: string
  setStatusChangedBy: (s: string) => void
  onSave: () => void
  onClose: () => void
  onShowHistory: () => void
  statusLabel: (s: EquipStatusValue) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}) {
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-96 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-1.5">
          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {t.detail.statusChange}
        </h3>
        <div className="space-y-3">
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
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">{t.detail.statusReason}</label>
            <input type="text" value={statusReason} onChange={e => setStatusReason(e.target.value)}
              placeholder={t.detail.statusReasonPlaceholder}
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">{t.detail.statusChangedBy}</label>
            <input type="text" value={statusChangedBy} onChange={e => setStatusChangedBy(e.target.value)}
              placeholder={t.detail.manager}
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>
        <div className="flex justify-between mt-4 pt-3 border-t border-slate-100">
          <button onClick={onShowHistory} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">{t.detail.statusHistory}</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 rounded-lg transition-colors">취소</button>
            <button onClick={onSave}
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
