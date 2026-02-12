'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [userPwd, setUserPwd] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, userPwd }),
      })

      const json = await res.json()

      if (!res.ok) {
        setError(json.error || '로그인 실패')
        return
      }

      router.push('/')
    } catch {
      setError('서버에 연결할 수 없습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <img
            src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_logo.svg"
            alt="K-Tools"
            className="h-12 mx-auto mb-3"
          />
          <img
            src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_text-logo.svg"
            alt="K-Tools"
            className="h-10 mx-auto mb-4"
          />
          <h1 className="text-xl font-bold text-slate-700">CaliBoard</h1>
          <p className="text-sm text-slate-400 mt-1">교정장비 관리 대시보드</p>
        </div>

        {/* 로그인 폼 */}
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-600 mb-1">아이디</label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="K-Tools 아이디"
              required
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-600 mb-1">비밀번호</label>
            <input
              type="password"
              value={userPwd}
              onChange={e => setUserPwd(e.target.value)}
              placeholder="K-Tools 비밀번호"
              required
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-slate-700 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors text-sm"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center mt-4">
          K-Tools 계정으로 로그인합니다
        </p>
      </div>
    </div>
  )
}
