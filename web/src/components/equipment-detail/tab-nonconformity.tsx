/**
 * 탭 4: 부적합·시정 (Nonconformity & Corrective Action)
 * ISO 10012 §8.3.3 부적합 측정장비 + §8.4.2 시정조치
 * localStorage 기반 CRUD + 워크플로우 (open → in-progress → verification → closed)
 */
'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { CertResult } from '@/lib/cert-cache'
import { useT } from '@/lib/i18n'
import { SectionHeader } from './shared-components'

// ─── 시정조치 타입 ───

export type CAStatus = 'open' | 'in-progress' | 'verification' | 'closed'

export interface CorrectiveAction {
  id: string
  acptNo: string
  status: CAStatus
  createdAt: string
  description: string
  rootCause?: string
  action?: string
  actionDate?: string
  verification?: string
  closedAt?: string
  closedBy?: string
}

// ─── 영향평가 타입 ───

export interface ImpactAssessment {
  acptNo: string
  lastPassDate?: string
  failDate: string
  affectedPeriod?: string
  affectedPoints: string[]
  impactScope?: string
  disposition?: string
  assessedAt?: string
}

// ─── localStorage 헬퍼 ───

const CA_KEY = 'correctiveActions'
const IA_KEY = 'impactAssessments'

export function loadCorrectiveActions(): CorrectiveAction[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(CA_KEY) || '[]') } catch { return [] }
}

function saveCorrectiveActions(list: CorrectiveAction[]) {
  localStorage.setItem(CA_KEY, JSON.stringify(list))
}

export function loadImpactAssessments(): ImpactAssessment[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(IA_KEY) || '[]') } catch { return [] }
}

function saveImpactAssessments(list: ImpactAssessment[]) {
  localStorage.setItem(IA_KEY, JSON.stringify(list))
}

// ─── 상태 색상 ───

const CA_STATUS_STYLE: Record<CAStatus, { bg: string; text: string; border: string }> = {
  'open':         { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  'in-progress':  { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  'verification': { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  'closed':       { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
}

// ─── Props ───

interface Props {
  groupNm: string
  certs: Map<string, CertResult>
}

// ─── 메인 ───

export default function TabNonconformity({ groupNm, certs }: Props) {
  const { t } = useT()

  // 시정조치 목록 (이 장비만 필터)
  const [allCAs, setAllCAs] = useState<CorrectiveAction[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Partial<CorrectiveAction>>({})

  // 영향평가 목록
  const [allIAs, setAllIAs] = useState<ImpactAssessment[]>([])

  useEffect(() => {
    setAllCAs(loadCorrectiveActions())
    setAllIAs(loadImpactAssessments())
  }, [])

  // 이 장비 관련 시정조치만
  const myCAs = useMemo(() =>
    allCAs
      .filter(ca => ca.acptNo.startsWith(groupNm.replace(/\s/g, '')))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allCAs, groupNm],
  )

  // 부적합 성적서 목록 (FAIL 판정)
  const failCerts = useMemo(() => {
    const results: { acptNo: string; cert: CertResult }[] = []
    certs.forEach((cert, acptNo) => {
      if (cert.전체판정 === 'FAIL') results.push({ acptNo, cert })
    })
    return results
  }, [certs])

  // 영향평가 자동 산출: 각 FAIL 성적서에 대해 마지막 PASS → FAIL 기간 + 부적합 포인트
  const autoImpactData = useMemo(() => {
    const result: Map<string, ImpactAssessment> = new Map()
    const sortedCerts = Array.from(certs.entries()).sort((a, b) => {
      const dateA = a[1].교정일 || ''
      const dateB = b[1].교정일 || ''
      return dateA.localeCompare(dateB)
    })

    for (const { acptNo, cert } of failCerts) {
      // 마지막 PASS 찾기 (이 FAIL 이전)
      let lastPassDate: string | undefined
      for (const [, c] of sortedCerts) {
        if (c.전체판정 === 'PASS' && c.교정일 && cert.교정일 && c.교정일 < cert.교정일) {
          lastPassDate = c.교정일
        }
      }

      // 부적합 측정포인트 목록
      const failPoints: string[] = []
      if (cert.측정결과) {
        for (const mp of cert.측정결과) {
          if (mp.판정 === 'FAIL') {
            failPoints.push(mp.기준값 || mp.원본데이터?.[0] || 'Unknown')
          }
        }
      }

      const period = lastPassDate && cert.교정일
        ? `${lastPassDate} ~ ${cert.교정일}`
        : undefined

      result.set(acptNo, {
        acptNo,
        lastPassDate,
        failDate: cert.교정일 || '',
        affectedPeriod: period,
        affectedPoints: failPoints,
      })
    }
    return result
  }, [certs, failCerts])

  // 시정조치 CRUD
  const createCA = useCallback(() => {
    const newCA: CorrectiveAction = {
      id: crypto.randomUUID(),
      acptNo: groupNm.replace(/\s/g, ''),
      status: 'open',
      createdAt: new Date().toISOString(),
      description: '',
    }
    const updated = [newCA, ...allCAs]
    setAllCAs(updated)
    saveCorrectiveActions(updated)
    setEditingId(newCA.id)
    setFormData(newCA)
  }, [allCAs, groupNm])

  const saveCA = useCallback(() => {
    if (!editingId) return
    const updated = allCAs.map(ca =>
      ca.id === editingId ? { ...ca, ...formData } as CorrectiveAction : ca,
    )
    setAllCAs(updated)
    saveCorrectiveActions(updated)
    setEditingId(null)
    setFormData({})
  }, [allCAs, editingId, formData])

  const deleteCA = useCallback((id: string) => {
    if (!confirm(t.detail.caConfirmDelete)) return
    const updated = allCAs.filter(ca => ca.id !== id)
    setAllCAs(updated)
    saveCorrectiveActions(updated)
    if (editingId === id) { setEditingId(null); setFormData({}) }
  }, [allCAs, editingId, t])

  const advanceStatus = useCallback((ca: CorrectiveAction) => {
    const flow: CAStatus[] = ['open', 'in-progress', 'verification', 'closed']
    const idx = flow.indexOf(ca.status)
    if (idx < flow.length - 1) {
      const next = flow[idx + 1]
      const updates: Partial<CorrectiveAction> = { status: next }
      if (next === 'closed') {
        updates.closedAt = new Date().toISOString().slice(0, 10)
      }
      const updated = allCAs.map(c => c.id === ca.id ? { ...c, ...updates } : c)
      setAllCAs(updated)
      saveCorrectiveActions(updated)
    }
  }, [allCAs])

  const startEdit = useCallback((ca: CorrectiveAction) => {
    setEditingId(ca.id)
    setFormData({ ...ca })
  }, [])

  // 영향평가 수동 입력 저장
  const saveIA = useCallback((acptNo: string, scope: string, disposition: string) => {
    const existing = allIAs.filter(ia => ia.acptNo !== acptNo)
    const autoData = autoImpactData.get(acptNo)
    const updated = [
      ...existing,
      {
        ...autoData,
        acptNo,
        lastPassDate: autoData?.lastPassDate,
        failDate: autoData?.failDate || '',
        affectedPeriod: autoData?.affectedPeriod,
        affectedPoints: autoData?.affectedPoints || [],
        impactScope: scope || undefined,
        disposition: disposition || undefined,
        assessedAt: new Date().toISOString().slice(0, 10),
      },
    ]
    setAllIAs(updated)
    saveImpactAssessments(updated)
  }, [allIAs, autoImpactData])

  const statusLabel = (s: CAStatus) =>
    s === 'open' ? t.detail.caStatusOpen :
    s === 'in-progress' ? t.detail.caStatusInProgress :
    s === 'verification' ? t.detail.caStatusVerification :
    t.detail.caStatusClosed

  return (
    <div className="space-y-6">
      {/* ════════ 섹션 1: 시정조치 목록 ════════ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <SectionHeader
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />}
            title={t.detail.caTitle}
            color="text-amber-500"
            clause="ISO 10012 §8.4.2 : 시정조치 (Corrective action) + §8.3.3 : 부적합 측정장비"
            requirement={t.detail.reqS833}
          />
          <button
            onClick={createCA}
            className="px-3 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors"
          >
            + {t.detail.caNew}
          </button>
        </div>

        {myCAs.length === 0 ? (
          <div className="bg-slate-50 rounded-lg p-6 border border-dashed border-slate-200 text-center">
            <p className="text-sm text-slate-400">{t.detail.caNoItems}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myCAs.map(ca => {
              const isEditing = editingId === ca.id
              const style = CA_STATUS_STYLE[ca.status]

              return (
                <div key={ca.id} className={`rounded-lg border p-4 ${isEditing ? 'border-amber-300 bg-amber-50/30' : 'border-gray-100'}`}>
                  {/* 헤더 */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${style.bg} ${style.text} ${style.border}`}>
                      {statusLabel(ca.status)}
                    </span>
                    <span className="text-[11px] text-slate-400">{new Date(ca.createdAt).toLocaleDateString()}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {ca.status !== 'closed' && (
                        <button
                          onClick={() => advanceStatus(ca)}
                          className="px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          {t.detail.caNextStep} →
                        </button>
                      )}
                      <button
                        onClick={() => isEditing ? saveCA() : startEdit(ca)}
                        className="px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 rounded transition-colors"
                      >
                        {isEditing ? t.detail.caSave : '✏️'}
                      </button>
                      <button
                        onClick={() => deleteCA(ca.id)}
                        className="px-2 py-1 text-[11px] text-red-400 hover:bg-red-50 rounded transition-colors"
                      >
                        {t.detail.caDelete}
                      </button>
                    </div>
                  </div>

                  {/* 편집 모드 */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={formData.description ?? ''}
                        onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                        placeholder={t.detail.caDescPlaceholder}
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
                        autoFocus
                      />
                      {(ca.status === 'in-progress' || ca.status === 'verification' || ca.status === 'closed') && (
                        <>
                          <textarea
                            value={formData.rootCause ?? ''}
                            onChange={e => setFormData(f => ({ ...f, rootCause: e.target.value }))}
                            placeholder={t.detail.caRootCausePlaceholder}
                            rows={2}
                            className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
                          />
                          <textarea
                            value={formData.action ?? ''}
                            onChange={e => setFormData(f => ({ ...f, action: e.target.value }))}
                            placeholder={t.detail.caActionPlaceholder}
                            rows={2}
                            className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
                          />
                        </>
                      )}
                      {(ca.status === 'verification' || ca.status === 'closed') && (
                        <textarea
                          value={formData.verification ?? ''}
                          onChange={e => setFormData(f => ({ ...f, verification: e.target.value }))}
                          placeholder={t.detail.caVerificationPlaceholder}
                          rows={2}
                          className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
                        />
                      )}
                      {ca.status === 'closed' && (
                        <input
                          type="text"
                          value={formData.closedBy ?? ''}
                          onChange={e => setFormData(f => ({ ...f, closedBy: e.target.value }))}
                          placeholder={t.detail.caClosedBy}
                          className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
                        />
                      )}
                    </div>
                  ) : (
                    /* 보기 모드 */
                    <div className="space-y-1 text-sm">
                      <p className="text-slate-700 font-medium">{ca.description || <span className="text-slate-300 italic">{t.detail.caDescPlaceholder}</span>}</p>
                      {ca.rootCause && (
                        <p className="text-slate-500"><span className="text-slate-400 text-xs font-medium">{t.detail.caRootCause}:</span> {ca.rootCause}</p>
                      )}
                      {ca.action && (
                        <p className="text-slate-500"><span className="text-slate-400 text-xs font-medium">{t.detail.caAction}:</span> {ca.action}</p>
                      )}
                      {ca.verification && (
                        <p className="text-slate-500"><span className="text-slate-400 text-xs font-medium">{t.detail.caVerification}:</span> {ca.verification}</p>
                      )}
                      {ca.closedBy && (
                        <p className="text-xs text-slate-400">{t.detail.caClosedBy}: {ca.closedBy} ({ca.closedAt})</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ════════ 섹션 2: 영향평가 ════════ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <SectionHeader
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />}
          title={t.detail.iaTitle}
          color="text-orange-500"
          clause="ISO 10012 §8.3.3 : 부적합 측정장비 (Nonconforming measuring equipment)"
          requirement={t.detail.reqS83Ia}
        />

        {failCerts.length === 0 ? (
          <div className="bg-slate-50 rounded-lg p-6 border border-dashed border-slate-200 text-center mt-3">
            <p className="text-sm text-slate-400">{t.detail.iaNoData}</p>
          </div>
        ) : (
          <div className="space-y-3 mt-3">
            {failCerts.map(({ acptNo, cert }) => {
              const autoData = autoImpactData.get(acptNo)
              const savedIA = allIAs.find(ia => ia.acptNo === acptNo)
              return (
                <ImpactCard
                  key={acptNo}
                  acptNo={acptNo}
                  cert={cert}
                  autoData={autoData}
                  savedIA={savedIA}
                  onSave={saveIA}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 영향평가 카드 ───

function ImpactCard({
  acptNo, cert, autoData, savedIA, onSave,
}: {
  acptNo: string
  cert: CertResult
  autoData?: ImpactAssessment
  savedIA?: ImpactAssessment
  onSave: (acptNo: string, scope: string, disposition: string) => void
}) {
  const { t } = useT()
  const [scope, setScope] = useState(savedIA?.impactScope ?? '')
  const [disposition, setDisposition] = useState(savedIA?.disposition ?? '')
  const [editing, setEditing] = useState(false)

  return (
    <div className="rounded-lg border border-orange-100 bg-orange-50/30 p-4">
      {/* 자동 산출 정보 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[11px] font-semibold">FAIL</span>
        <span className="text-xs text-slate-500 font-mono">{acptNo}</span>
        <span className="text-xs text-slate-400">{cert.교정일}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {autoData?.lastPassDate && (
          <div className="rounded bg-white p-2 border border-orange-100">
            <p className="text-[10px] text-slate-400 mb-0.5">{t.detail.iaLastPass}</p>
            <p className="text-xs font-medium text-slate-700">{autoData.lastPassDate}</p>
          </div>
        )}
        <div className="rounded bg-white p-2 border border-orange-100">
          <p className="text-[10px] text-slate-400 mb-0.5">{t.detail.iaFailDate}</p>
          <p className="text-xs font-medium text-red-600">{autoData?.failDate || cert.교정일}</p>
        </div>
        {autoData?.affectedPeriod && (
          <div className="rounded bg-white p-2 border border-orange-100 sm:col-span-2">
            <p className="text-[10px] text-slate-400 mb-0.5">{t.detail.iaAffectedPeriod} <span className="text-orange-400">({t.detail.iaAutoCalculated})</span></p>
            <p className="text-xs font-medium text-orange-700">{autoData.affectedPeriod}</p>
          </div>
        )}
      </div>

      {/* 부적합 포인트 */}
      {autoData && autoData.affectedPoints.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] text-slate-400 mb-1">{t.detail.iaAffectedPoints}</p>
          <div className="flex flex-wrap gap-1">
            {autoData.affectedPoints.map((pt, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[11px] font-medium border border-red-100">
                {pt}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 수동 입력 (영향 범위 + 조치 결과) */}
      {editing ? (
        <div className="space-y-2 pt-2 border-t border-orange-100">
          <div>
            <label className="text-[10px] text-slate-500 font-medium block mb-0.5">{t.detail.iaImpactScope}</label>
            <textarea
              value={scope}
              onChange={e => setScope(e.target.value)}
              placeholder={t.detail.iaImpactScopePlaceholder}
              rows={2}
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-medium block mb-0.5">{t.detail.iaDisposition}</label>
            <input
              type="text"
              value={disposition}
              onChange={e => setDisposition(e.target.value)}
              placeholder={t.detail.iaDispositionPlaceholder}
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
            >취소</button>
            <button
              onClick={() => { onSave(acptNo, scope, disposition); setEditing(false) }}
              className="px-3 py-1.5 text-xs text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors"
            >{t.detail.caSave}</button>
          </div>
        </div>
      ) : (
        <div className="pt-2 border-t border-orange-100">
          {savedIA?.impactScope || savedIA?.disposition ? (
            <div className="space-y-1 text-sm">
              {savedIA.impactScope && (
                <p className="text-slate-600"><span className="text-slate-400 text-xs">{t.detail.iaImpactScope}:</span> {savedIA.impactScope}</p>
              )}
              {savedIA.disposition && (
                <p className="text-slate-600"><span className="text-slate-400 text-xs">{t.detail.iaDisposition}:</span> {savedIA.disposition}</p>
              )}
              <div className="flex items-center gap-2">
                {savedIA.assessedAt && <span className="text-[10px] text-slate-400">{t.detail.iaAssessedAt}: {savedIA.assessedAt}</span>}
                <button
                  onClick={() => setEditing(true)}
                  className="text-[10px] text-orange-500 hover:text-orange-700 transition-colors"
                >✏️</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-orange-500 hover:text-orange-700 transition-colors"
            >
              + {t.detail.iaImpactScope} / {t.detail.iaDisposition}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
