import type { Metadata } from 'next'
import { I18nProvider } from '@/lib/i18n'
import './globals.css'

export const metadata: Metadata = {
  title: 'CaliBoard - 교정장비 관리 대시보드',
  description: 'KAI 교정장비 현황 모니터링',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
