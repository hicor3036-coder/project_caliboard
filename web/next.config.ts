import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 보호 HTML(protected/afmetcal-hub.html)을 서버리스 번들에 포함시켜
  // /afmetcal-hub 라우트가 Vercel 런타임에서도 readFile 가능하게 함.
  outputFileTracingIncludes: {
    '/api/docs': ['./protected/**'],
  },
}

export default nextConfig
