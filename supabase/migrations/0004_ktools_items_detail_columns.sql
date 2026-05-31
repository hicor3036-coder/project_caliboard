-- =====================================================================
-- equipment-detail 화면용 컬럼 12개 추가
-- 작성: 2026-05-31 (Phase D)
-- 목적: DetailItem 26필드 중 부족한 12개를 ktools_items에 추가
-- =====================================================================

ALTER TABLE ktools_items
  -- 날짜
  ADD COLUMN IF NOT EXISTS snct_ymd         DATE,             -- 결재일
  ADD COLUMN IF NOT EXISTS isnc_ymd         DATE,             -- 발급일
  ADD COLUMN IF NOT EXISTS smpl_out_date    DATE,             -- 샘플 반출일

  -- 상태/조직
  ADD COLUMN IF NOT EXISTS gyeolje_status   TEXT,             -- 결재 상태
  ADD COLUMN IF NOT EXISTS mngm_dvsn_nm     TEXT,             -- 담당 부서명
  ADD COLUMN IF NOT EXISTS affc_cycl_cd     TEXT,             -- 영향 주기 코드

  -- 비용 (세부)
  ADD COLUMN IF NOT EXISTS total_fee        NUMERIC,          -- 기본 요금
  ADD COLUMN IF NOT EXISTS total_vat        NUMERIC,          -- 부가세

  -- 의뢰사 연락처
  ADD COLUMN IF NOT EXISTS apcn_cmnm        TEXT,             -- 의뢰사명
  ADD COLUMN IF NOT EXISTS apcn_nm          TEXT,             -- 의뢰자명
  ADD COLUMN IF NOT EXISTS apcn_tlno        TEXT,             -- 의뢰자 연락처
  ADD COLUMN IF NOT EXISTS apcn_eml_adrs    TEXT;             -- 의뢰자 이메일
