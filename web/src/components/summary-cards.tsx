'use client'

import { useT, fmt } from '@/lib/i18n'

interface SummaryProps {
  총건수: number
  미처리건수: number
  교정임박건수: number
  평균소요일: number
  데이터시점: string
  cacheRemaining?: number
}

export default function SummaryCards({ 총건수, 미처리건수, 교정임박건수, 평균소요일, 데이터시점, cacheRemaining }: SummaryProps) {
  const { t, lang } = useT()

  // 미처리·임박은 "0이 정상", 그 외는 무채색 데이터 표시
  const cards = [
    {
      label: t.summary.total, value: 총건수.toLocaleString(), unit: t.summary.unit,
      valueColor: 'text-slate-900', iconColor: 'text-slate-400',
      icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
    },
    {
      label: t.summary.unprocessed, value: 미처리건수.toLocaleString(), unit: t.summary.unit,
      valueColor: 미처리건수 > 0 ? 'text-red-600' : 'text-slate-900',
      iconColor: 미처리건수 > 0 ? 'text-red-400' : 'text-slate-400',
      icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    {
      label: t.summary.upcoming, value: 교정임박건수.toLocaleString(), unit: t.summary.unit,
      valueColor: 교정임박건수 > 0 ? 'text-amber-600' : 'text-slate-900',
      iconColor: 교정임박건수 > 0 ? 'text-amber-400' : 'text-slate-400',
      icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    },
    {
      label: t.summary.avgDays, value: String(평균소요일), unit: t.summary.days,
      valueColor: 'text-slate-900', iconColor: 'text-slate-400',
      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    },
  ]

  const 시점 = new Date(데이터시점)
  const 남은분 = cacheRemaining ? Math.round(cacheRemaining / 60000) : 0

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(card => (
          <div
            key={card.label}
            className="bg-white rounded-md border border-slate-200 p-5 transition-colors hover:border-slate-300"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-slate-500">{card.label}</p>
              <svg className={`w-4 h-4 ${card.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={card.icon} />
              </svg>
            </div>
            <p className={`text-4xl font-semibold tabular-nums tracking-tight leading-none ${card.valueColor}`}>
              {card.value}
              {card.unit && <span className="text-base font-normal text-slate-400 ml-1.5">{card.unit}</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
