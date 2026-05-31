// 데이터 신선도 임계값 (공용 상수)
// ─ summary.lastSyncedAt이 이 값을 초과하면 "갱신 필요"로 판정
// ─ 사용자 로그인 시 자동 트리거 임계값도 동일 (UI 뱃지와 정합)
// ─ 가변 — 사용자 환경에 따라 조정 (1h ~ 48h 범위 권장)
export const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000
