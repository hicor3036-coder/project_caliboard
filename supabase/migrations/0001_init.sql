-- =====================================================================
-- CaliBoard 스키마 v2 — 실제 사용 필드만 19개
-- 작성: 2026-05-31
-- =====================================================================

DROP TABLE IF EXISTS ktools_items;

CREATE TABLE ktools_items (
  -- 식별
  acpt_no              TEXT PRIMARY KEY,              -- 접수번호

  -- 날짜 (k-tools "YYYYMMDD" → DATE로 파싱)
  rcpn_ymd             DATE,                          -- 접수일
  exrs_wrtn_ymd        DATE,                          -- 교정성적서 작성일
  fnsh_scdl_ymd        DATE,                          -- 완료 예정일
  nxtr_exrs_ymd        DATE,                          -- 차기 교정일

  -- 장비/제품
  prd_nm               TEXT,                          -- 제품명 (분류용)
  entp_prd_nm          TEXT,                          -- 의뢰사 제품명
  prdn_cmpn_nm         TEXT,                          -- 제조사
  stsz_nm              TEXT,                          -- 규격
  mctl_no              TEXT,                          -- 기기번호
  cust_eqpm_srno       TEXT,                          -- 고객 장비 일련번호

  -- 상태/담당
  pgst_nm              TEXT,                          -- 진행상태
  prjc_cd              TEXT,                          -- 과제코드
  mngm_rspr_nm         TEXT,                          -- 담당자

  -- 비용
  total_sum            NUMERIC,                       -- 총액

  -- 그룹 (k-tools UI 그룹화 결과)
  group_nm             TEXT,
  group_cnt            INTEGER,

  -- 메타
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 인덱스 (자주 WHERE/GROUP BY 되는 컬럼만)
CREATE INDEX idx_items_pgst        ON ktools_items (pgst_nm);
CREATE INDEX idx_items_mngm_rspr   ON ktools_items (mngm_rspr_nm);
CREATE INDEX idx_items_prdn_cmpn   ON ktools_items (prdn_cmpn_nm);
CREATE INDEX idx_items_prjc        ON ktools_items (prjc_cd);
CREATE INDEX idx_items_rcpn        ON ktools_items (rcpn_ymd);
CREATE INDEX idx_items_nxtr_exrs   ON ktools_items (nxtr_exrs_ymd);
CREATE INDEX idx_items_exrs_wrtn   ON ktools_items (exrs_wrtn_ymd);

-- RLS 활성화 (service_role만 접근, anon 차단)
ALTER TABLE ktools_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- sync_runs (이미 생성된 경우 변경 없음, IF NOT EXISTS로 안전)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_runs (
  id                   BIGSERIAL PRIMARY KEY,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ,
  item_count           INTEGER,
  inserted_count       INTEGER,
  updated_count        INTEGER,
  status               TEXT NOT NULL,
  error_message        TEXT,
  triggered_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs (started_at DESC);
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
