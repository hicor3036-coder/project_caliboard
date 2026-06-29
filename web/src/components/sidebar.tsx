'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useT } from '@/lib/i18n'

// 표시용 권한 쿠키(cb_docs=1)가 있을 때만 용어집 메뉴 노출.
// ─ 실 보안은 /afmetcal-hub 서버 라우트(403)가 책임 — 여기는 UX(메뉴 숨김)만 담당.
function readCanViewDocs(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').some(c => c === 'cb_docs=1')
}

export type ViewType = 'home' | 'unprocessed' | 'upcoming' | 'search' | 'profiles' | 'report' | 'reception' | 'data-source' | 'equipment-detail' | 'doc-hub'

interface SidebarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
  onLogout: () => void
  미처리건수?: number
  교정임박건수?: number
  syncing?: boolean       // 데이터 수집 진행 중 — data-source 메뉴 아이콘에 회전 효과
}

export default function Sidebar({
  activeView,
  onViewChange,
  onLogout,
  미처리건수,
  교정임박건수,
  syncing = false,
}: SidebarProps) {
  const { t, lang, setLang } = useT()
  const [collapsed, setCollapsed] = useState(false)

  // 용어집 권한: 쿠키 기반(클라이언트). SSR 불일치 방지를 위해 마운트 후 읽음.
  const [showDocs, setShowDocs] = useState(false)
  useEffect(() => { setShowDocs(readCanViewDocs()) }, [])

  const allMenuItems: { id: ViewType; label: string; icon: ReactNode }[] = [
    {
      id: 'home',
      label: t.nav.home,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
        </svg>
      ),
    },
    {
      id: 'search',
      label: t.nav.search,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
    },
    {
      id: 'unprocessed',
      label: t.nav.unprocessed,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
    },
    {
      id: 'upcoming',
      label: t.nav.upcoming,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'profiles',
      label: t.nav.profiles,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 4v16M4 9h5M4 13h5" />
        </svg>
      ),
    },
    {
      id: 'report',
      label: t.nav.report,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'reception',
      label: t.nav.reception,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l-2 2-1-1" />
        </svg>
      ),
    },
    {
      id: 'data-source',
      label: t.nav.dataSource,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <ellipse cx="12" cy="6" rx="8" ry="3" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      ),
    },
    {
      id: 'doc-hub',
      label: t.nav.docHub,
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.5C10.5 5.5 8.5 5 6 5c-1 0-2 .2-3 .5v13c1-.3 2-.5 3-.5 2.5 0 4.5.5 6 1.5m0-13c1.5-1 3.5-1.5 6-1.5 1 0 2 .2 3 .5v13c-1-.3-2-.5-3-.5-2.5 0-4.5.5-6 1.5m0-13v13" />
        </svg>
      ),
    },
  ]

  // 권한 없으면 용어집(doc-hub) 메뉴 제외
  const menuItems = allMenuItems.filter(m => m.id !== 'doc-hub' || showDocs)

  function getBadge(id: ViewType): number | undefined {
    if (id === 'unprocessed' && 미처리건수 && 미처리건수 > 0) return 미처리건수
    if (id === 'upcoming' && 교정임박건수 && 교정임박건수 > 0) return 교정임박건수
    return undefined
  }

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-56'} h-screen sticky top-0 bg-slate-800 text-white flex flex-col shrink-0 transition-all duration-200`}>
      {/* 로고 — 클릭 시 홈, 다크 배경에서도 잘 보이게 화이트화 */}
      <button
        type="button"
        onClick={() => onViewChange('home')}
        title={t.nav.home}
        className="text-left px-3 py-4 border-b border-slate-700 bg-gradient-to-b from-slate-700/50 to-transparent transition-opacity hover:opacity-80 cursor-pointer"
      >
        {collapsed ? (
          <div className="flex justify-center">
            <img
              src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_logo.svg"
              alt="K-Tools"
              className="h-7 brightness-0 invert"
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-start gap-1 mb-1.5 px-2">
              <img
                src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_logo.svg"
                alt="K-Tools"
                className="h-7 brightness-0 invert"
              />
              <img
                src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_text-logo.svg"
                alt="K-Tools"
                className="h-6 brightness-0 invert opacity-80"
              />
            </div>
            <p className="text-sm font-bold text-white px-2">CaliBoard</p>
            <p className="text-[10px] text-slate-400 px-2 mt-0.5">ISO 10012 Calibration Management</p>
          </>
        )}
      </button>

      {/* 메뉴 */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {menuItems.map(item => {
          const badge = getBadge(item.id)
          const isActive = activeView === item.id
          const showSyncing = item.id === 'data-source' && syncing
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={collapsed ? (showSyncing ? `${item.label} (수집 중...)` : item.label) : undefined}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'px-5'} gap-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span className={`relative ${showSyncing ? 'animate-spin text-emerald-300' : ''}`}>
                {item.icon}
                {collapsed && badge !== undefined && !showSyncing && (
                  <span className={`absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full ${
                    item.id === 'unprocessed' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                )}
              </span>
              {!collapsed && (
                <>
                  <span className={showSyncing ? 'text-emerald-300' : ''}>{item.label}</span>
                  {showSyncing ? (
                    <span className="ml-auto text-[10px] text-emerald-300 animate-pulse">수집 중</span>
                  ) : badge !== undefined ? (
                    <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                      item.id === 'unprocessed' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {badge}
                    </span>
                  ) : null}
                </>
              )}
            </button>
          )
        })}
      </nav>

      {/* 하단 액션 */}
      <div className="border-t border-slate-700 p-2 space-y-1">
        {/* 언어 토글 */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'px-3'} gap-1 py-1.5`}>
          {collapsed ? (
            <button
              onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
              title={lang === 'ko' ? 'English' : '한국어'}
              className="text-[10px] font-bold text-slate-400 hover:text-white transition-colors"
            >
              {lang === 'ko' ? 'EN' : 'KO'}
            </button>
          ) : (
            <div className="flex gap-0.5 bg-slate-700 rounded p-0.5 w-full">
              <button
                onClick={() => setLang('ko')}
                className={`flex-1 text-xs py-1 rounded transition-colors ${
                  lang === 'ko' ? 'bg-slate-500 text-white font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                KO
              </button>
              <button
                onClick={() => setLang('en')}
                className={`flex-1 text-xs py-1 rounded transition-colors ${
                  lang === 'en' ? 'bg-slate-500 text-white font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                EN
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onLogout}
          title={collapsed ? t.nav.logout : undefined}
          className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'px-3'} gap-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {!collapsed && t.nav.logout}
        </button>

        {/* 접기/펼치기 토글 */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? t.nav.expand : t.nav.collapse}
          className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'px-3'} gap-3 py-2 text-sm text-slate-500 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors`}
        >
          <svg className={`w-4 h-4 shrink-0 transition-transform ${collapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          {!collapsed && t.nav.collapse}
        </button>
      </div>
    </aside>
  )
}
