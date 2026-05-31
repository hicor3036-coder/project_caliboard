-- =====================================================================
-- READ atom 보조용 RPC 함수
-- ─ supabase-js의 builder로는 표현 못 하는 집계를 함수로 감싼다
-- ─ 각 함수는 STABLE/IMMUTABLE 표시, service_role만 호출 (RLS는 ktools_items에 켜져 있음)
-- 작성: 2026-05-31
-- =====================================================================

-- ---------------------------------------------------------------------
-- avg_duration_days() — 교정 소요일 평균 (전체)
--   (exrs_wrtn_ymd - rcpn_ymd) 일수의 평균. 둘 다 NOT NULL이고 차이 >= 0인 row만.
--   반환: numeric (round는 호출자가 책임)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION avg_duration_days()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT avg(exrs_wrtn_ymd - rcpn_ymd)
  FROM ktools_items
  WHERE rcpn_ymd IS NOT NULL
    AND exrs_wrtn_ymd IS NOT NULL
    AND (exrs_wrtn_ymd - rcpn_ymd) >= 0;
$$;

-- ---------------------------------------------------------------------
-- duration_stats() — 교정 소요일 통계 (전체 + 제품별)
--   반환:
--   {
--     overall: { avg, median, max, count },
--     by_product: [{ prd_nm, avg, median, count }, ...]
--   }
--   ─ 제품별은 건수 >= 5 인 것만, avg 내림차순 top 20
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION duration_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH d AS (
    SELECT prd_nm,
           (exrs_wrtn_ymd - rcpn_ymd) AS days
    FROM ktools_items
    WHERE rcpn_ymd IS NOT NULL
      AND exrs_wrtn_ymd IS NOT NULL
      AND (exrs_wrtn_ymd - rcpn_ymd) >= 0
  ),
  overall AS (
    SELECT
      round(avg(days))::int                                              AS avg,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::int      AS median,
      max(days)::int                                                     AS max,
      count(*)::int                                                      AS count
    FROM d
  ),
  by_prd AS (
    SELECT
      coalesce(prd_nm, '(없음)')                                          AS prd_nm,
      round(avg(days))::int                                              AS avg,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::int      AS median,
      count(*)::int                                                      AS count
    FROM d
    GROUP BY prd_nm
    HAVING count(*) >= 5
    ORDER BY avg DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'overall',     (SELECT to_jsonb(overall) FROM overall),
    'by_product',  coalesce((SELECT jsonb_agg(to_jsonb(by_prd)) FROM by_prd), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- unprocessed_items() — 미처리 현황 + 체류일수 + 예상완료일
--   ─ pgst_nm ILIKE '%미처리%' 인 row
--   ─ 체류일수 = today - rcpn_ymd
--   ─ 예상완료일 = rcpn_ymd + (제품별 중앙값 소요일, 없으면 전체 중앙값)
--   ─ 남은일수 = 예상완료일 - today
--   ─ 체류일수 내림차순
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION unprocessed_items()
RETURNS TABLE (
  acpt_no          text,
  rcpn_ymd         date,
  stay_days        int,
  est_done_ymd     date,
  remaining_days   int,
  entp_prd_nm      text,
  prdn_cmpn_nm     text,
  stsz_nm          text,
  mctl_no          text,
  cust_eqpm_srno   text,
  mngm_rspr_nm     text,
  fnsh_scdl_ymd    date,
  group_nm         text,
  group_cnt        int
)
LANGUAGE sql
STABLE
AS $$
  WITH d AS (
    SELECT prd_nm,
           (exrs_wrtn_ymd - rcpn_ymd) AS days
    FROM ktools_items
    WHERE rcpn_ymd IS NOT NULL
      AND exrs_wrtn_ymd IS NOT NULL
      AND (exrs_wrtn_ymd - rcpn_ymd) >= 0
  ),
  overall_median AS (
    SELECT coalesce(
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::int,
      0
    ) AS m
    FROM d
  ),
  prd_median AS (
    SELECT prd_nm,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::int AS m
    FROM d
    GROUP BY prd_nm
  )
  SELECT
    i.acpt_no,
    i.rcpn_ymd,
    (CURRENT_DATE - i.rcpn_ymd)::int                                     AS stay_days,
    (i.rcpn_ymd + (coalesce(pm.m, om.m) || ' days')::interval)::date     AS est_done_ymd,
    ((i.rcpn_ymd + (coalesce(pm.m, om.m) || ' days')::interval)::date
       - CURRENT_DATE)::int                                              AS remaining_days,
    i.entp_prd_nm,
    i.prdn_cmpn_nm,
    i.stsz_nm,
    i.mctl_no,
    i.cust_eqpm_srno,
    i.mngm_rspr_nm,
    i.fnsh_scdl_ymd,
    i.group_nm,
    i.group_cnt
  FROM ktools_items i
  CROSS JOIN overall_median om
  LEFT JOIN prd_median pm ON pm.prd_nm = i.prd_nm
  WHERE i.pgst_nm ILIKE '%미처리%'
    AND i.rcpn_ymd IS NOT NULL
  ORDER BY stay_days DESC;
$$;

-- ---------------------------------------------------------------------
-- by_status() — 진행상태 분포
--   {label, value} 형태. value 내림차순. NULL/'' → '(없음)'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION by_status()
RETURNS TABLE (label text, value bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(pgst_nm, ''), '(없음)') AS label,
         count(*) AS value
  FROM ktools_items
  GROUP BY 1
  ORDER BY value DESC;
$$;

-- ---------------------------------------------------------------------
-- by_manager() — 담당자별 처리량 (상위 30명)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION by_manager()
RETURNS TABLE (label text, value bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(mngm_rspr_nm, ''), '(없음)') AS label,
         count(*) AS value
  FROM ktools_items
  GROUP BY 1
  ORDER BY value DESC
  LIMIT 30;
$$;

-- ---------------------------------------------------------------------
-- by_manufacturer() — 제조사별 분포 (상위 30개)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION by_manufacturer()
RETURNS TABLE (label text, value bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(prdn_cmpn_nm, ''), '(없음)') AS label,
         count(*) AS value
  FROM ktools_items
  GROUP BY 1
  ORDER BY value DESC
  LIMIT 30;
$$;

-- ---------------------------------------------------------------------
-- by_project() — 과제별 현황 (건수 + 총비용 합)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION by_project()
RETURNS TABLE (prjc_cd text, count bigint, total_sum numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(prjc_cd, ''), '(없음)') AS prjc_cd,
         count(*) AS count,
         coalesce(sum(total_sum), 0) AS total_sum
  FROM ktools_items
  GROUP BY 1
  ORDER BY count DESC;
$$;

-- ---------------------------------------------------------------------
-- monthly_trend() — 월별 접수 추이 (rcpn_ymd 기준)
--   {month: 'YYYY-MM', count}. month 오름차순.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monthly_trend()
RETURNS TABLE (month text, count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(rcpn_ymd, 'YYYY-MM') AS month,
         count(*) AS count
  FROM ktools_items
  WHERE rcpn_ymd IS NOT NULL
  GROUP BY 1
  ORDER BY 1;
$$;

-- ---------------------------------------------------------------------
-- upcoming_items() — 차기교정 임박 + 구간 분류 + 접수권장일
--   ─ nxtr_exrs_ymd NOT NULL 인 모든 row
--   ─ d_day = nxtr_exrs_ymd - today
--   ─ 접수권장일 = nxtr_exrs_ymd - (전체중앙값 + 14)
--   ─ 접수시급 = 접수권장일 <= today
--   ─ 구간: 장기경과 / 만료 / D-30 / D-60 / D-90 / D-90+
--   ─ d_day 오름차순 (가장 급한 게 위)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upcoming_items()
RETURNS TABLE (
  acpt_no          text,
  entp_prd_nm      text,
  prdn_cmpn_nm     text,
  stsz_nm          text,
  mctl_no          text,
  cust_eqpm_srno   text,
  nxtr_exrs_ymd    date,
  d_day            int,
  reco_rcpn_ymd    date,
  urgent           boolean,
  bucket           text,
  group_nm         text,
  group_cnt        int
)
LANGUAGE sql
STABLE
AS $$
  WITH d AS (
    SELECT (exrs_wrtn_ymd - rcpn_ymd) AS days
    FROM ktools_items
    WHERE rcpn_ymd IS NOT NULL
      AND exrs_wrtn_ymd IS NOT NULL
      AND (exrs_wrtn_ymd - rcpn_ymd) >= 0
  ),
  overall_median AS (
    SELECT coalesce(
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::int,
      0
    ) AS m
    FROM d
  )
  SELECT
    i.acpt_no,
    i.entp_prd_nm,
    i.prdn_cmpn_nm,
    i.stsz_nm,
    i.mctl_no,
    i.cust_eqpm_srno,
    i.nxtr_exrs_ymd,
    (i.nxtr_exrs_ymd - CURRENT_DATE)::int                                AS d_day,
    (i.nxtr_exrs_ymd - ((om.m + 14) || ' days')::interval)::date         AS reco_rcpn_ymd,
    (i.nxtr_exrs_ymd - ((om.m + 14) || ' days')::interval)::date
       <= CURRENT_DATE                                                   AS urgent,
    CASE
      WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) < -730 THEN '장기경과'
      WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 0   THEN '만료'
      WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 30  THEN 'D-30'
      WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 60  THEN 'D-60'
      WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 90  THEN 'D-90'
      ELSE 'D-90+'
    END                                                                  AS bucket,
    i.group_nm,
    i.group_cnt
  FROM ktools_items i
  CROSS JOIN overall_median om
  WHERE i.nxtr_exrs_ymd IS NOT NULL
  ORDER BY d_day ASC;
$$;
