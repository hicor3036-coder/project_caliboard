// KTL 접수정보 연계 대상 과제 코드 (단일 소스)
// k-tools API에 전달하는 prjcCdList 파라미터의 진실 공급원
export const KTOOLS_PROJECT_CODES = ['KL230640', 'KL251650'] as const

// k-tools API가 요구하는 포맷: "[KL230640, KL251650]"
export const KTOOLS_PROJECT_CODES_PARAM = `[${KTOOLS_PROJECT_CODES.join(', ')}]`
