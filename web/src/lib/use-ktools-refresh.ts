// ktools 풀 동기화 SSE 훅 (공용)
// ─ 호출처: page.tsx (최상위 1회), sidebar/data-source-admin이 같은 상태 공유
// ─ in-flight 가드: React state running 으로 중복 호출 차단 (옵션 B — 단일 브라우저 인스턴스 내)
// ─ 진행률은 SSE progress 이벤트 → progress state
// ─ 완료 시 onRefreshed 콜백으로 부모에게 데이터 재조회 트리거

import { useCallback, useRef, useState } from 'react'
import { KTOOLS_PROJECT_CODES } from './projects'

export interface RefreshProgress {
  stage: string
  current: number
  total: number
  message: string
}

export type TriggerSource = 'manual' | 'auto'

export interface UseKtoolsRefreshOptions {
  onRefreshed?: () => void          // sync 완료 시 호출 (page가 데이터 재조회)
  onSessionExpired?: () => void     // 401 시 로그인 페이지로
}

export interface UseKtoolsRefreshReturn {
  running: boolean                  // in-flight 플래그 (수집 중)
  progress: RefreshProgress | null  // 진행률
  error: string | null
  source: TriggerSource | null      // 현재 sync의 출처 (수동/자동)
  refresh: (source?: TriggerSource) => Promise<void>
}

export function useKtoolsRefresh(options: UseKtoolsRefreshOptions = {}): UseKtoolsRefreshReturn {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RefreshProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<TriggerSource | null>(null)

  // 콜백은 ref로 잡아서 항상 최신값 호출 (refresh 함수 의존성 폭증 방지)
  const onRefreshedRef = useRef(options.onRefreshed)
  const onSessionExpiredRef = useRef(options.onSessionExpired)
  onRefreshedRef.current = options.onRefreshed
  onSessionExpiredRef.current = options.onSessionExpired

  // 동기적 in-flight 가드 — running state는 setState 후 즉시 반영 안 되니
  // ref로 같은 tick의 중복 호출까지 막음
  const inflightRef = useRef(false)

  const refresh = useCallback(async (src: TriggerSource = 'manual') => {
    if (inflightRef.current) return
    inflightRef.current = true
    setRunning(true)
    setError(null)
    setSource(src)
    setProgress({ stage: 'init', current: 0, total: 0, message: '연결 중...' })

    try {
      // 1) k-tools 세션 발급
      const sessionRes = await fetch('/api/ktools/session', { method: 'POST' })
      if (!sessionRes.ok) {
        if (sessionRes.status === 401) {
          onSessionExpiredRef.current?.()
          return
        }
        throw new Error(`세션 발급 실패 (${sessionRes.status})`)
      }
      const { sessionId } = await sessionRes.json() as { sessionId: string }

      // 2) task SSE 시작
      const taskRes = await fetch('/task/ktools-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          prjcCdList: [...KTOOLS_PROJECT_CODES],
        }),
      })
      if (!taskRes.ok || !taskRes.body) {
        throw new Error(`task 시작 실패 (${taskRes.status})`)
      }

      // 3) SSE 파싱
      const reader = taskRes.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let done = false
      while (!done) {
        const { value, done: rdone } = await reader.read()
        done = rdone
        if (value) buf += decoder.decode(value, { stream: true })

        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const lines = raw.split('\n')
          const evLine = lines.find(l => l.startsWith('event: '))?.slice(7)
          const dtLine = lines.find(l => l.startsWith('data: '))?.slice(6)
          if (!evLine || !dtLine) continue
          const dt = JSON.parse(dtLine)
          if (evLine === 'progress') {
            setProgress(dt as RefreshProgress)
          } else if (evLine === 'done') {
            setProgress({
              stage: 'done',
              current: dt.upserted,
              total: dt.upserted,
              message: `완료 (${dt.upserted.toLocaleString()}건 / ${Math.round(dt.durationMs / 1000)}초)`,
            })
          } else if (evLine === 'error') {
            if (dt.sessionExpired) {
              onSessionExpiredRef.current?.()
              return
            }
            throw new Error(dt.message ?? '동기화 실패')
          }
        }
      }

      // 4) 부모에게 데이터 재조회 요청
      onRefreshedRef.current?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터 수집 실패')
    } finally {
      inflightRef.current = false
      setRunning(false)
      // 진행률은 잠깐 더 보여주고 자동 해제
      setTimeout(() => {
        setProgress(null)
        setSource(null)
      }, 2500)
    }
  }, [])

  return { running, progress, error, source, refresh }
}
