// Calibration Cycle Analysis Tab (Phase G+ / ICMPM2026 presentation)
//
// NOTE: This tab is intentionally rendered in ENGLISH for the ICMPM2026 keynote.
// The rest of the app stays Korean. Strings here are hardcoded (not via i18n dict)
// to keep this presentation-only tab self-contained.
//
// Structure:
//   - Recommended Cycle (decision)
//   - Analysis Evidence
//       1. Baseline Cycle        (existing — built)
//       2. Measurement Drift     (existing — built)
//       3. Uncertainty Risk      (existing — built)
//       4. Peer Benchmark        (NEW — similar-instrument big data, integrated)
//       5. Final Decision        (existing — built)
//   - Interim Check Simulation   (NEW — kiosk, Future Work, toggle ON/OFF)

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  runCycleAnalysis,
  runInterimSimulation,
  buildPrescription,
  type CycleAnalysisResult,
  type ProfileLike,
  type BaselineData,
  type TrendDriftData,
  type UncertaintyRiskData,
  type PointUncertaintyAnalysis,
  type PeerBenchmarkStepData,
  type InterimSimComparison,
  type Prescription,
} from '@/lib/cycle-analysis'
import { buildPeerBenchmark, buildPeerErrorBands, buildErrorForecast, buildInterimAugmentedSeries, buildInterimForecastOverlay, buildDemoTorqueSeries, buildDemoCalDates, buildDemoProfile, type PeerErrorBandData, type ErrorForecast, type InterimForecastOverlay } from '@/lib/cycle-analysis-dummy'
import type { TrendSeries } from '@/lib/equipment-health'

// ⚠️ 발표 전용 데모 스위치 (k-tools PDF→Excel 변환 다운 시 임시).
//   .env.local 의 NEXT_PUBLIC_CYCLE_DEMO_MODEL 과 일치하는 모델 1개에만
//   성적서 파싱 결과(series)를 mock으로 대체한다. 복구 시 그 줄만 삭제하면 실데이터 복귀.
const DEMO_MODEL = process.env.NEXT_PUBLIC_CYCLE_DEMO_MODEL?.trim() || null

interface Props {
  manufacturer: string         // info.prdnCmpnNm
  model: string                // info.stszNm
  ktoolsAffcCyclCd: string     // info.affcCyclCd
  series: TrendSeries[]        // conformityTrend.series (if any)
  calDates: string[]           // conformityTrend.calDates (if any)
}

export default function TabCycleAnalysis({
  manufacturer,
  model,
  ktoolsAffcCyclCd,
  series,
  calDates,
}: Props) {
  // ── fetch profile (only when this tab is mounted) ──
  const [profile, setProfile] = useState<ProfileLike | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Interim Check (kiosk) simulation toggle — OFF by default
  const [interimOn, setInterimOn] = useState(false)

  useEffect(() => {
    if (!manufacturer || !model) {
      setProfileLoading(false)
      return
    }
    let cancelled = false
    setProfileLoading(true)
    setProfileError(null)
    fetch(`/api/supabase/profiles?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}`)
      .then(async r => {
        if (cancelled) return
        if (r.status === 404) {
          setProfile(null)
          return
        }
        if (!r.ok) {
          setProfileError(`Failed to load profile: ${r.status}`)
          return
        }
        const data = await r.json()
        setProfile(data as ProfileLike)
      })
      .catch(err => {
        if (!cancelled) setProfileError(err instanceof Error ? err.message : 'Failed to load profile')
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })
    return () => { cancelled = true }
  }, [manufacturer, model])

  // ── DEMO override: 특정 모델 1개만 mock으로 대체 (발표용) ──
  const isDemoTarget = DEMO_MODEL != null && model === DEMO_MODEL
  const effectiveSeries = useMemo<TrendSeries[]>(
    () => (isDemoTarget ? buildDemoTorqueSeries() : series),
    [isDemoTarget, series],
  )
  const effectiveCalDates = useMemo<string[]>(
    () => (isDemoTarget ? buildDemoCalDates() : calDates),
    [isDemoTarget, calDates],
  )
  // 데모 타깃이면 profile도 mock으로 (base 12개월 + ISO 6789 표준 표시). 실제는 404라서.
  const effectiveProfile = useMemo<ProfileLike | null>(
    () => (isDemoTarget ? buildDemoProfile() : profile),
    [isDemoTarget, profile],
  )

  // ── Peer Benchmark (similar-instrument big data) — reference only ──
  const peer = useMemo(
    () => buildPeerBenchmark(effectiveSeries, {
      manufacturer,
      model,
      category: effectiveProfile?.category ?? null,
      demoSlightlyFast: isDemoTarget,
    }),
    [effectiveSeries, manufacturer, model, effectiveProfile?.category, isDemoTarget],
  )

  // ── Peer error bands (per-point fleet error range vs this unit) — chart data ──
  const peerBands = useMemo<PeerErrorBandData>(
    () => buildPeerErrorBands(effectiveSeries, {
      manufacturer,
      model,
      category: effectiveProfile?.category ?? null,
    }),
    [effectiveSeries, manufacturer, model, effectiveProfile?.category],
  )

  // ── run analysis (Peer integrated as step 4) ──
  const analysis = useMemo<CycleAnalysisResult>(() => {
    return runCycleAnalysis({
      profile: effectiveProfile,
      ktoolsAffcCyclCd,
      series: effectiveSeries,
      calDates: effectiveCalDates,
      peer,
    })
  }, [effectiveProfile, ktoolsAffcCyclCd, effectiveSeries, effectiveCalDates, peer])

  // ── interim simulation (only computed when toggled on) ──
  const interimSim = useMemo<InterimSimComparison | null>(() => {
    if (!interimOn) return null
    return runInterimSimulation({ profile: effectiveProfile, ktoolsAffcCyclCd, series: effectiveSeries, calDates: effectiveCalDates, peer }, analysis)
  }, [interimOn, effectiveProfile, ktoolsAffcCyclCd, effectiveSeries, effectiveCalDates, peer, analysis])

  // Prescription (the conclusion: when / why / where)
  const prescription = useMemo<Prescription>(
    () => buildPrescription(analysis, effectiveSeries),
    [analysis, effectiveSeries],
  )

  // Evidence section: collapsed by default (presentation shows the prescription)
  const [showEvidence, setShowEvidence] = useState(false)

  return (
    <div className="space-y-4 max-w-4xl">
      {/* ════════════════════════════════════════════════════════ */}
      {/* PRESCRIPTION — the conclusion (when / why / where)         */}
      {/* ════════════════════════════════════════════════════════ */}
      <section>
        <PrescriptionCard rx={prescription} analysis={analysis} loading={profileLoading} />
      </section>

      {/* ════════════════════════════════════════════════════════ */}
      {/* Evidence — collapsed; the "how we got here"                */}
      {/* ════════════════════════════════════════════════════════ */}
      <section>
        <button
          onClick={() => setShowEvidence(v => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className="text-xs font-semibold text-slate-700 flex-1 text-left">How we got here — 5-step analysis</span>
          <span className="text-[10px] text-slate-400">{showEvidence ? 'hide' : 'show'}</span>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${showEvidence ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showEvidence && (
        <div className="space-y-1.5 mt-2">
          <StepCard
            number={1}
            title="Baseline"
            signal={signalBaseline(analysis.step1.data)}
            adjustment={analysis.step1.adjustment}
            isBase={true}
            baseMonths={analysis.step1.data.baseMonths}
            confidence={analysis.step1.confidence}
          >
            <BaselineDetails data={analysis.step1.data} loading={profileLoading} error={profileError} />
          </StepCard>

          <StepCard
            number={2}
            title="Drift"
            signal={signalDrift(analysis.step2.data)}
            adjustment={analysis.step2.adjustment}
            confidence={analysis.step2.confidence}
          >
            <TrendDriftDetails data={analysis.step2.data} series={effectiveSeries} baseMonths={analysis.step1.data.baseMonths} finalMonths={analysis.step5.data.finalMonths} manufacturer={manufacturer} model={model} />
          </StepCard>

          <StepCard
            number={3}
            title="Uncertainty"
            signal={signalUncertainty(analysis.step3.data)}
            adjustment={analysis.step3.adjustment}
            confidence={analysis.step3.confidence}
          >
            <UncertaintyRiskDetails data={analysis.step3.data} />
          </StepCard>

          {analysis.step4 && (
            <StepCard
              number={4}
              title="Peer fleet"
              signal={signalPeer(analysis.step4.data)}
              adjustment={analysis.step4.adjustment}
              reference={true}
              confidence={analysis.step4.confidence}
            >
              <PeerErrorChart bands={peerBands} position={analysis.step4.data.position} />
            </StepCard>
          )}

          <StepCard
            number={5}
            title="Final"
            signal={signalFinal(analysis)}
            adjustment={analysis.step5.adjustment}
            isFinal={true}
            baseMonths={analysis.step1.data.baseMonths}
            confidence={analysis.step5.confidence}
          >
            <FinalBreakdown analysis={analysis} />
          </StepCard>
        </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════ */}
      {/* Interim Check Simulation (Future Work — kiosk)             */}
      {/* ════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-800">Interim Check Simulation</h3>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase tracking-wide">Future Work</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                What happens to the prediction once kiosk-based interim check data flows in
              </p>
            </div>
          </div>
          {/* Toggle */}
          <button
            onClick={() => setInterimOn(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
              interimOn ? 'bg-purple-600' : 'bg-slate-300'
            }`}
            aria-label="Toggle interim check simulation"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              interimOn ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {interimOn && interimSim ? (
          <div className="bg-gradient-to-br from-purple-50/60 via-white to-white border-2 border-purple-200 rounded-2xl p-4 space-y-4">
            {/* Step2 차트를 그대로 미러링 + 키오스크 토글 노출 */}
            <DriftForecastSection
              data={analysis.step2.data}
              series={effectiveSeries}
              baseMonths={analysis.step1.data.baseMonths}
              finalMonths={analysis.step5.data.finalMonths}
              manufacturer={manufacturer}
              model={model}
              showInterimToggle
            />
            {/* 양방향 결론 — 왜 중간점검이 필요한가 */}
            <InterimSimulationView
              sim={interimSim}
              series={effectiveSeries}
              baseMonths={analysis.step1.data.baseMonths}
              manufacturer={manufacturer}
              model={model}
            />
          </div>
        ) : (
          <div className="bg-purple-50/40 border border-dashed border-purple-200 rounded-xl p-5">
            <p className="text-xs text-slate-500 leading-relaxed">
              <span className="text-purple-500 mr-1">🔮</span>
              Today, prediction relies on annual calibration records and peer-fleet data.
              In the future, a low-cost, high-frequency <span className="font-semibold text-purple-700">interim check kiosk</span> will
              fill the gaps between formal calibrations — letting us catch drift months earlier.
              <br />
              <span className="text-purple-600 font-medium">Turn on the switch to simulate how the prediction sharpens once this data arrives.</span>
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Prescription card — the conclusion (when / why / where)
// ─────────────────────────────────────────────────────────────────

function PrescriptionCard({
  rx,
  analysis,
  loading,
}: {
  rx: Prescription
  analysis: CycleAnalysisResult
  loading: boolean
}) {
  const final = analysis.step5.data
  const shorten = final.direction === 'shorten'
  const dateStr = rx.recalibrateByDate ?? '—'

  return (
    <div className="border-2 border-blue-300 rounded-xl shadow-sm overflow-hidden bg-white">
      {/* ── WHEN: recalibrate-by date ── */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-5 py-4 text-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-100 mb-1 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              RECALIBRATE BY
            </div>
            {loading ? (
              <span className="inline-block h-9 w-48 bg-blue-400/40 rounded animate-pulse" />
            ) : (
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold leading-none">{dateStr}</span>
                <span className="text-sm text-blue-100">
                  {rx.recalibrateByMonths}-month cycle
                  {shorten && rx.monthsEarlierThanSpec > 0 && (
                    <span className="ml-1.5 text-amber-200 font-semibold">· {rx.monthsEarlierThanSpec} mo earlier than spec</span>
                  )}
                </span>
              </div>
            )}
          </div>
          {shorten && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-400 text-amber-900 flex-shrink-0">
              ↓ Shorten
            </span>
          )}
        </div>
      </div>

      {/* ── WHY: driver + ISO basis ── */}
      {rx.driver && (
        <div className="px-5 py-3 border-b border-slate-100 bg-amber-50/40">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠</span>
            <p className="text-xs text-slate-700 leading-relaxed">
              At the current drift, <span className="font-bold text-rose-700">{rx.driver.label}</span> is
              projected to cross the guard-banded conformance limit
              {rx.driver.monthsToGuardBandLimit != null && (
                <> in <span className="font-bold">~{rx.driver.monthsToGuardBandLimit} months</span></>
              )}
              {' '}(|error| + U &gt; tolerance) — before the {final.breakdown.base}-month spec interval.
              <span className="block mt-1 text-[10px] text-slate-400">
                Basis: KOLAS-G-008 (calibration interval) · ISO 10012 §7.1.2 (interval review) · §7.3.1 (uncertainty) · ILAC-G8 (guard banding)
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ── WHERE: focus points ── */}
      <div className="px-5 py-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Focus at next calibration</h3>
          <span className="text-[10px] text-slate-400">
            {rx.criticalCount} critical · {rx.watchCount} watch · {rx.nominalCount} nominal
          </span>
        </div>

        <div className="space-y-1.5">
          {rx.focusPoints.filter(p => p.level !== 'nominal').map((p, i) => (
            <FocusRow key={i} point={p} />
          ))}
          {/* nominal collapsed into one line */}
          {rx.nominalCount > 0 && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 rounded text-[11px]">
              <span className="text-emerald-500">✓</span>
              <span className="text-slate-500">
                {rx.nominalCount} other point(s) nominal — standard procedure
              </span>
            </div>
          )}
        </div>

        {/* Recommended points */}
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Recommended calibration points <span className="text-slate-300 normal-case">(densified near risk zone)</span></div>
          <div className="flex flex-wrap gap-1.5">
            {rx.recommendedPoints.map((pt, i) => {
              const isCritical = rx.focusPoints.some(f => f.level === 'critical' && f.label === pt)
              const isNew = !rx.focusPoints.some(f => f.label === pt)  // 세분화로 새로 추가된 포인트
              return (
                <span
                  key={i}
                  className={`text-[11px] px-2 py-0.5 rounded border font-medium ${
                    isCritical ? 'bg-rose-50 text-rose-700 border-rose-200' :
                    isNew ? 'bg-blue-50 text-blue-700 border-blue-200 border-dashed' :
                    'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  {pt}{isNew && ' +'}
                </span>
              )
            })}
          </div>
          <div className="mt-1.5 text-[9px] text-slate-400">
            <span className="text-blue-600">+</span> = added point to densify coverage around the risk zone
          </div>
        </div>
      </div>
    </div>
  )
}

function FocusRow({ point }: { point: Prescription['focusPoints'][number] }) {
  const isCritical = point.level === 'critical'
  const style = isCritical
    ? { dot: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700', label: 'CRITICAL' }
    : { dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700', label: 'WATCH' }
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${isCritical ? 'bg-rose-50/50 border-rose-200' : 'bg-amber-50/40 border-amber-100'}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
      <span className="text-sm font-bold text-slate-800 w-24 flex-shrink-0">{point.label}</span>
      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${style.badge}`}>{style.label}</span>
      <span className="text-xs text-slate-600 flex-1 min-w-0 truncate">{point.note}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Step card (shared)
// ─────────────────────────────────────────────────────────────────

interface StepCardProps {
  number: number
  title: string
  signal: string                 // 영어 한 줄 핵심 신호 (접힌 줄에 표시)
  adjustment: number
  isBase?: boolean
  isFinal?: boolean
  reference?: boolean            // 참고용 단계 — 주기 결정에 영향 X. 조정값 대신 "ref" 표시
  baseMonths?: number
  confidence: 'high' | 'medium' | 'low'
  placeholder?: boolean
  children?: React.ReactNode
}

function StepCard({ number, title, signal, adjustment, isBase, isFinal, reference, baseMonths, confidence, placeholder, children }: StepCardProps) {
  // Compact for presentation: everything collapsed by default. Click to drill down.
  const [expanded, setExpanded] = useState(false)

  const valueColor = placeholder ? 'text-slate-300' : reference ? 'text-slate-400' : adjustment < 0 ? 'text-rose-600' : adjustment > 0 ? 'text-emerald-600' : 'text-slate-700'
  const valueText = isBase
    ? `${baseMonths ?? 0} mo`
    : isFinal
    ? `${(baseMonths ?? 0) + adjustment} mo`
    : reference
    ? 'ref'
    : placeholder
    ? '—'
    : `${adjustment > 0 ? '+' : ''}${adjustment} mo`

  const borderClass = placeholder ? 'border-slate-100' : isFinal ? 'border-blue-300 shadow-sm' : isBase ? 'border-blue-200' : 'border-slate-200'
  const bgClass = placeholder ? 'bg-slate-50/40' : 'bg-white'

  return (
    <div className={`${bgClass} border ${borderClass} rounded-lg overflow-hidden transition-all`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${
          placeholder ? 'hover:bg-slate-100/50' : 'hover:bg-slate-50'
        }`}
      >
        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
          placeholder ? 'bg-slate-100 text-slate-400' :
          isFinal ? 'bg-blue-600 text-white' :
          isBase ? 'bg-blue-100 text-blue-700' :
          'bg-slate-100 text-slate-600'
        }`}>
          {number}
        </div>
        {/* title (fixed width) */}
        <span className={`text-xs font-semibold w-28 flex-shrink-0 ${placeholder ? 'text-slate-400' : 'text-slate-800'}`}>{title}</span>
        {/* signal (one-line, fills space) */}
        <span className="text-[11px] text-slate-500 flex-1 min-w-0 truncate">{signal}</span>
        {/* confidence dot */}
        {!placeholder && (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            confidence === 'high' ? 'bg-emerald-400' :
            confidence === 'medium' ? 'bg-amber-400' :
            'bg-slate-300'
          }`} title={`${confidence} confidence`} />
        )}
        {/* adjustment value */}
        <div className={`text-xs font-bold w-12 text-right flex-shrink-0 ${valueColor}`}>{valueText}</div>
        <svg className={`w-3.5 h-3.5 text-slate-300 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Drill-down detail (English only) — collapsed by default for presentation */}
      {expanded && children && (
        <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/30">
          <div className="mt-4">{children}</div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Step 1 detail (Baseline)
// ─────────────────────────────────────────────────────────────────

function BaselineDetails({ data, loading, error }: { data: BaselineData; loading: boolean; error: string | null }) {
  if (loading) {
    return <p className="text-xs text-slate-400">Loading specification…</p>
  }
  if (error) {
    return <p className="text-xs text-rose-500">{error}</p>
  }

  const sourceFlow: { label: string; active: boolean; ok: boolean }[] = [
    {
      label: 'Manufacturer spec',
      active: data.source === 'profile_recommended',
      ok: data.rawProfileValue != null,
    },
    {
      label: 'k-tools registry',
      active: data.source === 'ktools_registered',
      ok: data.rawKtoolsValue != null,
    },
    {
      label: 'Default',
      active: data.source === 'default_fallback',
      ok: true,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Top metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <MetricBox label="Baseline" value={`${data.baseMonths}`} unit="mo" primary />
        <MetricBox
          label="Source"
          value={baselineSourceLabel(data.source)}
          unit=""
          textValue
          footnote={baselineBasisStandard(data.profileStandards)}
        />
        <MetricBox
          label="Category"
          value={data.profileCategory ?? 'N/A'}
          unit=""
          textValue
          muted={!data.profileCategory}
        />
      </div>

      {/* Source priority flow */}
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1">
          <span>Source priority</span>
          <span className="text-slate-300">(leftmost = most reliable · per KOLAS-G-008)</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {sourceFlow.map((s, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                s.active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : s.ok
                  ? 'bg-white text-slate-600 border-slate-200'
                  : 'bg-slate-50 text-slate-300 border-slate-100 line-through'
              }`}>
                {s.active && <span className="mr-1">✓</span>}
                {s.label}
              </span>
              {i < sourceFlow.length - 1 && (
                <span className="text-slate-300 text-xs">→</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Data grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs bg-slate-50 rounded-lg p-3">
        {data.rawProfileValue ? (
          <DataPair label="Manufacturer value" value={data.rawProfileValue} positive />
        ) : (
          <DataPair label="Manufacturer value" value="—" />
        )}
        {data.rawKtoolsValue ? (
          <DataPair label="k-tools value" value={`${data.rawKtoolsValue} mo`} positive />
        ) : (
          <DataPair label="k-tools value" value="—" />
        )}
      </div>

      {/* Standards */}
      {data.profileStandards.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Applied standards</div>
          <div className="flex flex-wrap gap-1.5">
            {data.profileStandards.map((s, i) => (
              <span key={i} className="text-[11px] px-2 py-1 bg-blue-50 text-blue-700 rounded-md border border-blue-200 font-medium">
                📖 {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function baselineSourceLabel(source: BaselineData['source']): string {
  switch (source) {
    case 'profile_recommended': return 'Manufacturer spec'
    case 'ktools_registered': return 'k-tools registry'
    case 'default_fallback': return 'Default assumption'
  }
}

// ─────────────────────────────────────────────────────────────────
// Step 2 detail (Trend Drift)
// ─────────────────────────────────────────────────────────────────

function TrendDriftDetails({ data, series, baseMonths, finalMonths, manufacturer, model }: { data: TrendDriftData; series: TrendSeries[]; baseMonths: number; finalMonths: number; manufacturer: string; model: string }) {
  if (!data.dataQuality.enoughHistory) {
    return (
      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="font-medium text-amber-700 mb-1">📊 Insufficient data</div>
        <p>
          Longest series is {data.dataQuality.historyLength} record(s). Trend analysis needs at least 3 records to be reliable.
          Re-evaluation after the next calibration is recommended.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <RiskMetricBox label="Urgent" count={data.summary.urgentPointCount} total={data.points.length} tone="rose" />
        <RiskMetricBox label="Watch" count={data.summary.watchPointCount} total={data.points.length} tone="amber" />
        <RiskMetricBox label="Safe" count={data.summary.safePointCount} total={data.points.length} tone="emerald" />
        <RiskMetricBox label="Accelerating" count={data.summary.acceleratingCount} total={data.points.length} tone="purple" />
      </div>

      {/* Max usage ratio */}
      {data.summary.maxLatestRatio != null && (
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Latest tolerance usage (max across points)</div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-slate-700">{data.summary.maxLatestRatio.toFixed(1)}%</span>
            <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  data.summary.maxLatestRatio >= 95 ? 'bg-rose-500' :
                  data.summary.maxLatestRatio >= 80 ? 'bg-amber-500' :
                  data.summary.maxLatestRatio >= 50 ? 'bg-emerald-500' :
                  'bg-emerald-300'
                }`}
                style={{ width: `${Math.min(100, data.summary.maxLatestRatio)}%` }}
              />
            </div>
            <div className="text-[10px] text-slate-400 w-12 text-right">80 / 95</div>
          </div>
        </div>
      )}

      {/* Error forecast — the key picture: trend → prediction → limit-crossing → shorten */}
      <DriftForecastSection data={data} series={series} baseMonths={baseMonths} finalMonths={finalMonths} manufacturer={manufacturer} model={model} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Drift forecast section — pick a measurement point (tabs), then show
// its measured-past + AI-predicted-future error against the tolerance
// limit. Proves "wait the full spec interval and you'll exceed → shorten".
// ─────────────────────────────────────────────────────────────────

function DriftForecastSection({
  data,
  series,
  baseMonths,
  finalMonths,
  manufacturer,
  model,
  showInterimToggle = false,
}: {
  data: TrendDriftData
  series: TrendSeries[]
  baseMonths: number
  finalMonths: number
  manufacturer: string
  model: string
  // true면 "+ Interim kiosk checks" 토글을 노출(5번 Future Work에서 사용).
  //   false면 정식 교정점만 그리는 순수 Step2 차트(중복 없이 같은 컴포넌트 재사용).
  showInterimToggle?: boolean
}) {
  // 중간점검(키오스크) 토글 — ON이면 정식 series에 키오스크점을 박아 재예측.
  const [interimOn, setInterimOn] = useState(false)
  // 토글을 노출하지 않는 곳(Step2)에서는 항상 정식 series만 사용.
  const interimActive = showInterimToggle && interimOn
  // 차트 가능한 포인트 = 실측 2회 이상. 측정점(토크값) 오름차순으로 탭 정렬
  //   (50→100→…→250 N·m). 심각도는 정렬이 아니라 배경색으로 구분한다.
  const seriesByLabel = useMemo(() => new Map(series.map(s => [s.label, s])), [series])
  const selectable = useMemo(() => {
    // 라벨에서 수치 추출 ("50 N·m" → 50). 숫자 없으면 큰 값으로 밀어 뒤로.
    const numOf = (label: string) => {
      const m = label.match(/-?\d+(?:\.\d+)?/)
      return m ? parseFloat(m[0]) : Number.POSITIVE_INFINITY
    }
    return [...data.points]
      .filter(p => {
        const s = seriesByLabel.get(p.label)
        return s != null && s.points.filter(pt => pt.오차 != null).length >= 2
      })
      .sort((a, b) => numOf(a.label) - numOf(b.label) || a.label.localeCompare(b.label))
  }, [data.points, seriesByLabel])

  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const active = activeLabel ?? selectable[0]?.label ?? null

  const horizonMonths = Math.max(baseMonths + 12, 24)
  const forecast = useMemo<ErrorForecast | null>(() => {
    if (!active) return null
    const s = seriesByLabel.get(active)
    if (!s) return null
    // 토글 ON → 키오스크 중간점검점을 박은 series로 재예측 (회귀·crossing·권고 변화)
    const src = interimActive ? buildInterimAugmentedSeries(s, baseMonths, { manufacturer, model }) : s
    return buildErrorForecast(src, horizonMonths, baseMonths)
  }, [active, seriesByLabel, horizonMonths, baseMonths, interimActive, manufacturer, model])

  if (selectable.length === 0 || !forecast) {
    return (
      <div className="text-xs text-slate-400 text-center py-3">Not enough calibration history to forecast.</div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Error trend & limit-crossing forecast — select a measurement point
        </div>
        {/* interim-check (kiosk) toggle — 5번(Future Work)에서만 노출 */}
        {showInterimToggle && (
          <button
            onClick={() => setInterimOn(v => !v)}
            className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors flex-shrink-0 ${
              interimOn ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'
            }`}
            title="Add low-cost, high-frequency interim kiosk checks between formal calibrations"
          >
            <span className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${interimOn ? 'bg-white/40' : 'bg-purple-200'}`}>
              <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform ${interimOn ? 'translate-x-3' : 'translate-x-0.5'}`} />
            </span>
            + Interim kiosk checks
          </button>
        )}
      </div>

      {interimActive && (
        <div className="mb-2 flex items-center gap-1.5 text-[10px] text-purple-700 bg-purple-50/70 border border-purple-200 rounded-md px-2 py-1">
          <span>🔮</span>
          <span>
            <span className="font-semibold">Interim checks added</span> — low-precision (large U), high-frequency points are
            now folded in. The regression, limit-crossing and recommended date update live below.
          </span>
        </div>
      )}

      {/* point tabs — ordered by torque (50→250); severity shown by background color */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {selectable.map(p => {
          const on = p.label === active
          // 심각도 = 배경색 (urgent 빨강 / watch 주황 / safe 초록). 선택 시 진하게.
          const tone =
            p.riskLevel === 'urgent' ? (on ? 'bg-rose-600 text-white border-rose-600 ring-2 ring-rose-300' : 'bg-rose-100 text-rose-700 border-rose-300') :
            p.riskLevel === 'watch'  ? (on ? 'bg-amber-500 text-white border-amber-500 ring-2 ring-amber-300' : 'bg-amber-100 text-amber-700 border-amber-300') :
                                       (on ? 'bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200')
          return (
            <button
              key={p.label}
              onClick={() => setActiveLabel(p.label)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all ${tone}`}
            >
              {p.label}
              <span className="ml-1 opacity-70 font-normal">{p.latestRatio != null ? `${p.latestRatio.toFixed(0)}%` : ''}</span>
            </button>
          )
        })}
      </div>
      {/* severity legend (background color = risk level) */}
      <div className="flex items-center gap-3 mb-3 text-[10px] text-slate-500 flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-100 border border-rose-300" /> Urgent</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" /> Watch</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-50 border border-emerald-200" /> Safe</span>
        <span className="text-slate-400">· % = latest tolerance usage</span>
      </div>

      <ErrorForecastChart forecast={forecast} baseMonths={baseMonths} finalMonths={finalMonths} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Drift trend chart — every measurement point's tolerance-usage history
// on ONE chart. X = calibration #, Y = % of tolerance used.
// Risk points are drawn bold; safe points fade into the background.
// The 80% / 95% lines are the "approaching the limit" thresholds.
// ─────────────────────────────────────────────────────────────────

function ErrorForecastChart({
  forecast,
  baseMonths,
  finalMonths,
}: {
  forecast: ErrorForecast
  baseMonths: number
  finalMonths: number
}) {
  const { points, tolerance: tol, nowDate, crossing } = forecast
  const measured = points.filter(p => p.measured)
  const predicted = points.filter(p => !p.measured)
  if (measured.length < 2) {
    return <div className="text-xs text-slate-400 text-center py-3">Not enough history to forecast.</div>
  }

  const W = 620, H = 286
  // padT 를 키워(라벨 2단까지 들어가게) Recalibrate by / Spec due 가 겹칠 때
  //   Spec due 를 위 단으로 올려도 차트 위로 잘리지 않게 한다.
  const padL = 44, padR = 26, padT = 64, padB = 34
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  // ── 시간축 4기준점 (직전 교정일 / 오늘 / 권장 교정일 / 차기(spec) 교정일) ──
  // 직전 교정일 = 마지막 실측일. 차기(spec) = 직전 + baseMonths(원래 1년 term).
  // 권장 교정일 = tolerance+U 초과(crossing) 시점 — 없으면(안 넘으면) spec과 동일.
  const lastCalDate = nowDate
  const recDate = crossing.best ?? null      // 권장 = 초과 시점
  const recMonths = crossing.bestMonths       // 직전 교정일로부터 개월
  // X = yearFrac (0 = first calibration). 끝은 마지막 예측점.
  const xMin = 0
  const xMax = points[points.length - 1].yearFrac || 1
  const xSpan = xMax - xMin || 1
  const sx = (yf: number) => padL + ((yf - xMin) / xSpan) * plotW

  // Y = error(%). ±tol 한계선이 항상 같은 비율로(대칭) 보이도록 0 중심 대칭 범위.
  //   예측 CI/측정점이 ±tol 을 넘어가면 그만큼 더 키운다(그래도 0 대칭 유지).
  const yReach = Math.max(
    tol * 1.25,
    ...points.map(p => Math.abs(p.error)),
    ...predicted.map(p => Math.abs(p.ciHigh95)), ...predicted.map(p => Math.abs(p.ciLow95)),
    ...measured.map(p => Math.abs(p.error) + (p.u ?? 0)),
  )
  const yMax = yReach
  const yMin = -yReach
  const ySpan = (yMax - yMin) || 1
  const sy = (e: number) => padT + (1 - (e - yMin) / ySpan) * plotH

  // 마지막 "정식" 측정점 (키오스크 중간점검점 제외) — 기준점·부호 판정용
  const lastFormal = [...measured].reverse().find(p => p.interim !== true) ?? measured[measured.length - 1]
  // 부호 방향(오차가 커지는 쪽)의 tolerance 선이 "위험 한계"
  const limitSign = (lastFormal.error >= 0) ? 1 : -1
  const yLimit = sy(limitSign * tol)   // crossing 마커가 닿는 위험 방향 한계선

  // x 좌표: NOW 및 crossing 날짜를 yearFrac으로
  const baseDate = measured[0].date
  const yfOf = (date: string) => {
    const [ay, am] = baseDate.split('-').map(Number)
    const [by, bm] = date.split('-').map(Number)
    return (by - ay) + ((bm || 1) - (am || 1)) / 12
  }
  // NOW(직전 교정일) = 마지막 "정식" 교정일(forecast.nowDate). 키오스크 중간점검점은
  //   measured 에 섞여 들어오므로 measured 의 마지막 점으로 잡으면 안 된다(미래로 밀림).
  //   → Last cal / Spec due 기준점이 토글에 흔들리지 않도록 nowDate 로 고정한다.
  const nowYf = yfOf(nowDate)
  // 4기준점의 x좌표
  const xLastCal = sx(nowYf)                                   // ① 직전 교정일 (term 시작)
  const xToday = sx(nowYf + 0.5 / 12)                          // ② 오늘 (직전+약 2주, 데모상 거의 같음)
  const xDueSpec = sx(nowYf + baseMonths / 12)                 // ④ 차기(spec) 교정일 = 직전 + 1년
  const xCross = recDate ? sx(yfOf(recDate)) : null            // ③ 권장 교정일 = 초과 시점
  const recWithinSpec = recMonths != null && recMonths < baseMonths

  // ── 라벨 레이아웃 (꺾은선 leader + 동적 충돌 해소) ──
  //   각 시간 마커의 라벨을 "라벨 레인"(차트 위 고정 높이)에 두고, 세로선 머리에서
  //   라벨까지 ㄱ자 꺾은선으로 잇는다. 라벨이 X로 겹치면 좌우로 밀어(collision)
  //   배치하므로, 마커가 아무리 붙어도 글자는 안 겹친다.
  const flagDefs = [
    xCross != null ? { key: 'rec',  anchorX: xCross,  half: 58, label: '✓ Recalibrate by', sub: `${recDate ? fmtMonthYear(recDate) : ''}${recMonths != null ? ` (${recMonths}mo)` : ''}`, tone: 'blue' as const } : null,
    xDueSpec <= W - padR ? { key: 'spec', anchorX: xDueSpec, half: 46, label: `Spec due · ${baseMonths}mo`, sub: fmtMonthYear(addMonthsStr(lastCalDate, baseMonths)), tone: 'slate' as const } : null,
  ].filter((f): f is NonNullable<typeof f> => f != null)
  // 앵커X 순으로 정렬 후, 인접 라벨이 겹치면(중심거리 < 두 half합) 우측을 오른쪽으로 민다.
  const laneFlags = (() => {
    const sorted = [...flagDefs].sort((a, b) => a.anchorX - b.anchorX)
    const placed: { key: string; anchorX: number; labelX: number; label: string; sub: string; tone: 'blue' | 'slate' }[] = []
    for (const f of sorted) {
      let labelX = f.anchorX
      const prev = placed[placed.length - 1]
      if (prev) {
        const prevHalf = flagDefs.find(d => d.key === prev.key)!.half
        const minGap = prevHalf + f.half + 6
        if (labelX - prev.labelX < minGap) labelX = prev.labelX + minGap
      }
      // 오른쪽 경계 넘으면 안쪽으로 당김
      labelX = Math.min(labelX, W - padR - f.half)
      placed.push({ key: f.key, anchorX: f.anchorX, labelX, label: f.label, sub: f.sub, tone: f.tone })
    }
    return placed
  })()

  // year ticks
  const yearTicks: { x: number; label: string }[] = []
  {
    const startY = Number(baseDate.slice(0, 4))
    const endY = Number(points[points.length - 1].date.slice(0, 4))
    for (let y = startY; y <= endY; y++) yearTicks.push({ x: sx(y - startY), label: String(y) })
  }

  // ── single least-squares regression line (Excel-style trendline) ──
  // error(t) = slope·t + intercept  (t = years from first calibration).
  // Past segment (first measurement → NOW) solid; future (NOW → horizon) dashed.
  //   분기점 NOW = 마지막 정식 교정일(nowYf). 키오스크점은 NOW 이후에 얹히므로
  //   "실선/점선 경계"가 토글에 흔들리지 않는다(기준선과 일관).
  const regErr = (yf: number) => forecast.fit.slopePerYear * yf + forecast.fit.intercept
  const xFirst = measured[0].yearFrac
  const xNowYf = nowYf
  const xLast = points[points.length - 1].yearFrac
  // 과거 구간 직선 (실선)
  const regPastLine = `${sx(xFirst).toFixed(1)},${sy(regErr(xFirst)).toFixed(1)} ${sx(xNowYf).toFixed(1)},${sy(regErr(xNowYf)).toFixed(1)}`
  // 미래 구간 직선 (점선)
  const regFutureLine = `${sx(xNowYf).toFixed(1)},${sy(regErr(xNowYf)).toFixed(1)} ${sx(xLast).toFixed(1)},${sy(regErr(xLast)).toFixed(1)}`

  // 불확도 밴드(고정폭 ±U) — 예측 구간에서 예측선을 ±U 로 평행하게 감싼다(부채꼴 X).
  //   각 예측점의 ciHigh/Low 가 이미 yhat±U 로 채워져 있으므로 그대로 띠를 만든다.
  const uBand = forecast.guardBandU
  // 밴드 시작점 = NOW(정식 마지막) 의 회귀선 ±U. 이후 예측점들로 이어진다.
  const bandSeq = [{ yearFrac: nowYf, ciHigh95: regErr(xNowYf) + uBand, ciLow95: regErr(xNowYf) - uBand }, ...predicted]
  const uBandPoly = [
    ...bandSeq.map(p => `${sx(p.yearFrac).toFixed(1)},${sy(p.ciHigh95).toFixed(1)}`),
    ...[...bandSeq].reverse().map(p => `${sx(p.yearFrac).toFixed(1)},${sy(p.ciLow95).toFixed(1)}`),
  ].join(' ')
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="text-xs font-bold text-slate-700">
          Error trend at <span className="text-blue-700">{forecast.label}</span> — measured &amp; linear-regression forecast
        </div>
        {/* regression equation summary (y = a·t + b, with R² · n) */}
        <div className="flex-shrink-0 text-right">
          {forecast.fit.significant ? (
            <div className="text-xs text-slate-500 leading-snug">
              <span className="font-mono font-semibold text-[#ea580c]">
                y = {forecast.fit.slopePerYear.toFixed(2)}·t {forecast.fit.intercept >= 0 ? '+' : '−'} {Math.abs(forecast.fit.intercept).toFixed(2)}
              </span>
              <span className="text-slate-400">
                {'  · '}R² = <span className={`font-bold ${forecast.fit.r2 >= 0.9 ? 'text-emerald-600' : forecast.fit.r2 >= 0.7 ? 'text-amber-600' : 'text-slate-500'}`}>{forecast.fit.r2.toFixed(2)}</span>
                {' · '}n = {forecast.fit.n}
              </span>
            </div>
          ) : (
            <div className="text-xs text-slate-400 leading-snug">
              No significant trend · R² = {forecast.fit.r2.toFixed(2)} · stable
            </div>
          )}
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block" preserveAspectRatio="xMidYMid meet">
        {/* fail zones: beyond ±tolerance (both sides, symmetric) */}
        <rect x={padL} y={padT} width={plotW} height={Math.max(0, sy(tol) - padT)} fill="#fecaca" fillOpacity="0.4" />
        <rect x={padL} y={sy(-tol)} width={plotW} height={Math.max(0, (H - padB) - sy(-tol))} fill="#fecaca" fillOpacity="0.4" />

        {/* original 1-year term: subtle band (last cal → spec due) */}
        <rect x={xLastCal} y={padT} width={Math.min(xDueSpec, W - padR) - xLastCal} height={plotH} fill="#dbeafe" fillOpacity="0.4" />

        {/* y-axis grid + tick labels (% error). step = 2% (or tol/2 for small tol) */}
        {(() => {
          const step = tol >= 4 ? 2 : tol / 2
          const ticks: number[] = []
          for (let v = 0; v <= yMax + 1e-6; v += step) ticks.push(Math.round(v * 10) / 10)
          const all = [...ticks.slice(1).map(v => -v).reverse(), ...ticks]
          return all.map((v, i) => {
            const atTol = Math.abs(Math.abs(v) - tol) < 1e-6   // ±tol 위치는 tolerance 라벨이 담당
            return (
              <g key={`yt-${i}`}>
                {v !== 0 && !atTol && (
                  <line x1={padL} y1={sy(v)} x2={W - padR} y2={sy(v)} stroke="#f1f5f9" strokeWidth="1" />
                )}
                {!atTol && (
                  <text x={padL - 6} y={sy(v) + 3} textAnchor="end" className="fill-slate-400" fontSize="9.5">
                    {v > 0 ? '+' : ''}{v}
                  </text>
                )}
              </g>
            )
          })
        })()}
        {/* zero baseline (emphasized) */}
        <line x1={padL} y1={sy(0)} x2={W - padR} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />

        {/* ±tolerance limit lines (both sides, same style) */}
        <line x1={padL} y1={sy(tol)} x2={W - padR} y2={sy(tol)} stroke="#ef4444" strokeWidth="1.4" strokeDasharray="6 3" />
        <line x1={padL} y1={sy(-tol)} x2={W - padR} y2={sy(-tol)} stroke="#ef4444" strokeWidth="1.4" strokeDasharray="6 3" />
        <text x={W - padR - 2} y={sy(tol) - 4} textAnchor="end" className="fill-rose-500" fontSize="9.5" fontWeight="700">+{tol}% limit</text>
        <text x={W - padR - 2} y={sy(-tol) + 12} textAnchor="end" className="fill-rose-500" fontSize="9.5" fontWeight="700">−{tol}% limit</text>

        {/* uncertainty band (fixed ±U around the prediction — measurement uncertainty) */}
        <polygon points={uBandPoly} fill="#fbbf24" fillOpacity="0.28" stroke="#f59e0b" strokeWidth="0.5" strokeOpacity="0.4" />

        {/* exposure span: recommended → spec due (out of tolerance if we wait) — on the x axis */}
        {xCross != null && recWithinSpec && xDueSpec > xCross && (
          <rect x={xCross} y={H - padB - 3} width={Math.min(xDueSpec, W - padR) - xCross} height={3} fill="#f43f5e" opacity="0.7" />
        )}

        {/* ── in-chart time anchors: vertical lines + top labels (inside the plot) ── */}
        {/* 세로선들 (라벨은 아래에서 leader 로 따로 그림) */}
        <line x1={xLastCal} y1={padT} x2={xLastCal} y2={H - padB} stroke="#94a3b8" strokeWidth="1.2" />
        {xDueSpec <= W - padR && (
          <line x1={xDueSpec} y1={padT} x2={xDueSpec} y2={H - padB} stroke="#94a3b8" strokeWidth="1.2" />
        )}
        {xCross != null && (
          <line x1={xCross} y1={padT} x2={xCross} y2={H - padB} stroke="#2563eb" strokeWidth="2" />
        )}
        {/* ① last cal — 좌측이라 겹침 거의 없음: 기존 직상단 라벨 유지 */}
        <ChartFlag x={xLastCal} topY={padT} label="Last cal" sub={fmtMonthYear(lastCalDate)} tone="slate" align="start" W={W} padL={padL} padR={padR} />
        {/* ③④ recommended / spec due — 꺾은선 leader + 동적 충돌 해소 */}
        {laneFlags.map(f => (
          <LeaderFlag key={f.key} anchorX={f.anchorX} labelX={f.labelX} laneY={padT - 30} markerY={padT}
            label={f.label} sub={f.sub} tone={f.tone} />
        ))}
        {/* ② today — compact: small triangle + word, near the x axis (below the Last cal flag) */}
        <path d={`M ${xToday} ${H - padB - 6} l -4 -6 l 8 0 z`} fill="#0f172a" />
        <text x={xToday} y={H - padB - 14} textAnchor="middle" fontSize="9" fontWeight="700" className="fill-slate-700"
          stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">today</text>

        {/* measured points + ±U error bars (uncertainty made clearly visible).
            정식 교정점 = 네이비·작은 U / 키오스크 중간점검점 = 연보라·큰 U. */}
        {measured.map((p, i) => {
          const x = sx(p.yearFrac), y = sy(p.error)
          const u = p.u ?? 0
          const isInterim = p.interim === true
          const barColor = isInterim ? '#c4b5fd' : '#334155'
          const dotColor = isInterim ? '#a78bfa' : '#1e3a5f'
          const cap = isInterim ? 3.5 : 5
          const bw = isInterim ? 1.4 : 1.6
          return (
            <g key={`m-${i}`}>
              {u > 0 && (
                <>
                  {/* vertical whisker */}
                  <line x1={x} y1={sy(p.error + u)} x2={x} y2={sy(p.error - u)} stroke={barColor} strokeWidth={bw} />
                  {/* end caps */}
                  <line x1={x - cap} y1={sy(p.error + u)} x2={x + cap} y2={sy(p.error + u)} stroke={barColor} strokeWidth={bw} />
                  <line x1={x - cap} y1={sy(p.error - u)} x2={x + cap} y2={sy(p.error - u)} stroke={barColor} strokeWidth={bw} />
                </>
              )}
              <circle cx={x} cy={y} r={isInterim ? 2.6 : 3.4} fill={dotColor} fillOpacity={isInterim ? 0.85 : 1} stroke="#fff" strokeWidth={isInterim ? 1 : 1.2} />
            </g>
          )
        })}

        {/* regression line: measured (solid navy) → predicted (dashed orange) */}
        <polyline points={regPastLine} fill="none" stroke="#1e3a5f" strokeWidth="2.4" strokeLinecap="round" />
        <polyline points={regFutureLine} fill="none" stroke="#ea580c" strokeWidth="2.6" strokeDasharray="7 4" strokeLinecap="round" />

        {/* crossing marker where prediction meets the limit */}
        {xCross != null && (
          <circle cx={xCross} cy={yLimit} r="5.5" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />
        )}

        {/* x axis */}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#e2e8f0" strokeWidth="1" />
        {yearTicks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={H - padB} x2={t.x} y2={H - padB + 3} stroke="#cbd5e1" strokeWidth="1" />
            <text x={t.x} y={H - padB + 15} textAnchor="middle" className="fill-slate-500" fontSize="10.5">{t.label}</text>
          </g>
        ))}
        <text x={12} y={padT + plotH / 2} textAnchor="middle" className="fill-slate-400" fontSize="10.5" transform={`rotate(-90 12 ${padT + plotH / 2})`}>Error (%)</text>
      </svg>

      {/* conclusion callout — the original term vs the recommendation */}
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
        <span className="text-rose-500 text-base leading-none mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          {recWithinSpec ? (
            <>
              <div className="text-xs font-bold text-rose-700">
                Recalibrate by <span className="tabular-nums">{recDate ? fmtMonthYear(recDate) : '—'}</span>
                {recMonths != null && <span className="text-rose-500"> (~{recMonths} mo after last cal)</span>}
                <span className="text-slate-500 font-medium"> — {baseMonths - (recMonths ?? 0)} mo earlier than the {baseMonths}-mo spec</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Linear-regression trend + measurement uncertainty: |error| + U reaches the tolerance limit (ILAC-G8 guard band). Extrapolation confidence is not yet quantified (future work).
              </div>
              <div className="text-[11px] mt-1 text-slate-600">
                At this drift the unit would sit <span className="font-bold text-rose-700">out of tolerance</span> for the rest of the original {baseMonths}-month term — so it must be recalibrated earlier.
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-600">
              The prediction stays within tolerance through the full {baseMonths}-month term — the standard interval is adequate.
            </div>
          )}
        </div>
      </div>

      {/* legend (minimal) */}
      <div className="mt-2 flex items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-4 h-0.5 bg-[#1e3a5f]" /> Measured (± U)</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 h-0.5 bg-[#ea580c]" style={{ borderTop: '2px dashed' }} /> Predicted (linear reg.)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2" style={{ background: 'rgba(251,191,36,0.28)' }} /> Uncertainty (±U)</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 h-0.5 bg-rose-500" style={{ borderTop: '2px dashed' }} /> Tolerance limit</span>
      </div>
    </div>
  )
}

// 차트 안 상단 시간 마커 라벨 (세로선 머리에 2줄). align 으로 좌/우/중앙 정렬.
//   level: 0=기본 단, 1=한 단 위(인접 라벨끼리 X로 겹칠 때 세로로 분리).
function ChartFlag({
  x, topY, label, sub, tone, align, W, padL, padR, level = 0,
}: {
  x: number; topY: number; label: string; sub: string
  tone: 'slate' | 'blue'; align: 'start' | 'middle' | 'end'
  W: number; padL: number; padR: number; level?: number
}) {
  const color = tone === 'blue' ? '#2563eb' : '#475569'
  const subColor = tone === 'blue' ? '#3b82f6' : '#94a3b8'
  // 텍스트가 경계 넘지 않게 x 보정 (align 방향 고려)
  const tx = Math.max(padL + 2, Math.min(x, W - padR - 2))
  const anchor = align === 'start' ? 'end' : align === 'end' ? 'start' : 'middle'
  // start정렬 라벨은 선 왼쪽, end는 선 오른쪽, middle은 중앙 — 겹침 최소화
  const off = align === 'start' ? -4 : align === 'end' ? 4 : 0
  // 한 단당 24px 위로 (2줄 라벨 높이). level>0 이면 위로 올라가 X로 겹쳐도 안 부딪힘.
  const dy = -level * 24
  return (
    <g>
      {/* 위 단으로 올렸을 때, 세로선 머리에서 라벨까지 가는 점선 leader */}
      {level > 0 && (
        <line x1={tx} y1={topY - 4} x2={tx} y2={topY + dy + 2} stroke={subColor} strokeWidth="0.8" strokeDasharray="2 2" opacity="0.7" />
      )}
      <text x={tx + off} y={topY - 18 + dy} textAnchor={anchor} fontSize="10" fontWeight={tone === 'blue' ? 800 : 700}
        fill={color} stroke="#fff" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">{label}</text>
      <text x={tx + off} y={topY - 6 + dy} textAnchor={anchor} fontSize="9" fontWeight="600"
        fill={subColor} stroke="#fff" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">{sub}</text>
    </g>
  )
}

// 꺾은선 leader 라벨 — 세로선 머리(anchorX, markerY)에서 라벨(labelX, laneY)까지
//   ㄱ자(elbow) 선으로 잇는다. 라벨이 마커에서 좌/우로 밀려나도 선이 자연히 따라가
//   "어느 세로선의 라벨인지"가 명확하다. (동적 충돌 해소와 함께 동작)
function LeaderFlag({
  anchorX, labelX, laneY, markerY, label, sub, tone,
}: {
  anchorX: number; labelX: number; laneY: number; markerY: number
  label: string; sub: string; tone: 'blue' | 'slate'
}) {
  const color = tone === 'blue' ? '#2563eb' : '#475569'
  const subColor = tone === 'blue' ? '#3b82f6' : '#94a3b8'
  const shifted = Math.abs(labelX - anchorX) > 1
  // elbow: 마커머리 → 위로 → 라벨X로 수평 → 라벨 바로 위까지. (라벨은 laneY 기준 2줄)
  const elbowY = laneY + 14          // 수평 구간 높이(라벨 바로 아래)
  const path = `M ${anchorX} ${markerY} L ${anchorX} ${elbowY} L ${labelX} ${elbowY} L ${labelX} ${laneY + 2}`
  return (
    <g>
      {/* leader 선 + 마커머리 점 */}
      <path d={path} fill="none" stroke={subColor} strokeWidth={shifted ? 1 : 0.9} strokeOpacity={shifted ? 0.85 : 0.5} strokeDasharray={shifted ? 'none' : '2 2'} />
      <circle cx={anchorX} cy={markerY} r="2" fill={color} />
      {/* 라벨 2줄 (흰 외곽선으로 가독성) */}
      <text x={labelX} y={laneY - 6} textAnchor="middle" fontSize="10" fontWeight={tone === 'blue' ? 800 : 700}
        fill={color} stroke="#fff" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">{label}</text>
      <text x={labelX} y={laneY + 5} textAnchor="middle" fontSize="9" fontWeight="600"
        fill={subColor} stroke="#fff" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">{sub}</text>
    </g>
  )
}

// "YYYY-MM-DD" → "YYYY-MM" (ISO 8601, 예: 2026-09-11 → 2026-09)
function fmtMonthYear(d: string | null): string {
  if (!d) return '—'
  const [y, m] = d.split('-').map(Number)
  if (!y || !m) return '—'
  return `${y}-${String(m).padStart(2, '0')}`
}

// "YYYY-MM-DD" + N개월 → "YYYY-MM-DD"
function addMonthsStr(d: string, months: number): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m) return d
  const total = (m - 1) + months
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`
}

function RiskMetricBox({
  label,
  count,
  total,
  tone,
}: {
  label: string
  count: number
  total: number
  tone: 'rose' | 'amber' | 'emerald' | 'purple'
}) {
  const muted = count === 0
  const cls = muted
    ? 'bg-slate-50 border-slate-200 text-slate-400'
    : tone === 'rose' ? 'bg-rose-50 border-rose-200 text-rose-700'
    : tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-700'
    : tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : 'bg-purple-50 border-purple-200 text-purple-700'
  return (
    <div className={`px-3 py-2 border rounded-lg ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold">{count}</span>
        <span className="text-[10px] opacity-60">/ {total}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Step 3 detail (Uncertainty Risk)
// ─────────────────────────────────────────────────────────────────

// ── Guard band concept chart (ILAC G-8) ──────────────────────────
// 발표 슬라이드용 핵심 그림. "이 화면만 봐도" 가드밴드 개념이 이해되도록:
//   각 측정점의 [측정 오차 점] 에 [± 확장불확도 U 막대]를 세우고,
//   그 막대가 ±tolerance 한계선에 얼마나 가까운지를 한눈에 보여준다.
//   - U 막대가 한계선 안에서 여유 → conformant (합격, 안전)
//   - U 막대가 한계 ~ 한계 사이(가드밴드)에 닿음 → conditional (불확도 감안 시 초과 가능)
//   - 점 자체가 한계 밖 → non-conformant
// conformant 만 있어도 "한계까지의 여유"가 막대로 보이므로 그림이 살아있다.
function GuardBandConceptChart({
  points,
}: {
  points: PointUncertaintyAnalysis[]
}) {
  // 차트에 그릴 수 있는 점만 (오차·U·tol 모두 존재)
  const pts = points.filter(
    (p): p is PointUncertaintyAnalysis & { latestError: number; latestUAbs: number; tolerance: number } =>
      p.latestError != null && p.latestUAbs != null && p.tolerance != null,
  )
  if (pts.length === 0) {
    return (
      <div className="text-xs text-slate-400 text-center py-3 bg-white border border-slate-200 rounded-lg">
        No measured error / uncertainty data to plot.
      </div>
    )
  }

  // tolerance 는 보통 모든 점이 동일(±4%)하나, 혹시 다르면 최댓값 기준으로 축을 잡는다.
  const tol = Math.max(...pts.map(p => p.tolerance))

  // ── geometry ──
  const W = 640, H = 320
  const padL = 52, padR = 24, padT = 30, padB = 52
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  // Y = 오차%(0 중심 대칭). 한계선 + U막대 끝이 넉넉히 보이도록 여유.
  const yReach = Math.max(
    tol * 1.18,
    ...pts.map(p => Math.abs(p.latestError) + p.latestUAbs),
  )
  const yMin = -yReach, yMax = yReach
  const ySpan = (yMax - yMin) || 1
  const sy = (e: number) => padT + (1 - (e - yMin) / ySpan) * plotH

  // X = 측정점 균등 배치 (slot 중앙)
  const n = pts.length
  const slotW = plotW / n
  const sx = (i: number) => padL + slotW * (i + 0.5)

  // 판정별 색
  const colorOf = (gb: PointUncertaintyAnalysis['latestGuardBand']) =>
    gb === 'non-conformant' ? '#dc2626' :
    gb === 'conditional-fail' ? '#f43f5e' :
    gb === 'conditional-pass' ? '#f59e0b' :
    '#10b981' // conformant or null → 안전색
  const verdictLabel = (gb: PointUncertaintyAnalysis['latestGuardBand']) =>
    gb === 'non-conformant' ? 'Fail' :
    gb === 'conditional-fail' ? 'Cond. fail' :
    gb === 'conditional-pass' ? 'Borderline' :
    'Pass'

  // Y축 눈금 (±tol 안에서 정수%, step = tol>=4 ? 2 : tol/2)
  const yStep = tol >= 4 ? 2 : tol / 2
  const yTicks: number[] = []
  for (let v = 0; v <= yMax + 1e-6; v += yStep) yTicks.push(Math.round(v * 10) / 10)
  const yTickAll = [...yTicks.slice(1).map(v => -v).reverse(), ...yTicks]

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="text-xs font-bold text-slate-700 mb-0.5">
        Guard band — measured error <span className="text-slate-400 font-normal">±</span> expanded uncertainty (U) vs tolerance limit
      </div>
      <div className="text-[10px] text-slate-400 mb-1.5">
        ILAC G-8 · each bar is the measurement&apos;s ± U; how close it reaches the ±{tol}% limit decides conformance
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block" preserveAspectRatio="xMidYMid meet">
        {/* fail zones: beyond ±tolerance */}
        <rect x={padL} y={padT} width={plotW} height={Math.max(0, sy(tol) - padT)} fill="#fecaca" fillOpacity="0.35" />
        <rect x={padL} y={sy(-tol)} width={plotW} height={Math.max(0, (H - padB) - sy(-tol))} fill="#fecaca" fillOpacity="0.35" />

        {/* y grid + tick labels */}
        {yTickAll.map((v, i) => {
          const atTol = Math.abs(Math.abs(v) - tol) < 1e-6
          return (
            <g key={`yt-${i}`}>
              {v !== 0 && !atTol && <line x1={padL} y1={sy(v)} x2={W - padR} y2={sy(v)} stroke="#f1f5f9" strokeWidth="1" />}
              {!atTol && (
                <text x={padL - 7} y={sy(v) + 3} textAnchor="end" className="fill-slate-400" fontSize="9.5">
                  {v > 0 ? '+' : ''}{v}
                </text>
              )}
            </g>
          )
        })}

        {/* zero baseline */}
        <line x1={padL} y1={sy(0)} x2={W - padR} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1.2" />

        {/* ±tolerance limit lines */}
        <line x1={padL} y1={sy(tol)} x2={W - padR} y2={sy(tol)} stroke="#ef4444" strokeWidth="1.6" strokeDasharray="6 3" />
        <line x1={padL} y1={sy(-tol)} x2={W - padR} y2={sy(-tol)} stroke="#ef4444" strokeWidth="1.6" strokeDasharray="6 3" />
        <text x={W - padR - 2} y={sy(tol) - 4} textAnchor="end" className="fill-rose-500" fontSize="9.5" fontWeight="700">+{tol}% limit</text>
        <text x={W - padR - 2} y={sy(-tol) + 12} textAnchor="end" className="fill-rose-500" fontSize="9.5" fontWeight="700">−{tol}% limit</text>

        {/* per-point: ± U bar + measured dot + verdict label */}
        {pts.map((p, i) => {
          const x = sx(i)
          const e = p.latestError
          const u = p.latestUAbs
          const c = colorOf(p.latestGuardBand)
          const yTop = sy(e + u), yBot = sy(e - u)
          const cap = 7
          // 한계까지 남은 여유(가장 위험한 쪽). conformant 일수록 큼.
          const margin = tol - (Math.abs(e) + u)
          return (
            <g key={`gb-${i}`}>
              {/* U bar body (반투명 굵은 띠) */}
              <rect x={x - 9} y={yTop} width={18} height={Math.max(1, yBot - yTop)} rx={3} fill={c} fillOpacity="0.20" />
              {/* whisker + caps */}
              <line x1={x} y1={yTop} x2={x} y2={yBot} stroke={c} strokeWidth="2" />
              <line x1={x - cap} y1={yTop} x2={x + cap} y2={yTop} stroke={c} strokeWidth="2" />
              <line x1={x - cap} y1={yBot} x2={x + cap} y2={yBot} stroke={c} strokeWidth="2" />
              {/* measured error dot */}
              <circle cx={x} cy={sy(e)} r="4" fill={c} stroke="#fff" strokeWidth="1.4" />
              {/* verdict badge above the bar */}
              <g transform={`translate(${x}, ${Math.max(padT + 10, yTop - 8)})`}>
                <text textAnchor="middle" fontSize="9.5" fontWeight="700" fill={c}
                  stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">
                  {verdictLabel(p.latestGuardBand)}
                </text>
              </g>
              {/* margin-to-limit chip below the bar (얼마나 여유 있나) */}
              <text x={x} y={yBot + 13} textAnchor="middle" fontSize="8.5" className="fill-slate-400">
                {margin >= 0 ? `${margin.toFixed(1)}% to limit` : `${Math.abs(margin).toFixed(1)}% over`}
              </text>
            </g>
          )
        })}

        {/* x axis */}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#e2e8f0" strokeWidth="1" />
        {pts.map((p, i) => (
          <text key={`xl-${i}`} x={sx(i)} y={H - padB + 16} textAnchor="middle" className="fill-slate-600" fontSize="10.5" fontWeight="600">
            {p.label}
          </text>
        ))}
        <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" className="fill-slate-400" fontSize="10">Measurement point</text>
        <text x={13} y={padT + plotH / 2} textAnchor="middle" className="fill-slate-400" fontSize="10.5" transform={`rotate(-90 13 ${padT + plotH / 2})`}>Error (%)</text>
      </svg>

      {/* legend */}
      <div className="mt-2 flex items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.25)', border: '1px solid #10b981' }} /> Pass (U bar clears the limit)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(245,158,11,0.25)', border: '1px solid #f59e0b' }} /> Borderline (U bar touches limit)</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 h-0.5 bg-rose-500" style={{ borderTop: '2px dashed' }} /> ±{tol}% tolerance limit</span>
      </div>
    </div>
  )
}

function UncertaintyRiskDetails({ data }: { data: UncertaintyRiskData }) {
  if (!data.dataQuality.enoughHistory) {
    return (
      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="font-medium text-amber-700 mb-1">📊 Insufficient data</div>
        <p>{data.dataQuality.historyLength} record(s) — uncertainty risk analysis needs at least 2 records.</p>
      </div>
    )
  }

  if (!data.summary.hasGuardBandData) {
    return (
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="font-medium text-slate-600 mb-1">ℹ️ No guard band data</div>
        <p>The certificates carry no uncertainty information, so quantitative risk assessment is not possible. Request uncertainty reporting at the next calibration.</p>
      </div>
    )
  }

  const total = data.overall.total

  return (
    <div className="space-y-5">
      {/* ★ 발표 핵심 그림 — 가드밴드 개념도(맨 위 주인공) */}
      <div>
        <SubsectionHeader
          icon="🛡️"
          title="Guard band at a glance"
          subtitle="Measured error ± uncertainty (U) vs the tolerance limit — ILAC G-8"
        />
        <GuardBandConceptChart points={data.points} />
      </div>
      {/* 보조 요약: 시그널 카드 + 누적 분포 */}
      <SignalsSection data={data} />
      <GuardBandDistributionSection data={data} total={total} />
    </div>
  )
}

function SubsectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-base">{icon}</span>
      <div>
        <h4 className="text-xs font-bold text-slate-700">{title}</h4>
        <p className="text-[10px] text-slate-400">{subtitle}</p>
      </div>
    </div>
  )
}

function SignalsSection({ data }: { data: UncertaintyRiskData }) {
  const utValue = data.summary.maxUtRatioOverall
  const utTone: SignalTone =
    utValue == null ? 'slate' :
    utValue > 50 ? 'rose' :
    utValue > 33 ? 'amber' :
    'emerald'
  const utJudgment =
    utValue == null ? 'No data' :
    utValue > 50 ? 'Check system' :
    utValue > 33 ? 'High' :
    utValue > 25 ? 'Typical' :
    'Good'

  const dangerCount = data.summary.pointsWithRecentDanger
  const dangerTone: SignalTone = dangerCount > 0 ? 'rose' : 'emerald'
  const dangerJudgment = dangerCount > 0 ? `${dangerCount} point(s) at risk` : 'Good'

  const cpRatio = data.summary.conditionalPassRatio
  const cpTone: SignalTone =
    cpRatio >= 30 ? 'rose' :
    cpRatio > 0 ? 'amber' :
    'emerald'
  const cpJudgment =
    cpRatio >= 30 ? 'High' :
    cpRatio > 0 ? 'Some borderline' :
    'None'

  return (
    <div>
      <SubsectionHeader icon="🛡️" title="Risk signals" subtitle="Measurement uncertainty state of this instrument" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <SignalCard
          label="Max latest U/T"
          value={utValue != null ? `${utValue.toFixed(1)}%` : '—'}
          judgment={utJudgment}
          tone={utTone}
          hint="Uncertainty vs tolerance"
        />
        <SignalCard
          label="Recent risk verdicts"
          value={`${dangerCount}`}
          unit="pts"
          judgment={dangerJudgment}
          tone={dangerTone}
          hint="Conditional-fail / non-conformant"
        />
        <SignalCard
          label="Borderline ratio"
          value={`${cpRatio.toFixed(1)}%`}
          judgment={cpJudgment}
          tone={cpTone}
          hint="May exceed once uncertainty is considered"
        />
      </div>
    </div>
  )
}

type SignalTone = 'rose' | 'amber' | 'emerald' | 'slate'

function SignalCard({
  label,
  value,
  unit,
  judgment,
  tone,
  hint,
}: {
  label: string
  value: string
  unit?: string
  judgment: string
  tone: SignalTone
  hint: string
}) {
  const styles =
    tone === 'rose'
      ? { card: 'bg-gradient-to-br from-rose-50 to-white border-rose-200', label: 'text-rose-700', value: 'text-rose-700', badge: 'bg-rose-100 text-rose-700', icon: '❌' }
      : tone === 'amber'
      ? { card: 'bg-gradient-to-br from-amber-50 to-white border-amber-200', label: 'text-amber-700', value: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', icon: '⚠' }
      : tone === 'emerald'
      ? { card: 'bg-gradient-to-br from-emerald-50 to-white border-emerald-200', label: 'text-emerald-700', value: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700', icon: '✓' }
      : { card: 'bg-slate-50 border-slate-200', label: 'text-slate-500', value: 'text-slate-500', badge: 'bg-slate-100 text-slate-500', icon: '—' }

  return (
    <div className={`border rounded-xl p-3 ${styles.card}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${styles.label}`}>{label}</div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className={`text-2xl font-bold ${styles.value}`}>{value}</span>
        {unit && <span className="text-xs text-slate-500 font-medium">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${styles.badge}`}>
          <span className="mr-0.5">{styles.icon}</span>
          {judgment}
        </span>
      </div>
      <p className="text-[10px] text-slate-400 leading-tight">{hint}</p>
    </div>
  )
}

function GuardBandDistributionSection({ data, total }: { data: UncertaintyRiskData; total: number }) {
  const rows: { color: string; label: string; count: number; tone: 'safe' | 'warn' | 'danger' | 'neutral' }[] = [
    { color: 'bg-emerald-400', label: 'Conformant', count: data.overall.conformant, tone: 'safe' },
    { color: 'bg-amber-300',   label: 'Cond. pass', count: data.overall.conditionalPass, tone: 'warn' },
    { color: 'bg-rose-400',    label: 'Cond. fail', count: data.overall.conditionalFail, tone: 'danger' },
    { color: 'bg-rose-700',    label: 'Non-conf.', count: data.overall.nonConformant, tone: 'danger' },
    { color: 'bg-slate-300',   label: 'Unknown',    count: data.overall.unknown, tone: 'neutral' },
  ]

  const visibleRows = rows.filter(r => r.count > 0).sort((a, b) => b.count - a.count)

  return (
    <div>
      <SubsectionHeader
        icon="📊"
        title="Guard band distribution"
        subtitle={`All ${total} measurement(s) — 4-level verdict per ILAC G-8`}
      />
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="space-y-2">
          {visibleRows.map(row => {
            const pct = total > 0 ? (row.count / total) * 100 : 0
            const labelColor =
              row.tone === 'safe' ? 'text-emerald-700' :
              row.tone === 'warn' ? 'text-amber-700' :
              row.tone === 'danger' ? 'text-rose-700' :
              'text-slate-500'
            return (
              <div key={row.label} className="flex items-center gap-2 text-[11px]">
                <span className={`w-20 font-semibold shrink-0 ${labelColor}`}>{row.label}</span>
                <div className="flex-1 relative h-5 bg-slate-50 rounded">
                  <div
                    className={`absolute top-0 bottom-0 left-0 rounded ${row.color} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2">
                    <span className={`text-[10px] font-bold ${pct > 25 ? 'text-white' : 'text-slate-700'}`} style={{ textShadow: pct > 25 ? '0 0 2px rgba(0,0,0,0.3)' : 'none' }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <span className="text-slate-500 w-12 text-right shrink-0 font-semibold">{row.count}×</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span>{label}</span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────
// Step 4 detail (Peer Benchmark) — NEW
// ─────────────────────────────────────────────────────────────────

// Reference-only chart: how the similar-instrument fleet errs at each torque
// point, vs how THIS unit errs. The fleet does NOT change the recommended cycle
// (that's decided by this unit's own drift/uncertainty) — it's context only:
// "the fleet behaves like this band; this unit sits here."
//
//   X axis = torque (N·m), Y axis = error (%)
//   - shaded band  : fleet min..max error (after IQR outlier removal)
//   - dashed lines : ± tolerance limit (conformance boundary)
//   - solid line   : this instrument's latest error per point
function PeerErrorChart({
  bands,
  position,
}: {
  bands: PeerErrorBandData
  position: 'faster' | 'slower' | 'average'
}) {
  const pts = bands.points
  if (!bands.available || pts.length === 0) {
    return (
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
        No similar-instrument data matched for this model.
      </div>
    )
  }

  // ── geometry ──
  const W = 560, H = 240
  const padL = 44, padR = 16, padT = 16, padB = 34
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const torques = pts.map(p => p.torque)
  const xMin = Math.min(...torques)
  const xMax = Math.max(...torques)
  const xSpan = xMax - xMin || 1

  // Y range: cover fleet band, this unit, and the tolerance lines, with margin.
  const tol = Math.max(...pts.map(p => p.tolerance))
  const yCandidates = [
    tol, -tol,
    ...pts.map(p => p.fleetMax),
    ...pts.map(p => p.fleetMin),
    ...pts.map(p => p.thisError).filter((v): v is number => v != null),
  ]
  const yMaxRaw = Math.max(...yCandidates)
  const yMinRaw = Math.min(...yCandidates)
  const yPad = (yMaxRaw - yMinRaw) * 0.12 || 1
  const yMax = yMaxRaw + yPad
  const yMin = yMinRaw - yPad
  const ySpan = yMax - yMin || 1

  const sx = (t: number) => padL + ((t - xMin) / xSpan) * plotW
  const sy = (e: number) => padT + (1 - (e - yMin) / ySpan) * plotH

  // fleet band as a closed polygon (top = fleetMax left→right, bottom = fleetMin right→left)
  const bandTop = pts.map(p => `${sx(p.torque).toFixed(1)},${sy(p.fleetMax).toFixed(1)}`)
  const bandBot = [...pts].reverse().map(p => `${sx(p.torque).toFixed(1)},${sy(p.fleetMin).toFixed(1)}`)
  const bandPoly = [...bandTop, ...bandBot].join(' ')

  const medianLine = pts.map(p => `${sx(p.torque).toFixed(1)},${sy(p.fleetMedian).toFixed(1)}`).join(' ')
  const thisPts = pts.filter(p => p.thisError != null)
  const thisLine = thisPts.map(p => `${sx(p.torque).toFixed(1)},${sy(p.thisError as number).toFixed(1)}`).join(' ')

  const yZero = sy(0)
  const yTolPos = sy(tol)
  const yTolNeg = sy(-tol)

  // sparse x labels (avoid crowding): show ~5 ticks
  const labelEvery = Math.max(1, Math.ceil(pts.length / 5))

  const outCount = pts.filter(p => p.outOfRange === 'above' || p.outOfRange === 'below').length
  const positionNote =
    position === 'faster' ? 'This unit drifts harder than the typical peer'
    : position === 'slower' ? 'This unit is steadier than the typical peer'
    : 'This unit tracks the fleet centre'

  return (
    <div className="space-y-3">
      <SubsectionHeader
        icon="🛰️"
        title={`THIS instrument (blue line) vs ${bands.totalPeerCount.toLocaleString()} similar instruments (grey cloud)`}
        subtitle={`${bands.groupKey} — same make/model field fleet (reference only — does not change the cycle)`}
      />

      {/* Big-data scale bar — what the fleet band is built from */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <PeerStat label="Peer units" value={bands.totalPeerCount.toLocaleString()} />
        <PeerStat label="Certificates" value={bands.totalCertCount.toLocaleString()} />
        <PeerStat label="Measurements" value={bands.totalMeasurements.toLocaleString()} />
        <PeerStat label="Data span" value={`${bands.yearSpan} yr`} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block" preserveAspectRatio="xMidYMid meet">
          {/* y grid: zero + tolerance lines */}
          <line x1={padL} y1={yZero} x2={W - padR} y2={yZero} stroke="#cbd5e1" strokeWidth="1" />
          <line x1={padL} y1={yTolPos} x2={W - padR} y2={yTolPos} stroke="#f43f5e" strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />
          <line x1={padL} y1={yTolNeg} x2={W - padR} y2={yTolNeg} stroke="#f43f5e" strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />
          <text x={W - padR} y={yTolPos - 3} textAnchor="end" className="fill-rose-500" fontSize="9">+{tol}% tolerance</text>
          <text x={W - padR} y={yTolNeg + 11} textAnchor="end" className="fill-rose-500" fontSize="9">−{tol}% tolerance</text>

          {/* y axis ticks (zero + tol values) */}
          <text x={padL - 6} y={yZero + 3} textAnchor="end" className="fill-slate-400" fontSize="9">0%</text>

          {/* fleet band */}
          <polygon points={bandPoly} fill="#94a3b8" fillOpacity="0.18" stroke="#94a3b8" strokeWidth="0.75" strokeOpacity="0.5" />
          {/* fleet scatter — individual peer measurements (the band is built from these) */}
          {pts.map((p, pi) =>
            p.scatter.map((e, si) => {
              // 토크 축 위 약간의 jitter (점이 한 줄에 겹치지 않게) — 결정적
              const jitter = ((si % 5) - 2) * (plotW / pts.length) * 0.045
              return (
                <circle
                  key={`sc-${pi}-${si}`}
                  cx={sx(p.torque) + jitter}
                  cy={sy(e)}
                  r="1.4"
                  fill="#94a3b8"
                  fillOpacity="0.38"
                />
              )
            }),
          )}
          {/* fleet median */}
          <polyline points={medianLine} fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.8" />

          {/* in-chart label: this grey cloud IS the similar-instrument fleet (A) */}
          {(() => {
            // 띠 하단부(fleetMin 근처)·왼쪽~중앙에 배치 — 산점/선과 겹치지 않게
            const anchorPt = pts[Math.min(1, pts.length - 1)]
            const lx = sx(anchorPt.torque) + 6
            const ly = sy(anchorPt.fleetMin) + 13
            return (
              <g>
                <text x={lx} y={ly} textAnchor="start" fontSize="9.5" fontWeight="600" fontStyle="italic" stroke="#fff" strokeWidth="3" strokeLinejoin="round" opacity="0.9">
                  Similar instruments (fleet range)
                </text>
                <text x={lx} y={ly} textAnchor="start" className="fill-slate-400" fontSize="9.5" fontWeight="600" fontStyle="italic">
                  Similar instruments (fleet range)
                </text>
              </g>
            )
          })()}

          {/* this instrument line */}
          {thisPts.length >= 2 && (
            <polyline points={thisLine} fill="none" stroke="#2563eb" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* in-chart label: the blue line IS this instrument (A) */}
          {thisPts.length >= 2 && (() => {
            // 중간 안정 구간(이탈 라벨이 없는 점)의 선 위에 파란 라벨
            const mid = thisPts[Math.floor(thisPts.length / 2)]
            if (mid.thisError == null) return null
            const lx = sx(mid.torque)
            const ly = sy(mid.thisError) - 11
            return (
              <g>
                <text x={lx} y={ly} textAnchor="middle" fontSize="10" fontWeight="800" stroke="#fff" strokeWidth="3.5" strokeLinejoin="round" opacity="0.9">
                  THIS unit
                </text>
                <text x={lx} y={ly} textAnchor="middle" className="fill-blue-600" fontSize="10" fontWeight="800">
                  THIS unit
                </text>
              </g>
            )
          })()}
          {/* deviation markers — where this unit breaks out of the fleet band (A) */}
          {pts.map((p, i) => {
            if (p.thisError == null) return null
            const out = p.outOfRange === 'above' || p.outOfRange === 'below'
            if (!out) return null
            const cx = sx(p.torque)
            const boundary = p.outOfRange === 'above' ? p.fleetMax : p.fleetMin
            const cyThis = sy(p.thisError)
            const cyEdge = sy(boundary)
            const delta = Math.round(Math.abs(p.thisError - boundary) * 10) / 10
            // 라벨은 점 바깥쪽으로 충분히 띄움(틱·점선·점과 분리). above=위로, below=아래로.
            const labelY = p.outOfRange === 'above' ? cyThis - 16 : cyThis + 22
            // 라벨이 차트 좌/우 경계를 넘지 않게 anchor·x 보정
            const nearRight = cx > W - padR - 70
            const nearLeft = cx < padL + 70
            const anchor = nearRight ? 'end' : nearLeft ? 'start' : 'middle'
            const labelX = nearRight ? cx + 5 : nearLeft ? cx - 5 : cx
            return (
              <g key={`dev-${i}`}>
                {/* shaded breakout span: from fleet boundary to this-unit point */}
                <line x1={cx} y1={cyThis} x2={cx} y2={cyEdge} stroke="#f43f5e" strokeWidth="2.5" opacity="0.25" strokeLinecap="round" />
                <line x1={cx} y1={cyThis} x2={cx} y2={cyEdge} stroke="#f43f5e" strokeWidth="1" strokeDasharray="2 2" opacity="0.9" />
                {/* tick at the fleet boundary (where the fleet stops) */}
                <line x1={cx - 5} y1={cyEdge} x2={cx + 5} y2={cyEdge} stroke="#f43f5e" strokeWidth="1.4" />
                {/* white halo behind the label so it stays readable over the scatter/line */}
                <text x={labelX} y={labelY} textAnchor={anchor} fontSize="9" fontWeight="700" stroke="#fff" strokeWidth="3" strokeLinejoin="round" opacity="0.9">
                  +{delta}%p over fleet
                </text>
                <text x={labelX} y={labelY} textAnchor={anchor} className="fill-rose-600" fontSize="9" fontWeight="700">
                  +{delta}%p over fleet
                </text>
              </g>
            )
          })}
          {/* this instrument points */}
          {pts.map((p, i) => {
            if (p.thisError == null) return null
            const cx = sx(p.torque), cy = sy(p.thisError)
            const out = p.outOfRange === 'above' || p.outOfRange === 'below'
            const posWord = p.outOfRange === 'above' ? 'above' : p.outOfRange === 'below' ? 'below' : 'within'
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={out ? 4.5 : 3} fill={out ? '#f43f5e' : '#2563eb'} stroke="#fff" strokeWidth="1.2">
                  <title>{`${p.label}\nThis unit: ${p.thisError}% (${posWord} fleet band)\nFleet: ${p.fleetMin}% … ${p.fleetMax}% (median ${p.fleetMedian}%)\nBuilt from ${p.peerSampleCount} normal units · ${p.outlierCount} outlier(s) IQR-trimmed`}</title>
                </circle>
              </g>
            )
          })}

          {/* x axis */}
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#e2e8f0" strokeWidth="1" />
          {pts.map((p, i) => {
            if (i % labelEvery !== 0 && i !== pts.length - 1) return null
            const x = sx(p.torque)
            return (
              <g key={`xl-${i}`}>
                <line x1={x} y1={H - padB} x2={x} y2={H - padB + 3} stroke="#cbd5e1" strokeWidth="1" />
                <text x={x} y={H - padB + 14} textAnchor="middle" className="fill-slate-500" fontSize="9">{p.torque}</text>
              </g>
            )
          })}
          <text x={(padL + W - padR) / 2} y={H - 2} textAnchor="middle" className="fill-slate-400" fontSize="9">Torque ({bands.unit})</text>
          {/* y axis title */}
          <text x={12} y={padT + plotH / 2} textAnchor="middle" className="fill-slate-400" fontSize="9" transform={`rotate(-90 12 ${padT + plotH / 2})`}>Error (%)</text>
        </svg>

        {/* legend */}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-600" /> This instrument</span>
          <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-400/50" /> Fleet measurements</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-slate-400/20 border border-slate-300" /> Fleet range (IQR-trimmed)</span>
          <LegendDot color="bg-slate-400" label="Fleet median" />
          <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-rose-400" style={{ borderTop: '1px dashed' }} /> ± tolerance</span>
        </div>
      </div>

      {/* one-line read of the picture */}
      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
        <span className="font-medium text-slate-600">{positionNote}.</span>{' '}
        {outCount > 0
          ? <>At <span className="font-semibold text-rose-600">{outCount} point(s)</span> this unit sits outside the normal fleet error band — its own signature, not a fleet trait.</>
          : <>This unit stays within the normal fleet error band at every point.</>}
        {' '}The fleet is shown for context; the cycle is set by this unit&apos;s own drift and uncertainty.
      </div>
    </div>
  )
}

function PeerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-lg px-3 py-2">
      <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-lg font-bold text-slate-700 leading-none tabular-nums">{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Interim Check Simulation view (Future Work) — NEW
// ─────────────────────────────────────────────────────────────────

function InterimSimulationView({
  sim,
  series,
  baseMonths,
  manufacturer,
  model,
}: {
  sim: InterimSimComparison
  series: TrendSeries[]
  baseMonths: number
  manufacturer: string
  model: string
}) {
  const s = sim.simulation.summary

  // 측정점별 오버레이(정식+키오스크) 계산 — 양방향 결론 카드용 대표 케이스 추출.
  //   (라이브 차트는 Step2 차트의 토글로 옮겨감. 여기는 '왜 필요한가' 결론만.)
  const overlays = useMemo(() => {
    return series
      .map(ser => buildInterimForecastOverlay(ser, baseMonths, { manufacturer, model }))
      .filter(o => o.available)
  }, [series, baseMonths, manufacturer, model])

  // 양방향 대표: 가장 일찍 잡는 드리프트점 / 여유가 가장 큰 안정점
  const driftRep = useMemo(() =>
    [...overlays].filter(o => o.caseKind === 'drifting')
      .sort((a, b) => (b.earlyDetectionMonths ?? 0) - (a.earlyDetectionMonths ?? 0))[0] ?? null, [overlays])
  const stableRep = useMemo(() =>
    [...overlays].filter(o => o.caseKind === 'stable' && o.marginAtBaseEnd != null)
      .sort((a, b) => (b.marginAtBaseEnd ?? 0) - (a.marginAtBaseEnd ?? 0))[0] ?? null, [overlays])
  const repU = driftRep ?? stableRep ?? overlays[0] ?? null

  if (overlays.length === 0) {
    return (
      <div className="bg-purple-50/40 border border-dashed border-purple-200 rounded-xl p-5 text-xs text-slate-500">
        Not enough calibration history to simulate interim checks.
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-purple-50/60 via-white to-white border-2 border-purple-200 rounded-2xl overflow-hidden">
      {/* Headline metrics */}
      <div className="px-5 pt-5 pb-4">
        <div className="text-[10px] text-purple-600/70 font-bold uppercase tracking-widest mb-2">If interim check data flows in…</div>
        <div className="grid grid-cols-3 gap-2">
          <SimMetric label="Interim checks added" value={`${s.totalInterimChecks}`} sub={`over ${s.monthsSpan} mo, all points`} tone="purple" />
          <SimMetric label="Earliest drift caught" value={driftRep?.earlyDetectionMonths != null ? `${driftRep.earlyDetectionMonths}` : '—'} sub="months earlier" tone="purple" big />
          <SimMetric label="Kiosk uncertainty" value={repU ? `~${repU.interimU}%` : '—'} sub={repU ? `vs formal ±${repU.formalU}%` : ''} tone="slate" textValue />
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          See the live overlay on the <span className="font-semibold text-purple-600">Step 2 chart</span> — toggle
          {' '}&ldquo;+ Interim kiosk checks&rdquo; to fold these points in and watch the forecast update.
        </p>
      </div>

      {/* Bidirectional conclusion — why interim checks are worth it (both ways) */}
      <div className="border-t border-purple-100 px-5 py-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2.5">Why interim checks pay off — both directions</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* ① drift → catch early → recalibrate sooner */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-rose-500">▲</span>
              <span className="text-xs font-bold text-rose-700">When drift appears → catch it early</span>
            </div>
            {driftRep ? (
              <p className="text-[11px] text-slate-600 leading-relaxed">
                At <span className="font-bold text-slate-800">{driftRep.label}</span>, formal calibration would only reveal the
                drift at the next due date (<span className="font-semibold">{driftRep.formal.crossMonths} mo</span>).
                Interim checks expose the same trend at <span className="font-bold text-rose-700">~{driftRep.interim.crossMonths} mo</span> —
                <span className="font-bold text-rose-700"> {driftRep.earlyDetectionMonths} months earlier</span>.
                Recalibrating sooner cuts equipment-induced rework / production error.
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">No drifting point in this dataset — all points stay stable through the term.</p>
            )}
          </div>
          {/* ② stable → confirm → safely extend the interval */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-emerald-500">▼</span>
              <span className="text-xs font-bold text-emerald-700">When it stays stable → extend the interval</span>
            </div>
            {stableRep ? (
              <p className="text-[11px] text-slate-600 leading-relaxed">
                At <span className="font-bold text-slate-800">{stableRep.label}</span>, interim checks keep confirming
                <span className="font-semibold"> {stableRep.marginAtBaseEnd}% of headroom</span> to the limit even at the end of the
                {' '}{baseMonths}-month term. That evidence justifies <span className="font-bold text-emerald-700">extending the cycle</span> —
                fewer unnecessary calibrations, less downtime and cost.
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">No clearly-stable point with spare headroom in this dataset.</p>
            )}
          </div>
        </div>
        <p className="mt-2.5 text-[11px] text-purple-700 font-medium text-center">
          ∴ Interim checks are worth it both ways — catch drift sooner, and stop over-calibrating stable points.
        </p>
      </div>

      {/* Footnote */}
      <div className="px-5 py-3 bg-purple-50/50 border-t border-purple-100">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          <span className="text-purple-500 mr-1">🔮</span>
          The kiosk trades accuracy for convenience — low-precision (large U) but high-frequency. We don&apos;t need
          exact numbers between calibrations; the dense points let the <span className="font-semibold text-purple-700">trend line</span> answer
          one question early: <span className="italic">&ldquo;is this tool still good to use?&rdquo;</span>
        </p>
      </div>
    </div>
  )
}

function SimMetric({
  label,
  value,
  sub,
  tone,
  big,
  textValue,
}: {
  label: string
  value: string
  sub: string
  tone: 'purple' | 'emerald' | 'rose' | 'slate'
  big?: boolean
  textValue?: boolean
}) {
  const valueColor =
    tone === 'purple' ? 'text-purple-700' :
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'rose' ? 'text-rose-700' :
    'text-slate-700'
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
      <div className="text-[9px] text-slate-400 uppercase tracking-wide mb-1 leading-tight">{label}</div>
      <div className={`font-bold ${valueColor} ${big ? 'text-2xl' : textValue ? 'text-sm' : 'text-xl'}`}>{value}</div>
      <div className="text-[9px] text-slate-400 mt-0.5">{sub}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Final step detail (Breakdown)
// ─────────────────────────────────────────────────────────────────

function FinalBreakdown({ analysis }: { analysis: CycleAnalysisResult }) {
  const final = analysis.step5.data
  const base = final.breakdown.base
  const cb = final.crossingBased
  const shorten = final.direction === 'shorten'
  const extend = final.direction === 'extend'
  // 결론 색조: 단축=빨강(위험)/연장=초록/유지=파랑
  const tone = shorten
    ? { ring: 'border-rose-300 bg-rose-50/60', dot: 'bg-rose-500', head: 'text-rose-700', pill: 'bg-rose-600' }
    : extend
    ? { ring: 'border-emerald-300 bg-emerald-50/60', dot: 'bg-emerald-500', head: 'text-emerald-700', pill: 'bg-emerald-600' }
    : { ring: 'border-blue-300 bg-blue-50/60', dot: 'bg-blue-500', head: 'text-blue-700', pill: 'bg-blue-600' }

  // crossing 근거가 있을 때(단축) 서술이 가장 풍부. 그 외엔 방향만 서술.
  const crossingDriven = cb.drivenBy != null && cb.earliestCrossMonths != null

  return (
    <div className="space-y-3">
      {/* ── 결론 서술 (the reasoning, in words) ── */}
      <div className={`rounded-lg border p-3 ${tone.ring}`}>
        <div className="flex items-start gap-2">
          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${tone.dot}`} />
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-bold ${tone.head}`}>
              {shorten ? `Shorten to ${final.finalMonths} months` :
               extend ? `Extend to ${final.finalMonths} months` :
               `Maintain the ${final.finalMonths}-month interval`}
              <span className="text-slate-400 font-medium text-xs">
                {' '}({formatSigned(final.finalMonths - base)} mo vs the {base}-mo baseline)
              </span>
            </div>
            {crossingDriven ? (
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                Driven by <span className="font-bold text-slate-800">{cb.drivenBy}</span> — its error
                (incl. uncertainty) reaches the tolerance limit at
                <span className="font-bold text-slate-800"> ~{cb.earliestCrossMonths} mo</span>.
                Subtracting a <span className="font-semibold">{cb.safetyMarginMonths}-mo</span> safety margin
                gives the recommended <span className="font-bold text-slate-800">{final.finalMonths}-mo</span> interval.
              </p>
            ) : (
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                {extend
                  ? `Drift, uncertainty and peer-fleet context all stay well within limits through the ${base}-month term — the interval can be reviewed for extension.`
                  : `Drift and uncertainty stay within limits across the ${base}-month term — the standard interval is adequate.`}
              </p>
            )}
          </div>
          {/* 결론 수치 pill */}
          <div className={`shrink-0 text-white rounded-lg px-3 py-1.5 text-center ${tone.pill}`}>
            <div className="text-[9px] uppercase tracking-wide opacity-80 leading-none">Recommended</div>
            <div className="text-lg font-bold leading-tight">{final.finalMonths}<span className="text-[10px] font-medium ml-0.5">mo</span></div>
          </div>
        </div>
      </div>

      {/* ── 공식 (the math, as supporting evidence) ── */}
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">How the number is built</div>
        <div className="flex items-center flex-wrap gap-2 text-xs">
          <BreakdownBox label="Base" value={`${final.breakdown.base}`} primary />
          <span className="text-slate-400">+</span>
          <BreakdownBox label="Step 2" value={`${formatSigned(final.breakdown.trendAdj)}`} />
          <span className="text-slate-400">+</span>
          <BreakdownBox label="Step 3" value={`${formatSigned(final.breakdown.riskAdj)}`} />
          <span className="text-slate-400">+</span>
          <BreakdownBox label="Step 4" value={`${formatSigned(final.breakdown.contextAdj)}`} />
          <span className="text-slate-400">=</span>
          <BreakdownBox label="Result" value={`${final.finalMonths} mo`} highlight />
        </div>
        {crossingDriven && (
          <p className="mt-2 text-[10px] text-slate-400">
            Note: when a measurement point crosses the limit within the baseline, the crossing date (− safety margin) governs the result.
          </p>
        )}
        {final.guardrail.clamped && (
          <p className="mt-2 text-[11px] text-amber-600">
            Raw sum {final.breakdown.sum} mo → guardrail ({final.guardrail.minMonths}–{final.guardrail.maxMonths} mo) → {final.finalMonths} mo
          </p>
        )}
      </div>
    </div>
  )
}

function formatSigned(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

// ─────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────

function MetricBox({
  label,
  value,
  unit,
  primary,
  textValue,
  muted,
  footnote,
}: {
  label: string
  value: string
  unit: string
  primary?: boolean
  textValue?: boolean
  muted?: boolean
  footnote?: string | null
}) {
  return (
    <div className={`px-3 py-2.5 rounded-lg border ${
      primary ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'
    }`}>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`flex items-baseline gap-0.5 ${muted ? 'text-slate-400' : ''}`}>
        <span className={`${
          textValue ? 'text-xs font-semibold' : 'text-xl font-bold'
        } ${primary ? 'text-blue-700' : 'text-slate-700'} ${muted ? 'text-slate-400 font-medium' : ''}`}>
          {value}
        </span>
        {unit && <span className="text-[10px] text-slate-400 font-medium">{unit}</span>}
      </div>
      {footnote && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-blue-600/80 font-medium">
          <span className="text-blue-400">└</span>{footnote}
        </div>
      )}
    </div>
  )
}

// 근거 표준 줄 — 적용 표준 중 주기 결정 근거인 KOLAS 가이드를 우선 표시.
//   (없으면 첫 표준. 그래도 없으면 null → 줄 미표시.)
function baselineBasisStandard(standards: string[]): string | null {
  if (!standards || standards.length === 0) return null
  const kolas = standards.find(s => /KOLAS/i.test(s))
  return `per ${kolas ?? standards[0]}`
}

function DataPair({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${positive ? 'text-slate-700' : 'text-slate-400'}`}>
        {value}
      </span>
    </div>
  )
}

function CalcChip({
  label,
  value,
  primary,
  tone = 'slate',
}: {
  label: string
  value: string
  primary?: boolean
  tone?: 'slate' | 'rose' | 'emerald'
}) {
  const cls = primary
    ? 'bg-blue-600 text-white border-blue-600'
    : tone === 'rose'
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-700 border-slate-200'
  return (
    <div className={`inline-flex flex-col items-center px-3 py-1.5 border rounded-lg ${cls}`}>
      <span className="text-[9px] uppercase tracking-wide opacity-70 leading-none mb-0.5">{label}</span>
      <span className="text-sm font-bold leading-none">{value}</span>
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  subtitle,
  muted,
}: {
  icon: 'decision' | 'evidence' | 'ai'
  title: string
  subtitle?: string
  muted?: boolean
}) {
  const iconPath =
    icon === 'decision' ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' :
    icon === 'evidence' ? 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' :
    'M13 10V3L4 14h7v7l9-11h-7z'
  const colorClass =
    muted ? 'text-slate-400' :
    icon === 'decision' ? 'text-blue-600' :
    icon === 'evidence' ? 'text-slate-700' :
    'text-purple-600'

  return (
    <div className="flex items-center gap-2 mb-3">
      <svg className={`w-5 h-5 ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
      </svg>
      <div>
        <h3 className={`text-sm font-bold ${muted ? 'text-slate-500' : 'text-slate-800'}`}>{title}</h3>
        {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// One-line English signals for the collapsed step rows (presentation)
// ─────────────────────────────────────────────────────────────────

function signalBaseline(d: BaselineData): string {
  const src = baselineSourceLabel(d.source).toLowerCase()
  const std = d.profileStandards.length > 0 ? ` · ${d.profileStandards[0]}` : ''
  return `${d.baseMonths} mo from ${src}${std}`
}

function signalDrift(d: TrendDriftData): string {
  if (!d.dataQuality.enoughHistory) return 'Not enough history for trend analysis'
  const u = d.summary.urgentPointCount
  const w = d.summary.watchPointCount
  // worst point name + its latest usage
  const worst = [...d.points].sort((a, b) => (b.latestRatio ?? 0) - (a.latestRatio ?? 0))[0]
  if (u > 0 && worst) {
    return `${worst.label} approaching limit (${worst.latestRatio?.toFixed(0)}%) · ${u} urgent, ${w} watch`
  }
  if (w > 0) return `${w} point(s) on watch · max usage ${d.summary.maxLatestRatio?.toFixed(0)}%`
  return `All points stable · max usage ${d.summary.maxLatestRatio?.toFixed(0) ?? '—'}%`
}

function signalUncertainty(d: UncertaintyRiskData): string {
  if (!d.summary.hasGuardBandData) return 'No uncertainty data in certificates'
  const ut = d.summary.maxUtRatioOverall
  const utStr = ut != null ? `max U/T ${ut.toFixed(0)}%` : 'U/T n/a'
  if (d.summary.pointsWithRecentDanger > 0) return `${d.summary.pointsWithRecentDanger} point(s) at risk · ${utStr}`
  if (d.summary.conditionalPassRatio >= 30) return `Borderline ${d.summary.conditionalPassRatio.toFixed(0)}% · ${utStr}`
  return `Guard band stable · ${utStr}`
}

function signalPeer(d: PeerBenchmarkStepData): string {
  const pos = d.position === 'faster' ? 'faster than fleet' : d.position === 'slower' ? 'more stable than fleet' : 'around fleet average'
  const pct = d.avgPercentile != null ? `${d.avgPercentile.toFixed(0)}th %ile` : ''
  return `${d.totalPeerCount} peers · ${pct} · ${pos}`
}

function signalFinal(a: CycleAnalysisResult): string {
  const f = a.step5.data
  if (f.direction === 'shorten') return `Shorten ${f.breakdown.base} → ${f.finalMonths} months`
  if (f.direction === 'extend') return `Extend ${f.breakdown.base} → ${f.finalMonths} months`
  return `Maintain ${f.finalMonths} months`
}

function BreakdownBox({ label, value, highlight, primary }: { label: string; value: string; highlight?: boolean; primary?: boolean }) {
  const cls = highlight
    ? 'bg-blue-600 text-white border-blue-600'
    : primary
    ? 'bg-slate-100 text-slate-700 border-slate-200'
    : 'bg-white text-slate-600 border-slate-200'
  return (
    <div className={`inline-flex flex-col items-center px-2.5 py-1 border rounded ${cls}`}>
      <span className="text-[9px] uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-xs font-bold">{value}</span>
    </div>
  )
}
