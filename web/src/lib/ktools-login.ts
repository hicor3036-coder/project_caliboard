// k-tools 로그인 → JSESSIONID 쿠키가 포함된 cookie 문자열 반환

const LOGIN_URL = 'https://k-tools.ktl.re.kr/spm/module/login01_spmLoginProc.ajax'

export async function ktoolsLogin(userId: string, userPwd: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': 'https://k-tools.ktl.re.kr',
      'Referer': 'https://k-tools.ktl.re.kr/spm/contents/login01.do',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: `userId=${userId}&userPwd=${userPwd}`,
    redirect: 'manual',
  })

  // Set-Cookie 헤더에서 KTOOLS_JSESSIONID 추출
  const setCookie = res.headers.getSetCookie?.() ?? []
  const sessionCookie = setCookie.find(c => c.includes('KTOOLS_JSESSIONID'))
  if (!sessionCookie) {
    throw new Error('로그인 실패: JSESSIONID를 받지 못했습니다')
  }

  const match = sessionCookie.match(/KTOOLS_JSESSIONID=([^;]+)/)
  if (!match) {
    throw new Error('로그인 실패: JSESSIONID 파싱 실패')
  }

  return match[1]
}
