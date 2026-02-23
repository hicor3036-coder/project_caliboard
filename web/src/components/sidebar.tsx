'use client'

import { useState, type ReactNode } from 'react'
import { useT } from '@/lib/i18n'

export type ViewType = 'home' | 'unprocessed' | 'upcoming' | 'search' | 'profiles' | 'equipment-detail'

interface SidebarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
  onRefresh: () => void
  onLogout: () => void
  loading: boolean
  미처리건수?: number
  교정임박건수?: number
}

export default function Sidebar({
  activeView,
  onViewChange,
  onRefresh,
  onLogout,
  loading,
  미처리건수,
  교정임박건수,
}: SidebarProps) {
  const { t, lang, setLang } = useT()
  const [collapsed, setCollapsed] = useState(false)

  const menuItems: { id: ViewType; label: string; icon: ReactNode }[] = [
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
  ]

  function getBadge(id: ViewType): number | undefined {
    if (id === 'unprocessed' && 미처리건수 && 미처리건수 > 0) return 미처리건수
    if (id === 'upcoming' && 교정임박건수 && 교정임박건수 > 0) return 교정임박건수
    return undefined
  }

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-56'} h-screen sticky top-0 bg-slate-800 text-white flex flex-col shrink-0 transition-all duration-200`}>
      {/* 로고 */}
      <div className="px-3 py-4 border-b border-slate-700">
        {collapsed ? (
          <div className="flex justify-center">
            <img
              src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_logo.svg"
              alt="K-Tools"
              className="h-7"
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-start gap-1 mb-1 px-2">
              <img
                src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_logo.svg"
                alt="K-Tools"
                className="h-7"
              />
              <img
                src="https://k-tools.ktl.re.kr/resource/templete/spm/images/ktools_text-logo.svg"
                alt="K-Tools"
                className="h-6"
              />
            </div>
            <p className="text-sm font-bold text-slate-300 px-2">CaliBoard</p>
          </>
        )}
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {menuItems.map(item => {
          const badge = getBadge(item.id)
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'px-5'} gap-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span className="relative">
                {item.icon}
                {collapsed && badge !== undefined && (
                  <span className={`absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full ${
                    item.id === 'unprocessed' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                )}
              </span>
              {!collapsed && (
                <>
                  <span>{item.label}</span>
                  {badge !== undefined && (
                    <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                      item.id === 'unprocessed' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {badge}
                    </span>
                  )}
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
          onClick={onRefresh}
          disabled={loading}
          title={collapsed ? (loading ? t.nav.refreshing : t.nav.refresh) : undefined}
          className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'px-3'} gap-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50`}
        >
          <svg className={`w-4 h-4 shrink-0 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {!collapsed && (loading ? t.nav.refreshing : t.nav.refresh)}
        </button>
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
