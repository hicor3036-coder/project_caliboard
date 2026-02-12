'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useCallback } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

// 모던 컬러 팔레트
const COLORS = ['#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#64748b']

// 커스텀 툴팁
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-slate-700">
      {label && <p className="text-slate-300 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium">
          {p.name ?? p.dataKey}: <span className="text-blue-300">{Number(p.value).toLocaleString()}건</span>
        </p>
      ))}
    </div>
  )
}

const RADIAN = Math.PI / 180

// 진행상태 분포 도넛차트 (폴리라인 라벨 + 겹침 방지)
export function StatusPieChart({ data }: { data: { label: string; value: number }[] }) {
  const top = data.slice(0, 5)
  const rest = data.slice(5).reduce((sum, d) => sum + d.value, 0)
  const chartData = (rest > 0 ? [...top, { label: '기타', value: rest }] : top).filter(d => d.value > 0)
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
          {item.name} {item.value.toLocaleString()}건
        </text>
      </g>
    )
  }, [labelLayout])

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-4">진행상태 분포</h2>
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
          <Tooltip content={<ChartTooltip />} />
          <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" fill="#94a3b8" fontSize={11}>
            전체
          </text>
          <text x="50%" y="55%" textAnchor="middle" dominantBaseline="central" fill="#1e293b" fontSize={18} fontWeight={700}>
            {total.toLocaleString()}
          </text>
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

// 월별 접수 추이 바차트
export function MonthlyBarChart({ data }: { data: { month: string; 건수: number }[] }) {
  const recent = data.slice(-12)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-4">월별 접수 추이</h2>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={recent} barCategoryGap="20%">
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
          <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="건수" fill="#3b82f6" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// 제조사별 / 담당자별 수평 바차트
export function HorizontalBarChart({ data, title }: { data: { label: string; value: number }[]; title: string }) {
  const display = data.slice(0, 10)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-4">{title}</h2>
      <ResponsiveContainer width="100%" height={Math.max(200, display.length * 36)}>
        <BarChart data={display} layout="vertical" margin={{ left: 80, right: 16 }} barCategoryGap="25%">
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 12, fill: '#475569' }}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="value" name="건수" fill="#1e3a5f" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
