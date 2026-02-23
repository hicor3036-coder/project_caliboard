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
    { label: t.summary.total, value: 총건수.toLocaleString(), unit: t.summary.unit, color: 'bg-blue-500' },
    { label: t.summary.unprocessed, value: 미처리건수.toLocaleString(), unit: t.summary.unit, color: 미처리건수 > 0 ? 'bg-red-500' : 'bg-green-500' },
    { label: t.summary.upcoming, value: 교정임박건수.toLocaleString(), unit: t.summary.unit, color: 교정임박건수 > 0 ? 'bg-amber-500' : 'bg-green-500' },
    { label: t.summary.avgDays, value: String(평균소요일), unit: t.summary.days, color: 'bg-indigo-500' },
  ]

  const 시점 = new Date(데이터시점)
  const 남은분 = cacheRemaining ? Math.round(cacheRemaining / 60000) : 0

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className={`inline-block w-2 h-2 rounded-full ${card.color} mb-2`} />
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-3xl font-bold mt-1">
              {card.value}{card.unit && <span className="text-base font-normal text-gray-400 ml-1">{card.unit}</span>}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 text-right">
        {t.summary.dataTime}: {시점.toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US')}
        {남은분 > 0 && ` · ${fmt(t.summary.cacheExpiry, 남은분)}`}
      </p>
    </div>
  )
}
