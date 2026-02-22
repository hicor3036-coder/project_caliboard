// AI 컨텍스트 빌더: AnalysisResult → LLM용 텍스트 변환
import type { AnalysisResult } from './ktools-analyze'

// === 시스템 프롬프트 ===

export const CHAT_SYSTEM_PROMPT = `당신은 "CaliBoard AI 도우미"입니다. KAI(한국항공우주산업) 교정장비 관리 데이터를 분석하고 질문에 답변합니다.

규칙:
1. 반드시 아래 제공된 데이터만 기반으로 답변하세요. 데이터에 없는 내용은 추측하지 마세요.
2. 한국어로 답변하세요. 전문적이지만 친근한 톤을 유지하세요.
3. 숫자는 정확하게, 건수와 일수 단위를 명시하세요.
4. 핵심 내용을 먼저 말하고, 필요시 상세 내용을 추가하세요.
5. 이상 패턴 발견 시 적극적으로 알려주세요 (예: 특정 담당자 과부하, 장기 미처리, 교정 지연 등).
6. 답변은 간결하게. 불필요한 서론/결론 없이 핵심만 전달하세요.
7. 마크다운 형식을 적절히 활용하세요 (볼드, 리스트 등).

제공 데이터:`

export const REPORT_SYSTEM_PROMPT = `당신은 "CaliBoard AI 도우미"입니다. 교정장비 관리 현황 보고서를 생성합니다.

아래 데이터를 기반으로 마크다운 형식의 종합 보고서를 작성하세요.

보고서 형식:
## 1. 요약
- 주요 지표 한눈에 보기

## 2. 미처리 현황
- 전체 미처리 건수 및 평균 체류일수
- 주요 지연 장비 목록
- 담당자별 미처리 분석

## 3. 교정 임박 현황
- 만료/D-30/D-60 구간별 현황
- 즉시 조치 필요 장비

## 4. 이상 징후 및 권고사항
- 담당자 업무 편중 여부
- 장기 미처리 패턴
- 교정 주기 관리 개선점

## 5. 월별 추이 분석

규칙:
1. 데이터에 기반한 팩트만 기술하세요.
2. 수치를 정확하게 인용하세요.
3. 권고사항은 구체적이고 실행 가능하게 작성하세요.

제공 데이터:`

// === 토픽 감지 ===

interface TopicFlags {
  미처리: boolean
  교정임박: boolean
  담당자: boolean
  제조사: boolean
  추이: boolean
  과제: boolean
  보고서: boolean
  이상패턴: boolean
}

function detectTopics(message: string, mode: 'chat' | 'report'): TopicFlags {
  const m = message.toLowerCase()
  return {
    미처리:    /미처리|처리|대기|체류|지연|늦|오래|잔여|초과|남은/.test(m),
    교정임박:  /교정|임박|만료|d-|기한|갱신|주기|예정/.test(m),
    담당자:    /담당|매니저|업무량|배분|인원|누가|사람/.test(m),
    제조사:    /제조|브랜드|업체|메이커|장비종류|모델/.test(m),
    추이:      /추이|트렌드|월별|변화|증가|감소|추세|최근/.test(m),
    과제:      /과제|프로젝트|예산|비용/.test(m),
    보고서:    mode === 'report' || /보고|리포트|요약|전체|종합|현황/.test(m),
    이상패턴:  /이상|패턴|문제|경고|위험|주의|anomal|특이/.test(m),
  }
}

// === 컨텍스트 빌더 ===

export function buildContext(
  analysis: AnalysisResult,
  message: string,
  mode: 'chat' | 'report',
): string {
  const topics = detectTopics(message, mode)
  const parts: string[] = []

  // 항상 포함: 요약
  const s = analysis.summary
  parts.push(
    `[현황 요약] ${s.데이터시점.slice(0, 10)} 기준`,
    `총 장비: ${s.총건수.toLocaleString()}건, 미처리: ${s.미처리건수}건, 교정임박(60일내): ${s.교정임박건수}건, 평균소요: ${s.평균소요일}일`,
  )

  // 항상 포함: 진행상태 분포
  parts.push(
    `\n[진행상태] ` + analysis.진행상태분포.map(d => `${d.label}:${d.value}건`).join(', ')
  )

  // 항상 포함: 담당자별 처리량
  parts.push(
    `\n[담당자별 처리량] ` + analysis.담당자별처리량.map(d => `${d.label}:${d.value}건`).join(', ')
  )

  // 조건부: 미처리 현황
  if (topics.미처리 || topics.보고서 || topics.이상패턴 || topics.담당자) {
    const items = analysis.미처리현황
      .sort((a, b) => b.체류일수 - a.체류일수)
      .slice(0, 15)
    parts.push(`\n[미처리 상위 ${items.length}건]`)
    for (const i of items) {
      parts.push(
        `- ${i.entpPrdNm} | 접수:${i.rcpnYmd} | 체류${i.체류일수}일 | 남은${i.남은일수 ?? '?'}일 | 담당:${i.mngmRsprNm || '(없음)'}`
      )
    }
  }

  // 조건부: 교정 임박
  if (topics.교정임박 || topics.보고서 || topics.이상패턴) {
    const u = analysis.차기교정임박
    parts.push(`\n[교정임박] 만료:${u.만료}건, D-30:${u.d30}건, D-60:${u.d60}건, D-90:${u.d90}건, 장기경과:${u.장기경과}건`)
    const urgent = u.items.filter(i => i.구간 !== 'D-90+').slice(0, 10)
    for (const i of urgent) {
      parts.push(
        `- ${i.entpPrdNm} | D${i.dDay >= 0 ? '-' : '+'}${Math.abs(i.dDay)}일 | ${i.구간} | ${i.접수시급 ? '접수시급' : ''}`
      )
    }
  }

  // 조건부: 제조사별
  if (topics.제조사 || topics.보고서) {
    parts.push(
      `\n[제조사별 분포 Top10] ` +
      analysis.제조사별분포.slice(0, 10).map(d => `${d.label}:${d.value}건`).join(', ')
    )
  }

  // 조건부: 월별 추이
  if (topics.추이 || topics.보고서) {
    parts.push(
      `\n[월별접수추이 최근12개월] ` +
      analysis.월별접수추이.slice(-12).map(d => `${d.month}:${d.건수}건`).join(', ')
    )
  }

  // 조건부: 과제별
  if (topics.과제 || topics.보고서) {
    parts.push(
      `\n[과제별현황] ` +
      analysis.과제별현황.slice(0, 10).map(d => `${d.prjcCd}:${d.건수}건(${d.총비용.toLocaleString()}원)`).join(', ')
    )
  }

  return parts.join('\n')
}

// 대화 히스토리 제한 (최근 N개)
export function trimHistory(history: { role: string; content: string }[], maxMessages: number) {
  return history.slice(-maxMessages)
}
