/**
 * 장비 상세페이지 공유 React 컴포넌트
 * — equipment-detail-page.tsx에서 추출
 */
'use client'

import { type ReactNode } from 'react'
import { useT, fmt } from '@/lib/i18n'
import { TREND_COLORS } from './shared-utils'

// ──────────────────────────── InfoRow ────────────────────────────

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm text-gray-400 whitespace-nowrap min-w-[56px]">{label}</span>
      <span className="text-sm text-gray-800 font-medium truncate" title={value}>{value || '-'}</span>
    </div>
  )
}

// ──────────────────────────── SectionHeader ────────────────────────────

export function SectionHeader({ icon, title, color, clause }: { icon: ReactNode; title: string; color: string; clause?: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icon}
      </svg>
      <span className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
      {clause && (
        <span className="px-2 py-0.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-md border border-indigo-200">
          {clause}
        </span>
      )}
    </div>
  )
}

// ──────────────────────────── DdayBadge ────────────────────────────

export function DdayBadge({ dday }: { dday: number }) {
  const { t } = useT()
  let label: string
  let color: string

  if (dday < 0) {
    const abs = Math.abs(dday)
    if (abs >= 365) {
      const y = Math.floor(abs / 365)
      const m = Math.floor((abs % 365) / 30)
      label = m > 0 ? fmt(t.time.yearMonthOver, y, m) : fmt(t.time.yearOver, y)
    } else if (abs >= 30) {
      label = fmt(t.time.monthOver, Math.floor(abs / 30))
    } else {
      label = fmt(t.time.dayOver, abs)
    }
    color = 'text-red-600 bg-red-50 border-red-200'
  } else if (dday === 0) {
    label = t.detail.todayExpired
    color = 'text-red-600 bg-red-50 border-red-200'
  } else if (dday <= 30) {
    label = `D-${dday}`
    color = 'text-orange-600 bg-orange-50 border-orange-200'
  } else if (dday <= 60) {
    label = `D-${dday}`
    color = 'text-amber-600 bg-amber-50 border-amber-200'
  } else if (dday <= 90) {
    label = `D-${dday}`
    color = 'text-blue-600 bg-blue-50 border-blue-200'
  } else {
    label = `D-${dday}`
    color = 'text-green-600 bg-green-50 border-green-200'
  }

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-bold border ${color}`}>
      {label}
    </span>
  )
}

// ──────────────────────────── StabilityBadge ────────────────────────────

export function StabilityBadge({ level }: { level: 'safe' | 'warning' | 'danger' }) {
  const { t } = useT()
  const style = level === 'safe' ? 'bg-green-100 text-green-700'
    : level === 'warning' ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'
  const label = level === 'safe' ? t.detail.safe : level === 'warning' ? t.detail.warning : t.detail.danger
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${style}`}>{label}</span>
}

// ──────────────────────────── TrendChartTooltip ────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export function TrendChartTooltip({ active, payload, label, yearLabels, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2.5 shadow-xl border border-slate-700 min-w-[160px]">
      <p className="text-slate-300 font-medium mb-1.5">{label}</p>
      {payload.filter((p: any) => p.value != null && !['허용상한', '허용하한', 'MPE상한', 'MPE하한'].includes(p.dataKey)).map((p: any, i: number) => {
        const idx = yearLabels?.indexOf(p.dataKey) ?? -1
        return (
          <div key={i} className="flex items-center justify-between gap-3 py-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.stroke }} />
              <span className="text-slate-300">{p.dataKey}</span>
            </div>
            <span className="font-mono font-medium" style={{ color: TREND_COLORS[idx >= 0 ? idx % TREND_COLORS.length : 0] }}>
              {p.value}{unit ? ` ${unit}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
