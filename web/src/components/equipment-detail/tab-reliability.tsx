// Measurement Reliability Tab (RP-1 / AFMETCAL — ICMPM2026 presentation)
//
// 기존 "Cycle Analysis" 탭과 완전 독립된 신규 탭. 기존 탭/로직 무영향.
//   lib: reliability-model.ts (RP-1 5티어 + fleet 신뢰성 R(t)=e^(−λt) MLE)
//
// ★ 구조 = "RP-1 사다리를 한 칸씩 올라가는 여정" (사용자 확정 2026-06-16):
//   RP-1을 척추로, 우리 자산을 중간에 끼워넣는다.
//
//   Tier 1·2  General/Borrowed : "제조사가 12개월" — 근거 약함, 보수적
//   Tier 3    Engineering      : 설계 기반 보정
//   Tier 4    Reactive (A3)    : ★이 장비 드리프트 차트 (잘 만든 자산 재사용)
//   Tier 5    MLE (S2)         : ★모집단 신뢰성 곡선 + 개체 보정 = 정점
//   ────────── 결론: 데이터로 주기가 합리화된다 ──────────
//   정점 너머  우리의 제안     : ★중간점검 키오스크 (닫힌 루프)
//
// NOTE: ICMPM keynote 대상이라 영어 UI. 국제표준(ISO/NCSL) 전면, AFMETCAL은 "참조".

'use client'

import { useMemo, useState } from 'react'
import {
  runReliabilityAnalysis,
  simulateInterimReliability,
  RELIABILITY_TARGET,
  type ReliabilityAnalysis,
  type ReliabilityInterimComparison,
  type ReliabilityFit,
  type TierRung,
} from '@/lib/reliability-model'
import { buildDemoTorqueSeries } from '@/lib/cycle-analysis-dummy'
import { step2_trendDrift, type TrendDriftData } from '@/lib/cycle-analysis'
// Reactive(tier-4) 칸 = 기존 Cycle Analysis 탭의 Drift 섹션을 그대로 재사용 (import).
import { TrendDriftDetails } from './tab-cycle-analysis'
import type { TrendSeries } from '@/lib/equipment-health'

const DEMO_MODEL = process.env.NEXT_PUBLIC_CYCLE_DEMO_MODEL?.trim() || null

interface Props {
  manufacturer: string
  model: string
  ktoolsAffcCyclCd: string
  series: TrendSeries[]
  calDates: string[]
}

function parseSpecMonths(affcCyclCd: string | null | undefined): number {
  const n = parseFloat((affcCyclCd ?? '').trim())
  return Number.isFinite(n) && n > 0 && n <= 120 ? Math.round(n) : 12
}

export default function TabReliability({ manufacturer, model, ktoolsAffcCyclCd, series }: Props) {
  const [interimOn, setInterimOn] = useState(false)

  const isDemoTarget = DEMO_MODEL != null && model === DEMO_MODEL
  const effectiveSeries = useMemo<TrendSeries[]>(
    () => (isDemoTarget ? buildDemoTorqueSeries() : series),
    [isDemoTarget, series],
  )
  const specMonths = useMemo(
    // 데모: KOLAS 토크렌치 권장 교정주기 = 6개월 (Tier 1~3 기준선)
    () => (isDemoTarget ? 6 : parseSpecMonths(ktoolsAffcCyclCd)),
    [isDemoTarget, ktoolsAffcCyclCd],
  )

  const analysis = useMemo<ReliabilityAnalysis>(
    () => runReliabilityAnalysis({
      series: effectiveSeries, specMonths, manufacturer, model,
      category: isDemoTarget ? 'Torque Wrench' : null,
    }),
    [effectiveSeries, specMonths, manufacturer, model, isDemoTarget],
  )

  const interimSim = useMemo<ReliabilityInterimComparison | null>(() => {
    if (!interimOn) return null
    return simulateInterimReliability(analysis.fleet, specMonths, { manufacturer, model })
  }, [interimOn, analysis.fleet, specMonths, manufacturer, model])

  // Reactive(tier-4) 칸에서 기존 Drift 섹션을 그리려면 step2 결과가 필요.
  const calDates = useMemo<string[]>(() => {
    const set = new Set<string>()
    for (const s of effectiveSeries) for (const p of s.points) if (p.교정일 && p.판정 !== 'interim') set.add(p.교정일)
    return [...set].sort()
  }, [effectiveSeries])
  const driftData = useMemo<TrendDriftData>(
    () => step2_trendDrift(effectiveSeries, calDates).data,
    [effectiveSeries, calDates],
  )

  const tl = analysis.tierLadder

  return (
    <div className="space-y-3 max-w-4xl">
      {/* ═══ Header ═══ */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wide">NCSLI RP-1</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase tracking-wide">ISO/IEC 17025 §6.4.7</span>
          <h2 className="text-sm font-bold text-slate-800 ml-1">How to set a calibration interval — the RP-1 ladder</h2>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          RP-1 defines <span className="font-semibold text-indigo-700">five tiers</span> of interval-setting methods.
          The more data you have, the higher you climb — and the more <span className="font-semibold">evidence-based</span> the interval becomes.
          Below, we apply each tier to <span className="font-semibold">this very torque wrench</span> and watch the recommendation sharpen.
        </p>
      </div>

      {/* ═══ Climb summary strip ═══ */}
      <ClimbStrip tl={tl} />

      {/* ═══ Tier-by-tier narrative ═══ */}
      <div className="space-y-2">
        {tl.rungs.map((rung) => (
          <TierCard key={rung.tier} rung={rung} analysis={analysis} driftData={driftData} series={effectiveSeries} specMonths={specMonths} manufacturer={manufacturer} model={model} />
        ))}
      </div>

      {/* ═══ Verdict ═══ */}
      <VerdictCard analysis={analysis} />

      {/* ═══ Beyond the summit: interim check (our proposal) ═══ */}
      <InterimSection analysis={analysis} interim={interimSim} on={interimOn} setOn={setInterimOn} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Climb summary — 한 줄로 "사다리 오르며 주기가 이렇게 변한다"
// ═══════════════════════════════════════════════════════════════════

function ClimbStrip({ tl }: { tl: ReliabilityAnalysis['tierLadder'] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {tl.rungs.map((r, i) => {
          const reached = r.rank <= tl.achievedRank
          const isSummit = r.rank === 5
          return (
            <div key={r.tier} className="flex items-center gap-1.5 flex-shrink-0">
              <div className={`flex flex-col items-center px-2 py-1 rounded-lg border ${
                isSummit && reached ? 'border-indigo-300 bg-indigo-50' : reached ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-200 bg-white opacity-50'
              }`}>
                <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{r.name.split(' ')[0]}</span>
                <span className={`text-sm font-bold ${isSummit && reached ? 'text-indigo-700' : 'text-slate-600'}`}>
                  {r.intervalMonths != null ? `${r.intervalMonths}` : '—'}<span className="text-[9px] font-normal">mo</span>
                </span>
              </div>
              {i < tl.rungs.length - 1 && <span className="text-slate-300 text-xs">›</span>}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        Tier 1–2 are guesses; tier 4–5 are evidence. The interval doesn&apos;t just appear — it is <span className="font-medium text-slate-600">earned with data</span>.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Tier card — 각 티어를 펼친 카드 (embed 있으면 차트 포함)
// ═══════════════════════════════════════════════════════════════════

const TIER_ACCENT: Record<string, { dot: string; ring: string; text: string }> = {
  general:     { dot: '#cbd5e1', ring: 'border-slate-200',  text: 'text-slate-600' },
  borrowed:    { dot: '#94a3b8', ring: 'border-slate-200',  text: 'text-slate-600' },
  engineering: { dot: '#60a5fa', ring: 'border-blue-200',   text: 'text-blue-700' },
  reactive:    { dot: '#3b82f6', ring: 'border-blue-300',   text: 'text-blue-700' },
  mle:         { dot: '#4f46e5', ring: 'border-indigo-300', text: 'text-indigo-700' },
}

function TierCard({
  rung, analysis, driftData, series, specMonths, manufacturer, model,
}: {
  rung: TierRung
  analysis: ReliabilityAnalysis
  driftData: TrendDriftData
  series: TrendSeries[]
  specMonths: number
  manufacturer: string
  model: string
}) {
  const acc = TIER_ACCENT[rung.tier]
  const reached = rung.rank <= analysis.tierLadder.achievedRank
  const isSummit = rung.tier === 'mle'

  return (
    <section className={`rounded-xl border bg-white overflow-hidden ${reached ? acc.ring : 'border-slate-200'} ${isSummit && reached ? 'ring-1 ring-indigo-200' : ''}`}>
      {/* header row */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: acc.dot }}>
          {rung.rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold ${reached ? acc.text : 'text-slate-500'}`}>{rung.name}</span>
            {isSummit && <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-indigo-600 text-white uppercase tracking-wide">Summit</span>}
            {rung.rank === analysis.tierLadder.achievedRank && (
              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase tracking-wide">This unit reaches here</span>
            )}
          </div>
          <div className="text-[10px] text-slate-400">uses: {rung.dataUsed}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`text-lg font-bold ${reached ? acc.text : 'text-slate-300'}`}>
            {rung.intervalMonths != null ? `${rung.intervalMonths}` : '—'}<span className="text-[10px] font-normal text-slate-400 ml-0.5">months</span>
          </div>
        </div>
      </div>
      {/* basis line */}
      <div className="px-4 pb-2 -mt-1">
        <p className="text-[10px] text-slate-500 leading-relaxed pl-10">{rung.basis}</p>
      </div>

      {/* embedded asset: Reactive = 기존 Cycle Analysis 탭의 Drift 섹션 그대로 */}
      {rung.embed === 'drift-chart' && reached && (
        <div className="px-4 pb-3">
          <TrendDriftDetails
            data={driftData}
            series={series}
            baseMonths={specMonths}
            finalMonths={rung.intervalMonths ?? specMonths}
            manufacturer={manufacturer}
            model={model}
            showInterimToggle
          />
        </div>
      )}
      {rung.embed === 'reliability-curve' && reached && (
        <div className="px-4 pb-3">
          <MleSection analysis={analysis} />
        </div>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Tier-5 embed: MLE reliability curve + fleet/unit two intervals
// ═══════════════════════════════════════════════════════════════════

function MleSection({ analysis }: { analysis: ReliabilityAnalysis }) {
  const pr = analysis.pointReliability
  const driving = pr.drivingLabel
  const [selected, setSelected] = useState<string>(driving ?? pr.points[0]?.label ?? '')

  if (!pr.available || pr.points.length === 0) {
    return <div className="text-[10px] text-slate-400 py-2">Insufficient fleet data to fit a reliability model.</div>
  }
  const sel = pr.points.find(p => p.label === selected) ?? pr.points[0]

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-3">
      {/* ★ MLE 방법 — 한 줄 요약 */}
      <div className="mb-2 rounded-md bg-indigo-600 px-3 py-2 text-white">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide">MLE · exponential reliability model</span>
          <span className="text-[10px] font-mono text-indigo-100">R(t) = e<sup>−λt</sup></span>
        </div>
        <p className="mt-0.5 text-[9.5px] text-indigo-100">
          Fit the curve to fleet data, find where it crosses the {(RELIABILITY_TARGET * 100).toFixed(0)}% target.
          <span className="text-indigo-300"> RP-1 Method S2 · target per DAFMAN 21-113 §2.6.14.2.</span>
        </p>
      </div>

      {/* 동질그룹 한 줄 — "이 주기는 무엇에 적용되나" */}
      <div className="mb-2 rounded-md bg-white border border-indigo-200 px-2.5 py-1.5 text-[10px] text-slate-600">
        Population = same model · <span className="font-semibold text-indigo-700">{analysis.subgroup.label}</span> subgroup
        ({pr.groupSize} units). Applies to every serial in this group, not one unit.
      </div>

      {/* 측정포인트 선택 탭 — 각 포인트의 그룹 주기 */}
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {pr.points.map(p => {
          const isSel = p.label === selected
          const isDriver = p.label === driving
          return (
            <button
              key={p.label}
              onClick={() => setSelected(p.label)}
              className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                isSel ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
              }`}
            >
              {p.label}
              <span className={`ml-1 ${isSel ? 'text-indigo-100' : 'text-slate-400'}`}>{p.fit.optimalMonths != null ? `${p.fit.optimalMonths}mo` : '—'}</span>
              {isDriver && <span className={`ml-1 ${isSel ? 'text-amber-200' : 'text-amber-600'}`}>●</span>}
            </button>
          )
        })}
      </div>

      <ReliabilityChart fit={sel.fit} specMonths={analysis.specMonths} />

      {/* 결정 요약 — 그룹 주기 (worst point) */}
      <div className="mt-2 flex items-center justify-between rounded-lg border border-indigo-300 bg-white px-3 py-2">
        <div>
          <div className="text-[9px] uppercase tracking-wide text-slate-400">Group interval · {(RELIABILITY_TARGET * 100).toFixed(0)}% reliability</div>
          <div className="text-[9px] text-slate-400">driven by worst point ({driving ?? '—'})</div>
        </div>
        <div className="text-2xl font-bold text-indigo-700">
          {pr.recommendedMonths ?? '—'}<span className="text-[11px] font-normal text-slate-400 ml-1">months</span>
        </div>
      </div>
    </div>
  )
}

// 날짜 → 연도분수 (2024-06 → 2024.42). 실패 시 null.
// SVG reliability curve. X=교정 후 경과개월, Y=reliability 0..100%.
//   순수 모집단(동질그룹) 곡선 — 곡선 + 85% target + spec + 주기 마커.
function ReliabilityChart({ fit, specMonths }: { fit: ReliabilityFit; specMonths: number }) {
  const W = 600, H = 220
  const padL = 38, padR = 14, padT = 24, padB = 28
  const plotW = W - padL - padR, plotH = H - padT - padB

  const horizon = fit.curve.length > 0 ? fit.curve[fit.curve.length - 1].months : 30
  const xOf = (m: number) => padL + (m / horizon) * plotW
  const yOf = (r: number) => padT + (1 - r) * plotH

  const curvePath = fit.curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.months).toFixed(1)},${yOf(p.reliability).toFixed(1)}`).join(' ')
  const targetY = yOf(RELIABILITY_TARGET)
  const optX = fit.optimalMonths != null ? xOf(fit.optimalMonths) : null
  const specX = xOf(specMonths)

  const yTicks = [1, 0.85, 0.7, 0.5, 0.25, 0]
  const xTicks: number[] = []
  for (let m = 0; m <= horizon; m += 6) xTicks.push(m)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
      {/* 피팅식 우상단 — Tier-4 회귀식과 페어링 (단, MLE 지수모델 형태) */}
      <text x={W - padR} y={11} textAnchor="end" fontSize={9.5} fontFamily="monospace" fill="#4f46e5">
        R(t) = e^(−λt)
        <tspan fill="#94a3b8"> · </tspan>
        <tspan fill="#b45309" fontWeight={700}>λ = {fit.lambdaPerMonth.toFixed(3)}/mo</tspan>
        <tspan fill="#94a3b8"> · n = {fit.observationCount}</tspan>
      </text>

      {yTicks.map((r) => (
        <g key={r}>
          <line x1={padL} y1={yOf(r)} x2={W - padR} y2={yOf(r)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={padL - 5} y={yOf(r) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{(r * 100).toFixed(0)}%</text>
        </g>
      ))}
      {xTicks.map((m) => (
        <text key={m} x={xOf(m)} y={H - padB + 13} textAnchor="middle" fontSize={8} fill="#94a3b8">{m}mo</text>
      ))}
      <text x={(padL + W - padR) / 2} y={H - 2} textAnchor="middle" fontSize={8} fill="#cbd5e1">months after calibration</text>

      {/* target */}
      <line x1={padL} y1={targetY} x2={W - padR} y2={targetY} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" />
      <text x={W - padR} y={targetY - 3} textAnchor="end" fontSize={8} fontWeight={700} fill="#d97706">{(RELIABILITY_TARGET * 100).toFixed(0)}% target <tspan fontWeight={400} fill="#b45309">(DAFMAN 21-113 §2.6.14.2)</tspan></text>

      {/* spec due */}
      <line x1={specX} y1={padT} x2={specX} y2={H - padB} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2 2" />
      <text x={specX} y={padT + 8} textAnchor="middle" fontSize={7.5} fill="#94a3b8">spec {specMonths}mo</text>

      {/* fleet curve */}
      <path d={curvePath} fill="none" stroke="#4f46e5" strokeWidth={2.2} />

      {/* fleet empirical dots (관측 합격률) */}
      {fit.empirical.map((e, i) => (
        <circle key={i} cx={xOf(e.months)} cy={yOf(e.reliability)} r={Math.min(5, 2 + Math.sqrt(e.n) * 0.4)} fill="#6366f1" fillOpacity={0.28} stroke="#4f46e5" strokeWidth={0.7} />
      ))}

      {/* interval marker — 85% 교차점에 ●, 아래쪽 빈 공간으로 ㄴ자 꺾은선 leader */}
      {optX != null && fit.optimalMonths != null && (() => {
        const labelRight = optX < W * 0.55
        const elbowY = H - padB - 8            // 라벨 레인 (차트 하단 빈 공간)
        const labelX = optX + (labelRight ? 12 : -12)
        return (
          <g>
            {/* ㄴ자 꺾은선: 점(85% 교차) → 아래로 → 옆으로 */}
            <path
              d={`M${optX},${targetY} L${optX},${elbowY} L${labelX},${elbowY}`}
              fill="none" stroke="#d97706" strokeWidth={1.2}
            />
            <circle cx={optX} cy={targetY} r={4} fill="#d97706" stroke="#fff" strokeWidth={1.4} />
            {/* 라벨 흰 배경 (눈금 숫자와 겹쳐도 가독) */}
            <rect
              x={labelRight ? labelX + 1 : labelX - 111}
              y={elbowY - 7}
              width={110}
              height={14}
              fill="#fff"
              fillOpacity={0.85}
            />
            <text
              x={labelX + (labelRight ? 3 : -3)}
              y={elbowY + 3.5}
              textAnchor={labelRight ? 'start' : 'end'}
              fontSize={10.5}
              fontWeight={700}
              fill="#b45309"
            >
              {fit.optimalMonths} months → {(RELIABILITY_TARGET * 100).toFixed(0)}%
            </text>
          </g>
        )
      })()}
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Verdict — "데이터로 주기가 합리화된다"
// ═══════════════════════════════════════════════════════════════════

function VerdictCard({ analysis }: { analysis: ReliabilityAnalysis }) {
  const tl = analysis.tierLadder
  if (tl.mleMonths == null) return null

  const verdictText = {
    extend: `Data shows this model stays reliable longer than the ${tl.specMonths}-month spec — the interval can be safely extended to ${tl.mleMonths} months, cutting over-calibration cost.`,
    confirm: `Data confirms the ${tl.specMonths}-month spec is well-chosen — reliability hits ${(RELIABILITY_TARGET * 100).toFixed(0)}% right around ${tl.mleMonths} months. Now it is evidence, not a guess.`,
    shorten: `Data shows reliability drops below ${(RELIABILITY_TARGET * 100).toFixed(0)}% by ${tl.mleMonths} months — earlier than the ${tl.specMonths}-month spec. A tighter interval is justified.`,
  }[tl.verdict ?? 'confirm']

  const tone = tl.verdict === 'extend' ? 'emerald' : tl.verdict === 'shorten' ? 'amber' : 'indigo'
  const toneCls = {
    emerald: 'from-emerald-600 to-emerald-700',
    amber: 'from-amber-600 to-amber-700',
    indigo: 'from-indigo-600 to-indigo-700',
  }[tone]

  return (
    <section className={`rounded-xl bg-gradient-to-br ${toneCls} text-white px-5 py-4 shadow-sm`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/70 mb-1">The climb pays off</div>
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-sm text-white/80">{tl.specMonths} months (guess)</span>
        <span className="text-white/50">→</span>
        <span className="text-3xl font-bold leading-none">{tl.mleMonths} months</span>
        <span className="text-sm text-white/80">evidence-based</span>
      </div>
      <p className="text-[11px] text-white/90 leading-relaxed">{verdictText}</p>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Beyond the summit — interim check (our proposal)
// ═══════════════════════════════════════════════════════════════════

function InterimSection({
  analysis, interim, on, setOn,
}: {
  analysis: ReliabilityAnalysis
  interim: ReliabilityInterimComparison | null
  on: boolean
  setOn: (v: boolean) => void
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2 mt-2">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800">Beyond the summit — our proposal: an interim-check kiosk as a safeguard</h3>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase tracking-wide">Future Work</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">Extending the interval is safe — and a kiosk watches the longer gap, just in case</p>
          </div>
        </div>
        <button
          onClick={() => setOn(!on)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${on ? 'bg-purple-600' : 'bg-slate-300'}`}
          aria-label="Toggle interim simulation"
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {on && interim?.available ? (
        <div className="bg-gradient-to-br from-purple-50/60 via-white to-white border-2 border-purple-200 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {/* 안전장치 프레이밍: 곡선 정밀도(데이터원)가 아니라 감시·조기경보·공백리스크 */}
            <SimMetric label="Gap left unwatched" before={`${analysis.specMonths}→${analysis.tierLadder.mleMonths ?? '—'}mo`} after="0" note="checked every few weeks" good />
            <SimMetric label="Drift caught" before="at next cal." after="within weeks" note="early warning" good />
            <SimMetric label="Data for next prediction" before="formal only" after={`+${interim.observationGain.toLocaleString()}`} note="feeds the model" />
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            A low-cost kiosk checks the wrench <span className="font-semibold text-purple-700">every few weeks</span> across the longer
            {' '}{analysis.specMonths}→{analysis.tierLadder.mleMonths ?? '—'}-month interval. It is not a precise calibration — its job is
            {' '}<span className="font-semibold text-purple-700">early warning</span>, so a longer interval can be run with confidence.
            As a bonus, the checks <span className="font-semibold text-purple-700">feed back into the reliability model</span>, sharpening future predictions.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">ISO/IEC 17025 §6.4.10 (intermediate checks)</span>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">NCSLI RP-1 (SPC)</span>
          </div>
        </div>
      ) : (
        <div className="bg-purple-50/40 border border-dashed border-purple-200 rounded-xl p-5">
          <p className="text-xs text-slate-500 leading-relaxed">
            <span className="text-purple-500 mr-1">🛡️</span>
            Extending the interval ({analysis.specMonths}→{analysis.tierLadder.mleMonths ?? '—'} months) is safe by the data — but a longer gap can feel risky.
            A low-cost <span className="font-semibold text-purple-700">interim-check kiosk</span> watches the instrument between calibrations: low precision, but enough to
            <em> raise an early warning</em> if anything drifts. So the interval is extended <em>safely</em> — and the checks also feed future predictions.
          </p>
          <p className="mt-2 text-[10px] text-slate-400">Basis: ISO/IEC 17025 §6.4.10 (intermediate checks) · NCSLI RP-1 (SPC)</p>
        </div>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Shared small components
// ═══════════════════════════════════════════════════════════════════

function SimMetric({ label, before, after, note, good }: { label: string; before: string; after: string; note: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-purple-200 bg-white px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-[11px] text-slate-400 line-through">{before}</span>
        <span className="text-slate-300">→</span>
        <span className={`text-sm font-bold ${good ? 'text-emerald-600' : 'text-purple-700'}`}>{after}</span>
      </div>
      <div className="text-[9px] text-slate-400">{note}</div>
    </div>
  )
}
