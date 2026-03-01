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

  const cards = [
    {
      label: t.summary.total, value: 총건수.toLocaleString(), unit: t.summary.unit,
      accent: 'bg-blue-500', iconBg: 'bg-blue-50', iconColor: 'text-blue-500',
      icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
    },
    {
      label: t.summary.unprocessed, value: 미처리건수.toLocaleString(), unit: t.summary.unit,
      accent: 미처리건수 > 0 ? 'bg-red-500' : 'bg-green-500',
      iconBg: 미처리건수 > 0 ? 'bg-red-50' : 'bg-green-50',
      iconColor: 미처리건수 > 0 ? 'text-red-500' : 'text-green-500',
      icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    {
      label: t.summary.upcoming, value: 교정임박건수.toLocaleString(), unit: t.summary.unit,
      accent: 교정임박건수 > 0 ? 'bg-amber-500' : 'bg-green-500',
      iconBg: 교정임박건수 > 0 ? 'bg-amber-50' : 'bg-green-50',
      iconColor: 교정임박건수 > 0 ? 'text-amber-500' : 'text-green-500',
      icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    },
    {
      label: t.summary.avgDays, value: String(평균소요일), unit: t.summary.days,
      accent: 'bg-indigo-500', iconBg: 'bg-indigo-50', iconColor: 'text-indigo-500',
      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    },
  ]

  const 시점 = new Date(데이터시점)
  const 남은분 = cacheRemaining ? Math.round(cacheRemaining / 60000) : 0

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className={`h-1 ${card.accent}`} />
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm text-gray-500">{card.label}</p>
                <div className={`w-9 h-9 rounded-lg ${card.iconBg} flex items-center justify-center shrink-0`}>
                  <svg className={`w-5 h-5 ${card.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={card.icon} />
                  </svg>
                </div>
              </div>
              <p className="text-3xl font-bold">
                {card.value}{card.unit && <span className="text-base font-normal text-gray-400 ml-1">{card.unit}</span>}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
