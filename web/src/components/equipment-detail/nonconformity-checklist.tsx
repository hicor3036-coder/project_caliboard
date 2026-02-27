/**
 * §8.3.3(a)~(h) 부적합 사유 체크리스트
 * ISO 10012 원문 기반 8개 항목
 */
'use client'

import { useT } from '@/lib/i18n'
import { NONCONFORMITY_REASONS } from '@/lib/corrective-action'

interface Props {
  selected: string[]
  onChange: (reasons: string[]) => void
  readOnly?: boolean
}

export default function NonconformityChecklist({ selected, onChange, readOnly }: Props) {
  const { lang } = useT()

  const toggle = (key: string) => {
    if (readOnly) return
    if (selected.includes(key)) {
      onChange(selected.filter(k => k !== key))
    } else {
      onChange([...selected, key])
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-white rounded">§8.3.3</span>
        <span className="text-xs font-semibold text-slate-600">
          {lang === 'ko' ? '부적합 사유 (격리 요건)' : 'Nonconformity Reasons (Quarantine Criteria)'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {NONCONFORMITY_REASONS.map(reason => {
          const isSelected = selected.includes(reason.key)
          return (
            <button
              key={reason.key}
              type="button"
              onClick={() => toggle(reason.key)}
              disabled={readOnly}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                isSelected
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : readOnly
                    ? 'bg-slate-50 border-slate-100 text-slate-400'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${
                isSelected ? 'bg-red-600 border-red-600 text-white' : 'border-slate-300'
              }`}>
                {isSelected ? '✓' : reason.key}
              </span>
              <span className="font-medium">
                ({reason.key}) {lang === 'ko' ? reason.labelKo : reason.labelEn}
              </span>
            </button>
          )
        })}
      </div>
      {selected.length > 0 && !readOnly && (
        <p className="text-[10px] text-red-500 mt-1">
          {lang === 'ko'
            ? `${selected.length}개 사유 선택됨 — 부적합 장비는 격리 또는 명확한 표시로 사용 방지 필요`
            : `${selected.length} reason(s) selected — equipment must be isolated or clearly labeled`
          }
        </p>
      )}
    </div>
  )
}
