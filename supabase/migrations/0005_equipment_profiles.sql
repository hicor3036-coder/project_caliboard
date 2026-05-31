-- =====================================================================
-- equipment_profiles 테이블 신설
-- 작성: 2026-05-31 (Phase D)
-- 목적: 기존 data/equipment-profiles.json (서버 파일) → Supabase 이전
--        Vercel 서버리스에서도 영구 저장 가능
--
-- 키 전략:
--   manufacturer_key / model_key = profile-cache.ts normalizeForKey() 적용값
--                                  (대소문자/공백/특수문자 제거)
--   manufacturer / model         = 원본 (UI 표시용)
--
-- profile_json 본체는 jsonb로 통째로 저장 — 스키마는 EquipmentProfile 타입 따름
-- =====================================================================

CREATE TABLE IF NOT EXISTS equipment_profiles (
  manufacturer_key   TEXT NOT NULL,
  model_key          TEXT NOT NULL,
  manufacturer       TEXT NOT NULL,
  model              TEXT NOT NULL,
  profile_json       JSONB NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (manufacturer_key, model_key)
);

-- 검색 인덱스 (전체 목록 조회 시 manufacturer/model 정렬)
CREATE INDEX IF NOT EXISTS idx_equipment_profiles_mfr
  ON equipment_profiles (manufacturer);

-- RLS 활성화 (service_role만 접근)
ALTER TABLE equipment_profiles ENABLE ROW LEVEL SECURITY;
