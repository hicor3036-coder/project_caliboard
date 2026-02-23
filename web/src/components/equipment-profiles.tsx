'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import DataTable, { type Column } from './data-table'

// ─── 타입 ───

interface EquipmentProfile {
  manufacturer: string
  model: string
  category: string | null
  source: 'web_search' | 'manual_pdf' | 'manual_input'
  verified: boolean
  source_urls: string[]
  spec: {
    range: string | null
    accuracy: string | null
    resolution: string | null
    units: string[] | null
    overload_limit: string | null
  }
  environment: {
    operating_temp: string | null
    storage_temp: string | null
    operating_humidity: string | null
    ip_rating: string | null
    warmup_time: string | null
  }
  power: {
    type: string | null
    battery: string | null
    battery_life: string | null
    charge_time: string | null
  }
  interface: {
    output: string[] | null
    software: string | null
    wireless: string | null
    memory: string | null
  }
  calibration: {
    recommended_cycle: string | null
    self_calibration: boolean | null
    standards: string[] | null
    stability_spec: string | null
    drift_spec: string | null
  }
  maintenance: { cycle: string; task: string }[]
  cautions: string[]
  meta: {
    country: string | null
    discontinued: boolean | null
    successor_model: string | null
    alternatives: string[]
    approx_price: string | null
    support_url: string | null
    manual_url: string | null
  }
  updated_at: string
}

interface EquipmentItem {
  acptNo: string; entpPrdNm: string; prdnCmpnNm: string;
  stszNm: string; mctlNo: string; custEqpmSrno: string;
  rcpnYmd: string; pgstNm: string; mngmRsprNm: string;
  nxtrExrsYmd: string; exrsWrtnYmd: string; groupNm: string; groupCnt: number
}

interface UniqueModel {
  manufacturer: string
  model: string
  productName: string
  equipmentCount: number
  profile: EquipmentProfile | null
  status: 'collected' | 'uncollected'
}

type FilterStatus = 'all' | 'collected' | 'uncollected'

// ─── Props ───

interface Props {
  equipmentItems: EquipmentItem[] | null
}

// ─── 수집 상태 판단: 프로필이 있으면 수집완료, 없으면 미수집 ───

function getCollectionStatus(profile: EquipmentProfile | null): 'collected' | 'uncollected' {
  return profile ? 'collected' : 'uncollected'
}

// ─── 고유 모델 추출 ───

function extractUniqueModels(
  items: EquipmentItem[],
  profiles: EquipmentProfile[],
): UniqueModel[] {
  const profileMap = new Map<string, EquipmentProfile>()
  for (const p of profiles) {
    profileMap.set(`${p.manufacturer.toUpperCase()}|${p.model.toUpperCase()}`, p)
  }

  const modelMap = new Map<string, UniqueModel>()

  for (const item of items) {
    const manufacturer = (item.prdnCmpnNm || '').trim()
    const model = (item.stszNm || '').trim()
    if (!manufacturer && !model) continue

    const key = `${manufacturer.toUpperCase()}|${model.toUpperCase()}`
    const existing = modelMap.get(key)

    if (existing) {
      existing.equipmentCount++
    } else {
      const profile = profileMap.get(key) ?? null
      modelMap.set(key, {
        manufacturer,
        model,
        productName: item.entpPrdNm || '',
        equipmentCount: 1,
        profile,
        status: getCollectionStatus(profile),
      })
    }
  }

  // 프로필은 있지만 현재 장비 목록에 없는 경우도 포함
  for (const p of profiles) {
    const key = `${p.manufacturer.toUpperCase()}|${p.model.toUpperCase()}`
    if (!modelMap.has(key)) {
      modelMap.set(key, {
        manufacturer: p.manufacturer,
        model: p.model,
        productName: '',
        equipmentCount: 0,
        profile: p,
        status: getCollectionStatus(p),
      })
    }
  }

  return Array.from(modelMap.values()).sort((a, b) => {
    // 미수집 먼저, 그 다음 수집완료 (장비수 많은 순 → 제조사/모델 순)
    if (a.status !== b.status) return a.status === 'uncollected' ? -1 : 1
    if (b.equipmentCount !== a.equipmentCount) return b.equipmentCount - a.equipmentCount
    return a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model)
  })
}

// ─── 상태 뱃지 ───

function StatusBadge({ status }: { status: 'collected' | 'uncollected' }) {
  const config = {
    collected: { label: '수집완료', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    uncollected: { label: '미수집', bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-400' },
  }
  const c = config[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

// ─── 소스 뱃지 ───

function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { label: string; style: string }> = {
    web_search: { label: 'AI 수집', style: 'bg-blue-50 text-blue-600' },
    manual_pdf: { label: 'PDF 추출', style: 'bg-purple-50 text-purple-600' },
    manual_input: { label: '수동 입력', style: 'bg-slate-100 text-slate-600' },
  }
  const c = config[source] ?? config.manual_input
  return <span className={`text-xs px-1.5 py-0.5 rounded ${c.style}`}>{c.label}</span>
}

// ─── 테이블 컬럼 정의 ───

const tableColumns: Column<UniqueModel>[] = [
  {
    key: 'manufacturer', header: '제조사',
    sortValue: i => i.manufacturer,
    render: i => <span className="text-gray-800 font-medium">{i.manufacturer || '-'}</span>,
  },
  {
    key: 'model', header: '모델',
    sortValue: i => i.model,
    render: i => (
      <span className="text-gray-600 max-w-[180px] truncate block" title={i.model}>
        {i.model || '-'}
      </span>
    ),
  },
  {
    key: 'category', header: '유형',
    sortValue: i => i.profile?.category ?? '',
    render: i => (
      <span className="text-gray-500 max-w-[120px] truncate block" title={i.profile?.category ?? ''}>
        {i.profile?.category ?? '-'}
      </span>
    ),
  },
  {
    key: 'status', header: '수집상태', align: 'center',
    sortValue: i => i.status === 'collected' ? 1 : 0,
    render: i => <StatusBadge status={i.status} />,
  },
  {
    key: 'source', header: '출처', align: 'center',
    sortValue: i => i.profile?.source ?? '',
    render: i => i.profile ? <SourceBadge source={i.profile.source} /> : <span className="text-xs text-gray-300">-</span>,
  },
  {
    key: 'equipmentCount', header: '장비수', align: 'right',
    sortValue: i => i.equipmentCount,
    render: i => <span className="text-gray-500">{i.equipmentCount}</span>,
  },
]

// ─── 상세 모달 ───

function ProfileDetailModal({
  model,
  onClose,
  onSave,
}: {
  model: UniqueModel
  onClose: () => void
  onSave: (p: EquipmentProfile) => void
}) {
  const p = model.profile
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState<EquipmentProfile | null>(p)

  function handleSave() {
    if (editData) {
      onSave(editData)
      setEditMode(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 rounded-t-2xl flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {model.manufacturer} {model.model}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {p && <SourceBadge source={p.source} />}
              {p && !p.verified && <span className="text-xs text-amber-500">미검증</span>}
              {p?.verified && <span className="text-xs text-emerald-600">검증완료</span>}
              {model.equipmentCount > 0 && (
                <span className="text-xs text-slate-400">적용 장비 {model.equipmentCount}대</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4 space-y-5">
          {!p ? (
            <div className="text-center py-10 text-slate-400">
              <p className="text-sm">수집된 정보가 없습니다.</p>
            </div>
          ) : (
            <>
              {p.category && (
                <p className="text-sm text-slate-500">유형: <span className="text-slate-700 font-medium">{p.category}</span></p>
              )}

              <Section title="스펙" icon="📐">
                <Field label="측정 범위" value={p.spec.range} />
                <Field label="정확도" value={p.spec.accuracy} />
                <Field label="분해능" value={p.spec.resolution} />
                <Field label="단위" value={p.spec.units?.join(', ')} />
                <Field label="과부하 한계" value={p.spec.overload_limit} />
              </Section>

              <Section title="사용 환경" icon="🌡️">
                <Field label="사용 온도" value={p.environment.operating_temp} />
                <Field label="보관 온도" value={p.environment.storage_temp} />
                <Field label="사용 습도" value={p.environment.operating_humidity} />
                <Field label="방진방수" value={p.environment.ip_rating} />
                <Field label="안정화 시간" value={p.environment.warmup_time} />
              </Section>

              <Section title="전원" icon="🔋">
                <Field label="전원 유형" value={p.power.type} />
                <Field label="배터리" value={p.power.battery} />
                <Field label="배터리 수명" value={p.power.battery_life} />
                <Field label="충전 시간" value={p.power.charge_time} />
              </Section>

              <Section title="인터페이스" icon="🔌">
                <Field label="출력" value={p.interface.output?.join(', ')} />
                <Field label="소프트웨어" value={p.interface.software} />
                <Field label="무선" value={p.interface.wireless} />
                <Field label="메모리" value={p.interface.memory} />
              </Section>

              <Section title="교정" icon="📏">
                <Field label="권장 주기" value={p.calibration.recommended_cycle} />
                <Field label="자체 교정" value={p.calibration.self_calibration === true ? '가능' : p.calibration.self_calibration === false ? '불가' : null} />
                <Field label="관련 표준" value={p.calibration.standards?.join(', ')} />
                <Field label="안정도" value={p.calibration.stability_spec} />
                <Field label="드리프트" value={p.calibration.drift_spec} />
              </Section>

              {p.maintenance.length > 0 && (
                <Section title="유지보수" icon="🔧">
                  <div className="space-y-1">
                    {p.maintenance.map((m, i) => (
                      <p key={i} className="text-sm text-slate-600">
                        <span className="text-slate-400">{m.cycle}:</span> {m.task}
                      </p>
                    ))}
                  </div>
                </Section>
              )}

              {p.cautions.length > 0 && (
                <Section title="주의사항" icon="⚠️">
                  <ul className="list-disc list-inside space-y-1">
                    {p.cautions.map((c, i) => (
                      <li key={i} className="text-sm text-slate-600">{c}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="기타 정보" icon="ℹ️">
                <Field label="제조국" value={p.meta.country} />
                <Field label="단종 여부" value={p.meta.discontinued === true ? '단종' : p.meta.discontinued === false ? '판매 중' : null} />
                <Field label="후속 모델" value={p.meta.successor_model} />
                <Field label="대략 가격" value={p.meta.approx_price} />
              </Section>

              {p.source_urls.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">출처</p>
                  <div className="space-y-1">
                    {p.source_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-blue-500 hover:underline truncate"
                      >
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-300 text-right">수집일: {p.updated_at}</p>
            </>
          )}
        </div>

        {/* 하단 액션 */}
        {p && (
          <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-3 rounded-b-2xl flex items-center gap-2 justify-end">
            {!editMode ? (
              <button
                onClick={() => setEditMode(true)}
                className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                수동 편집
              </button>
            ) : (
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-xs text-white bg-slate-700 rounded-lg hover:bg-slate-800"
              >
                저장
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Section / Field 헬퍼 ───

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
        <span>{icon}</span> {title}
      </h3>
      <div className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-slate-400 shrink-0 w-20">{label}</span>
      {value ? (
        <span className="text-sm text-slate-700">{value}</span>
      ) : (
        <span className="text-xs text-slate-300">-</span>
      )}
    </div>
  )
}

// ─── 메인 컴포넌트 ───

export default function EquipmentProfiles({ equipmentItems }: Props) {
  const [profiles, setProfiles] = useState<EquipmentProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [search, setSearch] = useState('')
  const [mfgFilter, setMfgFilter] = useState('')
  const [selectedModel, setSelectedModel] = useState<UniqueModel | null>(null)

  // 프로필 로드
  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles')
      const json = await res.json()
      setProfiles(json.profiles ?? [])
    } catch (err) {
      console.error('프로필 로드 실패:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProfiles() }, [fetchProfiles])

  // 고유 모델 목록
  const uniqueModels = useMemo(
    () => extractUniqueModels(equipmentItems ?? [], profiles),
    [equipmentItems, profiles],
  )

  // 통계
  const stats = useMemo(() => {
    const total = uniqueModels.length
    const collected = uniqueModels.filter(m => m.status === 'collected').length
    const uncollected = total - collected
    return { total, collected, uncollected }
  }, [uniqueModels])

  // 제조사 목록
  const manufacturers = useMemo(() => {
    const set = new Set(uniqueModels.map(m => m.manufacturer).filter(Boolean))
    return Array.from(set).sort()
  }, [uniqueModels])

  // 필터링
  const filtered = useMemo(() => {
    return uniqueModels.filter(m => {
      if (filter !== 'all' && m.status !== filter) return false
      if (mfgFilter && m.manufacturer !== mfgFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          m.manufacturer.toLowerCase().includes(q) ||
          m.model.toLowerCase().includes(q) ||
          m.productName.toLowerCase().includes(q) ||
          (m.profile?.category ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [uniqueModels, filter, mfgFilter, search])

  // 수동 편집 저장
  async function handleSave(profile: EquipmentProfile) {
    try {
      profile.source = 'manual_input'
      await fetch('/api/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      await fetchProfiles()
      setSelectedModel(null)
    } catch (err) {
      console.error('저장 실패:', err)
    }
  }

  // 수집률
  const rate = stats.total > 0 ? Math.round((stats.collected / stats.total) * 100) : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          장비 사전정보 <span className="text-slate-500 text-base font-normal ml-2">{stats.total.toLocaleString()}건</span>
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">수집률</span>
          <span className="text-xl font-bold text-slate-800">{rate}%</span>
          <span className="text-xs text-slate-400">({stats.collected}/{stats.total})</span>
        </div>
      </div>

      {/* 검색 + 필터 영역 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        {/* 검색바 */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="제조사, 모델, 제품유형 검색"
              className="w-full pl-10 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 placeholder:text-gray-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 필터 드롭다운 + 상태 탭 */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* 상태 탭 */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {([
              { key: 'all' as const, label: `전체 ${stats.total}` },
              { key: 'collected' as const, label: `수집완료 ${stats.collected}` },
              { key: 'uncollected' as const, label: `미수집 ${stats.uncollected}` },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filter === tab.key
                    ? 'bg-white text-slate-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 제조사 필터 */}
          <select
            value={mfgFilter}
            onChange={e => setMfgFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[140px]"
          >
            <option value="">제조사 전체</option>
            {manufacturers.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {(filter !== 'all' || mfgFilter || search) && (
            <button
              onClick={() => { setFilter('all'); setMfgFilter(''); setSearch('') }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              초기화
            </button>
          )}

          {(filter !== 'all' || mfgFilter || search) && (
            <span className="ml-auto text-xs text-gray-400">
              검색 결과 <span className="font-medium text-gray-600">{filtered.length.toLocaleString()}</span>건
            </span>
          )}
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {equipmentItems ? '조건에 맞는 모델이 없습니다.' : 'k-tools 데이터를 먼저 수집하면 장비 목록이 표시됩니다.'}
          </div>
        ) : (
          <DataTable
            columns={tableColumns}
            data={filtered}
            rowKey={i => `${i.manufacturer}|${i.model}`}
            defaultSort={{ key: 'manufacturer', direction: 'asc' }}
            defaultPageSize={30}
            onRowClick={item => setSelectedModel(item)}
          />
        )}
      </div>

      {/* 상세 모달 */}
      {selectedModel && (
        <ProfileDetailModal
          model={selectedModel}
          onClose={() => setSelectedModel(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
