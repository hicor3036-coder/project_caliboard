'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useCallback } from 'react'
import { PieChart, Pie, Cell, Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useT } from '@/lib/i18n'

// 차분한 B2B 팔레트 — 형광색 회피, 채도 한 단계 낮춤
const COLORS = ['#2563eb', '#0891b2', '#4f46e5', '#7c3aed', '#0d9488', '#d97706', '#dc2626', '#475569']

// 공통 차트 카드 래퍼 — 차트 4종 시각 통일
function ChartCard({ title, dotColor, children, className = '' }: {
  title: string
  dotColor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-white rounded-md border border-slate-200 p-5 print-chart-compact ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</h2>
      </div>
      {children}
    </div>
  )
}

// 커스텀 툴팁
function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-slate-700">
      {label && <p className="text-slate-300 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium">
          {p.name ?? p.dataKey}: <span className="text-blue-300">{Number(p.value).toLocaleString()}{unit}</span>
        </p>
      ))}
    </div>
  )
}

const RADIAN = Math.PI / 180

// 진행상태 분포 도넛차트 (폴리라인 라벨 + 겹침 방지)
export function StatusPieChart({ data }: { data: { label: string; value: number }[] }) {
  const { t } = useT()
  const unit = t.chart.unit
  const top = data.slice(0, 5)
  const rest = data.slice(5).reduce((sum, d) => sum + d.value, 0)
  const chartData = (rest > 0 ? [...top, { label: t.chart.etc, value: rest }] : top).filter(d => d.value > 0)
  const total = chartData.reduce((s, d) => s + d.value, 0)

  // 충돌 회피용 y좌표 사전 계산
  const labelLayout = useMemo(() => {
    if (total === 0) return []

    let angle = 0
    const items = chartData.map((d, i) => {
      const slice = (d.value / total) * 360
      const mid = angle + slice / 2
      angle += slice

      const midRad = mid * RADIAN
      const sinA = Math.sin(midRad)
      const side: 'right' | 'left' = Math.cos(midRad) >= 0 ? 'right' : 'left'

      return {
        index: i,
        name: d.label,
        value: d.value,
        side,
        normalY: -sinA,
        adjustedY: -sinA,
      }
    })

    const MIN_GAP = 0.22
    for (const s of ['right', 'left'] as const) {
      const group = items
        .filter(item => item.side === s)
        .sort((a, b) => a.normalY - b.normalY)
      for (let j = 1; j < group.length; j++) {
        if (group[j].adjustedY - group[j - 1].adjustedY < MIN_GAP) {
          group[j].adjustedY = group[j - 1].adjustedY + MIN_GAP
        }
      }
    }

    return items
  }, [chartData, total])

  // recharts가 전달하는 실제 midAngle 사용 → 포인터 정확도 보장
  const renderLabel = useCallback((props: any) => {
    const { cx, cy, outerRadius, midAngle, index } = props
    const item = labelLayout[index]
    if (!item) return null

    const cos = Math.cos(midAngle * RADIAN)
    const sin = Math.sin(midAngle * RADIAN)
    const side = cos >= 0 ? 'right' : 'left'

    // 도넛 테두리 위 시작점 (recharts 실제 각도)
    const sx = cx + (outerRadius + 6) * cos
    const sy = cy - (outerRadius + 6) * sin

    // 꺾이는 팔꿈치 (좌/우 고정 x, 충돌 회피된 y)
    const armLen = outerRadius + 30
    const elbowX = side === 'right' ? cx + armLen : cx - armLen
    const elbowY = cy + item.adjustedY * (outerRadius + 10)

    // 수평 꼬리
    const textX = side === 'right' ? elbowX + 8 : elbowX - 8
    const anchor = side === 'right' ? 'start' : 'end'

    return (
      <g>
        <path
          d={`M${sx},${sy}L${elbowX},${elbowY}L${textX},${elbowY}`}
          stroke="#cbd5e1"
          strokeWidth={1}
          fill="none"
        />
        <circle cx={sx} cy={sy} r={2} fill="#94a3b8" />
        <text
          x={textX + (side === 'right' ? 3 : -3)}
          y={elbowY}
          textAnchor={anchor}
          dominantBaseline="central"
          fontSize={11}
          fontWeight={500}
          fill="#475569"
        >
          {item.name} {item.value.toLocaleString()}{unit}
        </text>
      </g>
    )
  }, [labelLayout, unit])

  return (
    <ChartCard title={t.chart.statusDist} dotColor="bg-blue-500">
      <ResponsiveContainer width="100%" height={320}>
        <PieChart margin={{ left: 100, right: 100 }}>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            label={renderLabel}
            labelLine={false}
            strokeWidth={0}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip unit={unit} />} />
          <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" fill="#94a3b8" fontSize={11}>
            {t.chart.total}
          </text>
          <text x="50%" y="55%" textAnchor="middle" dominantBaseline="central" fill="#1e293b" fontSize={18} fontWeight={700}>
            {total.toLocaleString()}
          </text>
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// 월별 접수 추이 — 라인차트 + 옅은 영역 (추세 강조)
export function MonthlyBarChart({ data }: { data: { month: string; 건수: number }[] }) {
  const { t } = useT()
  const recent = data.slice(-12)
  const unit = t.chart.unit

  return (
    <ChartCard title={t.chart.monthlyTrend} dotColor="bg-blue-500">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={recent} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="monthlyAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickFormatter={(v: string) => v.slice(2)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="건수"
            stroke="#2563eb"
            strokeWidth={2}
            fill="url(#monthlyAreaFill)"
            dot={{ r: 3, fill: '#2563eb', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// 제조사별 / 담당자별 — div 기반 이중 바 (옅은 트랙 + 진한 값 바)
export function HorizontalBarChart({ data, title }: { data: { label: string; value: number }[]; title: string }) {
  const { t } = useT()
  const display = data.slice(0, 10)
  const unit = t.chart.unit
  const max = Math.max(...display.map(d => d.value), 1)

  return (
    <ChartCard title={title} dotColor="bg-slate-500">
      <div className="space-y-2.5">
        {display.map(row => {
          const pct = (row.value / max) * 100
          return (
            <div key={row.label} className="group flex items-center gap-3 text-sm">
              <span className="w-20 shrink-0 text-right text-slate-600 truncate" title={row.label}>
                {row.label}
              </span>
              <div className="relative flex-1 h-6 rounded bg-slate-100 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-slate-800 rounded transition-all duration-500 ease-out group-hover:bg-blue-600"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right tabular-nums text-slate-700 font-medium">
                {row.value.toLocaleString()}
                {unit && <span className="text-slate-400 font-normal ml-0.5">{unit}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </ChartCard>
  )
}
