-- =====================================================================
-- upcoming_items()의 PostgREST 1000건 자동 한도 문제 회피
-- ─ 기존 upcoming_items()는 d_day 오름차순으로 만료/장기경과부터 잘려
--   D-30/60/90 구간이 limit 1000에 밀려나는 현상 발견
-- ─ counts는 SQL에서 전수 집계, items는 d_day >= -730 + 상한 파라미터로 제어
-- 작성: 2026-05-31
-- =====================================================================

-- ---------------------------------------------------------------------
-- upcoming_summary(p_limit int default 5000)
--   ─ counts: 전체 row에서 구간별 카운트 (1000건 한도 영향 X)
--   ─ urgent_count: 전체 row에서 urgent=true 카운트
--   ─ items: d_day 오름차순 상위 p_limit건 (장기경과는 제외 — 액션 가능한 것만)
--
--   반환 (jsonb):
--   {
--     counts: {장기경과, 만료, D-30, D-60, D-90, D-90+},
--     urgent_count: number,
--     items: UpcomingRow[]
--   }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upcoming_summary(p_limit int DEFAULT 5000)
RETURNS jsonb
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
  ),
  base AS (
    SELECT
      i.acpt_no,
      i.entp_prd_nm,
      i.prdn_cmpn_nm,
      i.stsz_nm,
      i.mctl_no,
      i.cust_eqpm_srno,
      i.nxtr_exrs_ymd,
      (i.nxtr_exrs_ymd - CURRENT_DATE)::int                              AS d_day,
      (i.nxtr_exrs_ymd - ((om.m + 14) || ' days')::interval)::date       AS reco_rcpn_ymd,
      (i.nxtr_exrs_ymd - ((om.m + 14) || ' days')::interval)::date
         <= CURRENT_DATE                                                 AS urgent,
      CASE
        WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) < -730 THEN '장기경과'
        WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 0   THEN '만료'
        WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 30  THEN 'D-30'
        WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 60  THEN 'D-60'
        WHEN (i.nxtr_exrs_ymd - CURRENT_DATE) <= 90  THEN 'D-90'
        ELSE 'D-90+'
      END                                                                AS bucket,
      i.group_nm,
      i.group_cnt
    FROM ktools_items i
    CROSS JOIN overall_median om
    WHERE i.nxtr_exrs_ymd IS NOT NULL
  ),
  counts_cte AS (
    SELECT
      jsonb_build_object(
        '장기경과', count(*) FILTER (WHERE bucket = '장기경과'),
        '만료',     count(*) FILTER (WHERE bucket = '만료'),
        'D-30',     count(*) FILTER (WHERE bucket = 'D-30'),
        'D-60',     count(*) FILTER (WHERE bucket = 'D-60'),
        'D-90',     count(*) FILTER (WHERE bucket = 'D-90'),
        'D-90+',    count(*) FILTER (WHERE bucket = 'D-90+')
      )                                                                  AS counts,
      count(*) FILTER (WHERE urgent)::int                                AS urgent_count
    FROM base
  ),
  picked AS (
    SELECT *
    FROM base
    WHERE bucket <> '장기경과'  -- 2년 이상 지난 건 액션 불가능 → items에선 제외
    ORDER BY d_day ASC
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'counts',       (SELECT counts FROM counts_cte),
    'urgent_count', (SELECT urgent_count FROM counts_cte),
    'items',        coalesce((SELECT jsonb_agg(to_jsonb(picked)) FROM picked), '[]'::jsonb)
  );
$$;
