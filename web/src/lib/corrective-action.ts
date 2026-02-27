/**
 * 시정조치 + 영향평가 타입 & localStorage CRUD
 * ISO 10012 §8.4.2 시정조치 + §8.3.3 부적합 측정장비
 */

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
  /** §8.3.3(a)~(h) 부적합 사유 */
  nonconformityReasons?: string[]
}

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

const CA_KEY = 'correctiveActions'
const IA_KEY = 'impactAssessments'

export function loadCorrectiveActions(): CorrectiveAction[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(CA_KEY) || '[]') } catch { return [] }
}

export function saveCorrectiveActions(list: CorrectiveAction[]) {
  localStorage.setItem(CA_KEY, JSON.stringify(list))
}

export function loadImpactAssessments(): ImpactAssessment[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(IA_KEY) || '[]') } catch { return [] }
}

export function saveImpactAssessments(list: ImpactAssessment[]) {
  localStorage.setItem(IA_KEY, JSON.stringify(list))
}

export const CA_STATUS_STYLE: Record<CAStatus, { bg: string; text: string; border: string }> = {
  'open':         { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  'in-progress':  { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  'verification': { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  'closed':       { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
}

/**
 * §8.3.3(a)~(h) 부적합 사유 목록
 * ISO 10012 원문 기반
 */
export const NONCONFORMITY_REASONS = [
  { key: 'a', labelKo: '손상', labelEn: 'Damaged' },
  { key: 'b', labelKo: '과부하', labelEn: 'Overloaded' },
  { key: 'c', labelKo: '오작동(기능 불량)', labelEn: 'Malfunction' },
  { key: 'd', labelKo: '부정확한 측정결과', labelEn: 'Inaccurate results' },
  { key: 'e', labelKo: '확인주기 초과', labelEn: 'Exceeded confirmation interval' },
  { key: 'f', labelKo: '잘못 취급됨', labelEn: 'Mishandled' },
  { key: 'g', labelKo: '봉인/안전장치 파손', labelEn: 'Seal/protection damaged' },
  { key: 'h', labelKo: '영향량 노출 (전자기장, 먼지 등)', labelEn: 'Exposed to influence quantities' },
] as const
