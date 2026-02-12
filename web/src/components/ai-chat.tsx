'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import DataTable, { type Column, fmtDate } from '@/components/data-table'

interface TableData {
  columns: string[]
  labels: Record<string, string>
  rows: Record<string, unknown>[]
}

type TableRow = Record<string, unknown>

interface Message {
  role: 'user' | 'assistant'
  content: string
  sql?: string
  tableData?: TableData
  suggestions?: string[]
}

// "[추천] 질문1 | 질문2 | 질문3" 파싱
function parseSuggestions(text: string): { content: string; suggestions: string[] } {
  const match = text.match(/\[추천\]\s*(.+)$/m)
  if (!match) return { content: text, suggestions: [] }
  const content = text.slice(0, match.index).trimEnd()
  const suggestions = match[1].split('|').map(s => s.trim()).filter(Boolean)
  return { content, suggestions }
}

interface AiChatProps {
  dataLoaded: boolean
}

// 추천 질문 목록
const SUGGESTED_QUESTIONS = [
  '미처리 건 몇 개야?',
  '김명준 담당 미처리 장비 보여줘',
  'Fluke 제조 장비 몇 개?',
  '담당자별 처리량 순위',
  '최근 일주일 접수 건수',
]

// DataTable 래퍼 (채팅 메시지 내 테이블)
function ChatTable({ tableData }: { tableData: TableData }) {
  const columns = useMemo(() =>
    tableData.columns.map((col): Column<TableRow> => ({
      key: col,
      header: tableData.labels[col] || col,
      sortValue: (item) => {
        const v = item[col]
        if (v === null || v === undefined) return null
        const n = Number(v)
        return isNaN(n) ? String(v) : n
      },
      render: (item) => {
        const v = item[col]
        if (v === null || v === undefined) return <span>-</span>
        // Ymd로 끝나는 컬럼은 날짜 포맷 적용
        if (col.endsWith('Ymd')) return <span>{fmtDate(String(v))}</span>
        return <span>{String(v)}</span>
      },
    })),
    [tableData]
  )

  return (
    <div className="mt-3">
      <DataTable
        columns={columns}
        data={tableData.rows}
        rowKey={(row) => JSON.stringify(row).slice(0, 100)}
      />
    </div>
  )
}

export default function AiChat({ dataLoaded }: AiChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [currentTableData, setCurrentTableData] = useState<TableData | null>(null)
  const [abortController, setAbortController] = useState<AbortController | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 메시지 추가 시 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentAnswer, currentTableData])

  // 메시지 전송
  async function handleSend(question?: string) {
    const messageText = question || input.trim()
    if (!messageText || loading) return

    const userMessage: Message = { role: 'user', content: messageText }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setCurrentAnswer('')
    setCurrentTableData(null)

    const controller = new AbortController()
    setAbortController(controller)

    try {
      const history = messages.slice(-6).map(m => ({
        role: m.role,
        content: m.content,
      }))

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, history }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('스트림 읽기 실패')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullAnswer = ''
      let eventType = ''
      let sqlQuery = ''
      let tableData: TableData | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7)
          } else if (line.startsWith('data: ')) {
            const payload = JSON.parse(line.slice(6))

            if (eventType === 'token') {
              fullAnswer += payload.token
              setCurrentAnswer(fullAnswer)
            } else if (eventType === 'status') {
              if (payload.sql) {
                sqlQuery = payload.sql
              }
            } else if (eventType === 'table') {
              tableData = payload as TableData
              setCurrentTableData(tableData)
            } else if (eventType === 'done') {
              const rawContent = fullAnswer || payload.answer || '완료'
              const { content: cleanContent, suggestions } = parseSuggestions(rawContent)
              const assistantMessage: Message = {
                role: 'assistant',
                content: cleanContent,
                sql: sqlQuery || undefined,
                tableData: tableData || undefined,
                suggestions: suggestions.length > 0 ? suggestions : undefined,
              }
              setMessages(prev => [...prev, assistantMessage])
              setCurrentAnswer('')
              setCurrentTableData(null)
            } else if (eventType === 'error') {
              throw new Error(payload.message)
            }

            eventType = ''
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: '(중지됨)' }])
      } else {
        const msg = error instanceof Error ? error.message : '오류 발생'
        setMessages(prev => [...prev, { role: 'assistant', content: `오류: ${msg}` }])
      }
      setCurrentAnswer('')
      setCurrentTableData(null)
    } finally {
      setLoading(false)
      setAbortController(null)
    }
  }

  function handleStop() {
    abortController?.abort()
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
  }

  // 데이터 미수집 안내
  if (!dataLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center max-w-md">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">데이터가 필요합니다</h2>
          <p className="text-slate-500 text-sm">
            먼저 홈 화면에서 데이터를 수집해주세요.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-slate-200">
        <h1 className="text-lg font-bold text-slate-800">질문하기</h1>
        <p className="text-xs text-slate-500 mt-1">
          궁금한 걸 물어보세요. 수집된 데이터에서 바로 찾아드립니다.
        </p>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* 초기 상태: 추천 질문 */}
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 font-medium">이런 것도 물어볼 수 있어요</p>
            {SUGGESTED_QUESTIONS.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(q)}
                className="block w-full text-left px-4 py-3 bg-slate-50 hover:bg-slate-100 rounded-lg text-sm text-slate-700 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* 메시지 목록 */}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`${msg.tableData ? 'max-w-full' : 'max-w-[80%]'} rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-slate-700 text-white'
                  : 'bg-white border border-slate-200 text-slate-800'
              }`}
            >
              {/* 테이블 (텍스트 위에) */}
              {msg.tableData && <ChatTable tableData={msg.tableData} />}

              {/* 텍스트 답변 */}
              <p className={`text-sm whitespace-pre-wrap ${msg.tableData ? 'mt-3' : ''}`}>{msg.content}</p>

              {/* 조회 조건 보기 */}
              {msg.role === 'assistant' && msg.sql && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-slate-500 hover:text-slate-700">조회 조건 보기</summary>
                  <pre className="mt-1 p-2 bg-slate-50 rounded text-slate-600 overflow-x-auto">
                    {msg.sql}
                  </pre>
                </details>
              )}

              {/* 복사 버튼 */}
              {msg.role === 'assistant' && (
                <button
                  onClick={() => copyToClipboard(msg.content)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-700"
                >
                  복사
                </button>
              )}

              {/* 추천 질문 */}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {msg.suggestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(q)}
                      disabled={loading}
                      className="px-3 py-1.5 text-xs bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-full border border-slate-200 transition-colors disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* 스트리밍 중인 답변 */}
        {(currentAnswer || currentTableData) && (
          <div className="flex justify-start">
            <div className={`${currentTableData ? 'max-w-full' : 'max-w-[80%]'} rounded-2xl px-4 py-3 bg-white border border-slate-200 text-slate-800`}>
              {currentTableData && <ChatTable tableData={currentTableData} />}
              {currentAnswer && (
                <p className={`text-sm whitespace-pre-wrap ${currentTableData ? 'mt-3' : ''}`}>{currentAnswer}</p>
              )}
              <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-1" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="px-6 py-4 border-t border-slate-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="질문을 입력하세요..."
            disabled={loading}
            className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-slate-100"
          />
          {loading ? (
            <button
              onClick={handleStop}
              className="px-5 py-2.5 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 transition-colors text-sm"
            >
              중지
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="px-5 py-2.5 bg-slate-700 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              전송
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
