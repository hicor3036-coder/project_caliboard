import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CaliBoard - 교정장비 관리 대시보드',
  description: 'KAI 교정장비 현황 모니터링',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        {children}
      </body>
    </html>
  )
}
