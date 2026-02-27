/**
 * 장비 상태 관리 (ISO 10012 §6.2.4 식별 + §8.3.3 부적합 측정장비)
 * localStorage 기반 CRUD
 */

export type EquipStatusValue = 'in-service' | 'quarantine' | 'out-of-service'

export interface EquipmentStatusRecord {
  status: EquipStatusValue
  reason?: string
  changedAt: string
  changedBy?: string
}

const PREFIX = 'equipStatus_'

export function loadEquipStatus(groupNm: string): EquipmentStatusRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFIX + groupNm)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function loadEquipStatusHistory(groupNm: string): EquipmentStatusRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(PREFIX + groupNm + '_history')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveEquipStatus(groupNm: string, record: EquipmentStatusRecord) {
  const key = PREFIX + groupNm
  localStorage.setItem(key, JSON.stringify(record))
  const histKey = key + '_history'
  try {
    const hist: EquipmentStatusRecord[] = JSON.parse(localStorage.getItem(histKey) || '[]')
    hist.unshift(record)
    localStorage.setItem(histKey, JSON.stringify(hist.slice(0, 50)))
  } catch {
    localStorage.setItem(histKey, JSON.stringify([record]))
  }
}

export const STATUS_BADGE: Record<EquipStatusValue, { bg: string; text: string; border: string }> = {
  'in-service':     { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  'quarantine':     { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  'out-of-service': { bg: 'bg-slate-100', text: 'text-slate-600',  border: 'border-slate-300' },
}
