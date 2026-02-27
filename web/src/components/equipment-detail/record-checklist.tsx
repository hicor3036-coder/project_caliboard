/**
 * §7.1.4(a)~(p) 측정학적 확인 기록 체크리스트
 * ISO 10012 원문 기반 16개 항목
 * 성적서 파싱 데이터와 자동 매핑하여 충족/미충족 시각화
 */
'use client'

import { useMemo } from 'react'
import type { CertResult } from '@/lib/cert-cache'
import { useT } from '@/lib/i18n'

/** 체크리스트 항목 정의 */
interface CheckItem {
  key: string
  labelKo: string
  labelEn: string
  /** 성적서에서 자동 매핑 가능 여부를 판별하는 함수 */
  autoCheck: (cert: CertResult) => boolean
  /** 자동 매핑된 값 표시 */
  autoValue?: (cert: CertResult) => string | null
}

const CHECKLIST: CheckItem[] = [
  {
    key: 'a', labelKo: '장비 식별 (제조자, 형식, 일련번호)', labelEn: 'Equipment identification (manufacturer, type, serial no.)',
    autoCheck: c => !!(c.제조사 || c.모델 || c.시리얼),
    autoValue: c => [c.제조사, c.모델, c.시리얼].filter(Boolean).join(' / ') || null,
  },
  {
    key: 'b', labelKo: '측정학적 확인 완료 날짜', labelEn: 'Date of metrological confirmation completion',
    autoCheck: c => !!c.교정일,
    autoValue: c => c.교정일 || null,
  },
  {
    key: 'c', labelKo: '측정학적 확인 결과', labelEn: 'Metrological confirmation result',
    autoCheck: c => !!c.전체판정,
    autoValue: c => c.전체판정 || null,
  },
  {
    key: 'd', labelKo: '지정된 측정학적 확인 주기', labelEn: 'Designated metrological confirmation interval',
    autoCheck: c => !!c.차기교정일,
    autoValue: c => c.차기교정일 ? `차기: ${c.차기교정일}` : null,
  },
  {
    key: 'e', labelKo: '측정학적 확인 절차의 식별', labelEn: 'Identification of confirmation procedure',
    autoCheck: c => !!(c.교정방법 || c.기술지원코드),
    autoValue: c => c.교정방법 || c.기술지원코드 || null,
  },
  {
    key: 'f', labelKo: '지정된 최대 허용오차', labelEn: 'Designated maximum permissible error',
    autoCheck: c => {
      if (!c.측정결과?.length) return false
      return c.측정결과.some(mp => mp.허용오차 != null)
    },
    autoValue: c => {
      if (!c.측정결과?.length) return null
      const mp = c.측정결과.find(m => m.허용오차 != null)
      if (!mp) return null
      return `±${mp.허용오차}${mp.허용오차단위 ? ' ' + mp.허용오차단위 : ''}`
    },
  },
  {
    key: 'g', labelKo: '환경 조건 및 시정 설명', labelEn: 'Environmental conditions and corrections',
    autoCheck: c => !!(c.온도 || c.습도),
    autoValue: c => {
      const parts = []
      if (c.온도) parts.push(`${c.온도}°C`)
      if (c.습도) parts.push(`${c.습도}%RH`)
      return parts.length > 0 ? parts.join(', ') : null
    },
  },
  {
    key: 'h', labelKo: '장비 교정 관련 불확도', labelEn: 'Uncertainty related to equipment calibration',
    autoCheck: c => {
      if (!c.측정결과?.length) return false
      return c.측정결과.some(mp => mp.불확도 != null)
    },
    autoValue: c => {
      if (!c.측정결과?.length) return null
      const mp = c.측정결과.find(m => m.불확도 != null)
      return mp?.불확도 != null ? `U = ${mp.불확도}` : null
    },
  },
  {
    key: 'i', labelKo: '유지보전 세부사항 (조정, 수리, 수정)', labelEn: 'Maintenance details (adjustments, repairs, modifications)',
    autoCheck: () => false, // 수동 입력 필요
  },
  {
    key: 'j', labelKo: '사용상 제한사항', labelEn: 'Limitations of use',
    autoCheck: () => false,
  },
  {
    key: 'k', labelKo: '확인 수행 인원 식별', labelEn: 'Identification of person performing confirmation',
    autoCheck: c => !!c.교정자,
    autoValue: c => c.교정자 || null,
  },
  {
    key: 'l', labelKo: '기록 정정 책임자 식별', labelEn: 'Identification of person responsible for recorded information',
    autoCheck: c => !!c.승인자,
    autoValue: c => c.승인자 || null,
  },
  {
    key: 'm', labelKo: '교정 인증서/보고서 고유 식별', labelEn: 'Unique identification of calibration certificates/reports',
    autoCheck: c => !!c.성적서번호,
    autoValue: c => c.성적서번호 || null,
  },
  {
    key: 'n', labelKo: '교정결과 소급성 증거', labelEn: 'Evidence of traceability of calibration results',
    autoCheck: c => !!(c.기준기 && c.기준기.length > 0),
    autoValue: c => c.기준기?.length ? `기준기 ${c.기준기.length}건` : null,
  },
  {
    key: 'o', labelKo: '의도된 사용을 위한 측정학적 요구사항', labelEn: 'Metrological requirements for intended use',
    autoCheck: () => false,
  },
  {
    key: 'p', labelKo: '조정/수리 전후 교정결과', labelEn: 'Calibration results before/after adjustment or repair',
    autoCheck: () => false,
  },
]

interface Props {
  /** 선택된(가장 최근) 성적서 — null이면 빈 체크리스트 표시 */
  latestCert: CertResult | null
  /** 전체 성적서 개수 (커버리지 표시용) */
  totalCerts: number
}

export default function RecordChecklist({ latestCert, totalCerts }: Props) {
  const { lang } = useT()

  const results = useMemo(() => {
    return CHECKLIST.map(item => ({
      ...item,
      fulfilled: latestCert ? item.autoCheck(latestCert) : false,
      value: latestCert && item.autoValue ? item.autoValue(latestCert) : null,
    }))
  }, [latestCert])

  const fulfilledCount = results.filter(r => r.fulfilled).length
  const totalCount = results.length
  const pct = Math.round((fulfilledCount / totalCount) * 100)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="px-2.5 py-1 text-xs font-bold bg-slate-800 text-white rounded-md">§7.1.4</span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-700">
            {lang === 'ko' ? '측정학적 확인 기록 체크리스트' : 'Metrological Confirmation Record Checklist'}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {lang === 'ko'
              ? '기록은 필요한 경우 다음을 포함하여야 한다 — (a)~(p) 16개 항목'
              : 'Records shall include, as necessary — items (a) through (p)'
            }
          </p>
        </div>
        {/* 커버리지 도넛 */}
        <div className="flex items-center gap-2">
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none"
                stroke={pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'}
                strokeWidth="3" strokeDasharray={`${pct * 0.94} 100`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">{pct}%</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-slate-700">{fulfilledCount}/{totalCount}</p>
            <p className="text-[10px] text-slate-400">
              {lang === 'ko' ? '자동 충족' : 'auto-filled'}
            </p>
          </div>
        </div>
      </div>

      {!latestCert && (
        <div className="bg-slate-50 rounded-lg p-4 border border-dashed border-slate-200 text-center mb-4">
          <p className="text-sm text-slate-400">
            {lang === 'ko'
              ? '교정성적서를 로드하면 자동으로 체크리스트가 매핑됩니다'
              : 'Load calibration certificates to auto-map the checklist'
            }
          </p>
        </div>
      )}

      {/* 체크리스트 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {results.map(item => (
          <div
            key={item.key}
            className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-xs transition-colors ${
              item.fulfilled
                ? 'bg-green-50 border-green-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 ${
              item.fulfilled
                ? 'bg-green-600 text-white'
                : 'bg-slate-300 text-white'
            }`}>
              {item.fulfilled ? '✓' : item.key}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`font-medium leading-tight ${item.fulfilled ? 'text-green-800' : 'text-slate-500'}`}>
                ({item.key}) {lang === 'ko' ? item.labelKo : item.labelEn}
              </p>
              {item.value && (
                <p className="text-green-600 mt-0.5 truncate" title={item.value}>
                  → {item.value}
                </p>
              )}
              {!item.fulfilled && !latestCert && (
                <p className="text-slate-400 mt-0.5 italic">
                  {lang === 'ko' ? '데이터 없음' : 'No data'}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {latestCert && totalCerts > 1 && (
        <p className="text-[10px] text-slate-400 mt-3 text-center">
          {lang === 'ko'
            ? `※ 가장 최근 성적서 기준 자동 매핑 (전체 ${totalCerts}건)`
            : `※ Auto-mapped based on latest certificate (${totalCerts} total)`
          }
        </p>
      )}
    </div>
  )
}
