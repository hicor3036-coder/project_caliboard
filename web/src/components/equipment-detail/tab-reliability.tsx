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
  RELIABILITY_TARGET,
  type ReliabilityAnalysis,
  type ReliabilityFit,
  type TierRung,
  type StaircaseStep,
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
          RP-1 defines <span className="font-semibold text-indigo-700">methods in tiers</span> of interval-setting.
          The more data you have, the higher you climb — and the more <span className="font-semibold">evidence-based</span> the interval becomes.
          Below, we apply each tier to <span className="font-semibold">this very torque wrench</span> and watch the recommendation sharpen.
        </p>
      </div>

      {/* ═══ Climb summary strip ═══ */}
      <ClimbStrip tl={tl} />

      {/* ═══ Tier-by-tier narrative ═══ */}
      {/* trend(4+α) 카드는 숨김 — 그 추세 차트는 "Beyond the summit" 중간점검으로 이동함.
          lib의 rank/achievedRank 체계는 그대로 두고 화면에서만 건너뛴다. */}
      <div className="space-y-2">
        {tl.rungs.filter((rung) => rung.tier !== 'trend').map((rung) => (
          <TierCard key={rung.tier} rung={rung} analysis={analysis} driftData={driftData} series={effectiveSeries} specMonths={specMonths} manufacturer={manufacturer} model={model} />
        ))}
      </div>

      {/* ═══ Verdict ═══ */}
      <VerdictCard analysis={analysis} />

      {/* ═══ Beyond the summit: interim check (our proposal) ═══ */}
      <InterimSection analysis={analysis} driftData={driftData} series={effectiveSeries} specMonths={specMonths} manufacturer={manufacturer} model={model} />
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
          const isSummit = r.rank === 6
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
  reactive:    { dot: '#f59e0b', ring: 'border-amber-300',  text: 'text-amber-700' },  // 정석 Reactive = 약점 강조 (앰버)
  trend:       { dot: '#3b82f6', ring: 'border-blue-300',   text: 'text-blue-700' },
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
        <div className={`flex h-7 flex-shrink-0 items-center justify-center rounded-full font-bold text-white ${rung.displayRank.length > 1 ? 'w-9 text-[9px] px-1' : 'w-7 text-[11px]'}`} style={{ background: acc.dot }}>
          {rung.displayRank}
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

      {/* embedded asset: 정석 Reactive = 합격↑/불합격↓ 계단 차트 (초보자용 직관 그림) */}
      {rung.embed === 'staircase' && reached && rung.staircase && (
        <div className="px-4 pb-3">
          <StaircaseChart steps={rung.staircase} />
        </div>
      )}

      {/* embedded asset: Trend = 기존 Cycle Analysis 탭의 Drift 섹션 그대로 */}
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
// Tier-4 embed: 정석 Reactive 계단 차트 (합격↑ / 불합격↓)
//   초보자도 한눈에: "합격하면 주기를 조금 늘리고, 불합격하면 확 줄인다."
//   → 들쭉날쭉·예측 없음이라는 약점이 그림으로 드러난다.
// ═══════════════════════════════════════════════════════════════════

function StaircaseChart({ steps }: { steps: StaircaseStep[] }) {
  // 차트 영역 — 큼직하게
  const W = 760, H = 340
  const padL = 56, padR = 116, padT = 44, padB = 64
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const maxInterval = Math.max(...steps.map(s => s.interval)) * 1.18
  const n = steps.length
  const xAt = (i: number) => padL + (plotW * i) / (n - 1)
  const yAt = (v: number) => padT + plotH * (1 - v / maxInterval)

  const linePts = steps.map((s, i) => ({ x: xAt(i), y: yAt(s.interval), s }))

  // y축 눈금 (0, 1/2, max)
  const yTicks = [0, maxInterval / 2, maxInterval]

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-white p-4">
      {/* 헤더 — 규칙을 큼직하게, 보면 바로 알게 */}
      <div className="mb-3 rounded-lg bg-amber-500 px-4 py-3 text-white shadow-sm">
        <div className="text-sm font-bold uppercase tracking-wide">The rule: just react to the last result</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 rounded-md bg-white/15 px-3 py-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-sm font-bold">✓</span>
            <span className="text-[13px] font-semibold">Pass → interval <span className="text-base font-extrabold">+10%</span></span>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-white/15 px-3 py-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm font-bold">✗</span>
            <span className="text-[13px] font-semibold">Fail → interval <span className="text-base font-extrabold">−45%</span></span>
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-amber-100">
          a = 0.10, b ≈ 0.45 — from RP-1 §B.2 formula b = 1−(1−a)<sup>Rt/(1−Rt)</sup> at 85% reliability
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* y축 눈금선 */}
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line x1={padL} y1={yAt(t)} x2={W - padR} y2={yAt(t)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" className="fill-slate-400" style={{ fontSize: 12 }}>
              {t.toFixed(0)}
            </text>
          </g>
        ))}
        <text x={padL - 8} y={padT - 16} textAnchor="end" className="fill-slate-500" style={{ fontSize: 12, fontWeight: 600 }}>months</text>

        {/* 축 */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#cbd5e1" strokeWidth={1.5} />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" strokeWidth={1.5} />

        {/* 계단 선 — 각 점의 "결과"가 다음 점으로의 변화를 만든다.
            pass(초록)면 다음 주기 +10% 상승, fail(빨강)이면 −45% 하강.
            선·라벨 색은 "원인이 된 결과"(이번 점) 기준 → 점 색과 일치해 헷갈리지 않음. */}
        {linePts.map((cur, i) => {
          const next = linePts[i + 1]
          if (!next) return null                              // 마지막 점은 다음 구간 없음
          const col = cur.s.pass ? '#16a34a' : '#dc2626'      // 이번 결과 기준 색
          // 수평(cur→next.x, cur.y) 후 수직(next.x, cur.y→next.y)
          // 변화율 라벨 = 수평 구간 중앙(점에서 멀리). 합격=수평선 위, 불합격=수평선 아래.
          const labelX = (cur.x + next.x) / 2
          const labelY = cur.s.pass ? cur.y - 10 : cur.y + 18
          return (
            <g key={`step-${i}`}>
              <polyline
                points={`${cur.x},${cur.y} ${next.x},${cur.y} ${next.x},${next.y}`}
                fill="none"
                stroke={col}
                strokeWidth={3.5}
                strokeLinejoin="round"
                opacity={0.9}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                style={{ fontSize: 11.5, fontWeight: 800 }}
                fill={col}
              >
                {cur.s.pass ? '+10%' : '−45%'}
              </text>
            </g>
          )
        })}

        {/* 각 회차 점 + 큰 합격/불합격 마커 + 주기값 + 결과 배지 */}
        {linePts.map((p, i) => (
          <g key={`pt-${i}`}>
            {/* 점 강조 링 */}
            <circle cx={p.x} cy={p.y} r={9} fill={p.s.pass ? '#16a34a' : '#dc2626'} opacity={0.18} />
            <circle cx={p.x} cy={p.y} r={6} fill={p.s.pass ? '#16a34a' : '#dc2626'} stroke="white" strokeWidth={2} />
            {/* 주기 값 (mo) — 수직선은 항상 점 오른쪽에서 일어나므로, 라벨은 모두 점 왼쪽위로
                통일 + 짧은 리더선으로 연결. 어느 점이든 수직선과 안 겹침. */}
            {(() => {
              const lx = p.x - 16, ly = p.y - 14
              return (
                <g>
                  <line x1={p.x - 7} y1={p.y - 6} x2={lx + 3} y2={ly + 2} stroke="#cbd5e1" strokeWidth={1} />
                  <text x={lx} y={ly} textAnchor="end" style={{ fontSize: 12, fontWeight: 700 }} fill="#475569">
                    {p.s.interval}
                  </text>
                </g>
              )
            })()}
            {/* x축 아래: 회차 + PASS/FAIL 색 배지 (텍스트만이 아니라 색칩으로) */}
            <rect
              x={p.x - 17} y={padT + plotH + 10} width={34} height={16} rx={8}
              fill={p.s.pass ? '#dcfce7' : '#fee2e2'}
            />
            <text
              x={p.x} y={padT + plotH + 21} textAnchor="middle"
              style={{ fontSize: 9, fontWeight: 700 }}
              fill={p.s.pass ? '#15803d' : '#b91c1c'}
            >
              {p.s.pass ? 'PASS' : 'FAIL'}
            </text>
            <text x={p.x} y={padT + plotH + 38} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 11 }}>
              #{p.s.index}
            </text>
          </g>
        ))}

        {/* 마지막 점 뒤 — "결론 없음(?)" 시각 표시: 점선 + 물음표 */}
        {(() => {
          const last = linePts[linePts.length - 1]
          const qx = last.x + 54
          return (
            <g>
              <line x1={last.x + 10} y1={last.y} x2={qx - 16} y2={last.y} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" />
              <circle cx={qx} cy={last.y} r={15} fill="#fef3c7" stroke="#f59e0b" strokeWidth={1.8} />
              <text x={qx} y={last.y + 6} textAnchor="middle" style={{ fontSize: 18, fontWeight: 800 }} fill="#d97706">?</text>
              {/* 라벨은 ? 아래로 (마지막 점 주기값과 겹침 방지) — 2줄 */}
              <text x={qx} y={last.y + 30} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700 }} fill="#b45309">no fixed</text>
              <text x={qx} y={last.y + 42} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700 }} fill="#b45309">answer</text>
            </g>
          )
        })()}
      </svg>

      {/* 범례 + 약점 강조 한 줄 */}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-4 text-[12px]">
          <span className="flex items-center gap-1.5 font-medium text-green-700"><span className="inline-block w-3 h-3 rounded-full bg-green-600" /> pass → up</span>
          <span className="flex items-center gap-1.5 font-medium text-red-700"><span className="inline-block w-3 h-3 rounded-full bg-red-600" /> fail → down</span>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-[12px] font-bold text-amber-700">⚠ jumps around — no forecast</span>
      </div>
    </div>
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 300 }}>
      {/* 피팅식 우상단 — Tier-4 회귀식과 페어링 (단, MLE 지수모델 형태) */}
      <text x={W - padR} y={13} textAnchor="end" fontSize={12.5} fontFamily="monospace" fill="#4f46e5">
        R(t) = e^(−λt)
        <tspan fill="#94a3b8"> · </tspan>
        <tspan fill="#b45309" fontWeight={700}>λ = {fit.lambdaPerMonth.toFixed(3)}/mo</tspan>
        <tspan fill="#94a3b8"> · n = {fit.observationCount}</tspan>
      </text>

      {yTicks.map((r) => (
        <g key={r}>
          <line x1={padL} y1={yOf(r)} x2={W - padR} y2={yOf(r)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={padL - 5} y={yOf(r) + 4} textAnchor="end" fontSize={11} fill="#94a3b8">{(r * 100).toFixed(0)}%</text>
        </g>
      ))}
      {xTicks.map((m) => (
        <text key={m} x={xOf(m)} y={H - padB + 15} textAnchor="middle" fontSize={11} fill="#94a3b8">{m}mo</text>
      ))}
      <text x={(padL + W - padR) / 2} y={H - 1} textAnchor="middle" fontSize={10.5} fill="#cbd5e1">months after calibration</text>

      {/* target */}
      <line x1={padL} y1={targetY} x2={W - padR} y2={targetY} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" />
      <text x={W - padR} y={targetY - 5} textAnchor="end" fontSize={11.5} fontWeight={700} fill="#d97706" fontFamily="sans-serif">
        {(RELIABILITY_TARGET * 100).toFixed(0)}% target
        <tspan fontWeight={500} fontSize={9.3} fill="#b45309"> (DAFMAN 21-113 §2.6.14.2)</tspan>
      </text>

      {/* spec due */}
      <line x1={specX} y1={padT} x2={specX} y2={H - padB} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2 2" />
      <text x={specX} y={padT + 10} textAnchor="middle" fontSize={10} fill="#94a3b8">spec {specMonths}mo</text>

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
              x={labelRight ? labelX + 1 : labelX - 135}
              y={elbowY - 9}
              width={134}
              height={18}
              fill="#fff"
              fillOpacity={0.85}
            />
            <text
              x={labelX + (labelRight ? 3 : -3)}
              y={elbowY + 4.5}
              textAnchor={labelRight ? 'start' : 'end'}
              fontSize={13}
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
  analysis, driftData, series, specMonths, manufacturer, model,
}: {
  analysis: ReliabilityAnalysis
  driftData: TrendDriftData
  series: TrendSeries[]
  specMonths: number
  manufacturer: string
  model: string
}) {
  const extendedMonths = analysis.tierLadder.mleMonths ?? specMonths
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2 mt-2">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800">Beyond the summit — an interim-check kiosk keeps the long interval trustworthy</h3>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase tracking-wide">Future Work</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">Interim checks watch the gap between calibrations and confirm the result stays valid.</p>
          </div>
        </div>
      </div>

      {/* 4+α에서 옮겨온 차트 — 교정 히스토리 + 중간점검 점 + 추세 해석. 내용 변경 없음. */}
      <TrendDriftDetails
        data={driftData}
        series={series}
        baseMonths={specMonths}
        finalMonths={extendedMonths}
        manufacturer={manufacturer}
        model={model}
        showInterimToggle
        intervalMode="mle"
      />
    </section>
  )
}
