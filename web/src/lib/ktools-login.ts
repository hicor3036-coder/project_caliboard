// k-tools 로그인 → JSESSIONID 쿠키가 포함된 cookie 문자열 반환
// Python ktools_login.py 참조: requests.Session() 패턴 — 로그인 페이지 방문 → 초기 쿠키 획득 → 로그인 POST

const BASE = 'https://k-tools.ktl.re.kr'
const LOGIN_PAGE_URL = `${BASE}/spm/contents/login01.do`
const LOGIN_API_URL = `${BASE}/spm/module/login01_spmLoginProc.ajax`

const COMMON_HEADERS = {
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Origin': BASE,
  'Referer': LOGIN_PAGE_URL,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
}

// Set-Cookie 헤더에서 쿠키 이름=값 추출
function extractCookies(res: Response): string[] {
  const setCookie = res.headers.getSetCookie?.() ?? []
  return setCookie.map(c => c.split(';')[0].trim()).filter(Boolean)
}

export async function ktoolsLogin(userId: string, userPwd: string): Promise<string> {
  console.log('[ktools-login] 로그인 시도:', userId, '/ pwd길이:', userPwd.length)

  // Step 1: 로그인 페이지 방문 → 초기 JSESSIONID 쿠키 획득 (Python의 Session처럼)
  const pageRes = await fetch(LOGIN_PAGE_URL, {
    headers: { 'User-Agent': COMMON_HEADERS['User-Agent'] },
    redirect: 'follow',
  })
  const initCookies = extractCookies(pageRes)
  console.log('[ktools-login] 초기 쿠키:', initCookies.length, '개')

  // Step 2: 초기 쿠키를 포함하여 로그인 POST
  const cookieHeader = initCookies.join('; ')
  const body = `userId=${userId}&userPwd=${userPwd}`

  const res = await fetch(LOGIN_API_URL, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    },
    body,
    redirect: 'manual',
  })

  // 로그인 응답 확인
  const resText = await res.text()
  console.log('[ktools-login] status:', res.status, 'body:', resText.slice(0, 200))

  // 400 Bad Request 체크 (WAF 차단)
  if (res.status === 400) {
    throw new Error('로그인 실패: 서버에서 요청을 차단했습니다 (400)')
  }

  // 로그인 결과 로깅 (result 값과 무관하게 JSESSIONID 기준으로 판단)
  // KL_KAI_master 등 일부 계정은 result:"2"를 반환하지만 실제로는 로그인 성공
  try {
    const loginResult = JSON.parse(resText)
    // returnType:0 = 계정 없음/비번 틀림 (JSESSIONID도 없을 것)
    if (loginResult.returnType === 0) {
      throw new Error('로그인 실패: 아이디 또는 비밀번호를 확인하세요')
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('로그인 실패')) throw e
  }

  // JSESSIONID 추출: 로그인 응답 쿠키 → 초기 쿠키 순으로 시도
  const loginCookies = extractCookies(res)
  const allCookies = [...loginCookies, ...initCookies]
  const sessionCookie = allCookies.find(c => c.startsWith('KTOOLS_JSESSIONID='))

  if (!sessionCookie) {
    throw new Error('로그인 실패: JSESSIONID를 받지 못했습니다')
  }

  const val = sessionCookie.split('=')[1]
  console.log('[ktools-login] 로그인 성공, JSESSIONID:', val.slice(0, 8) + '...')
  return val
}
