# -*- coding: utf-8 -*-
"""
Created on Thu Feb 12 2026

@author: hicor
교정 데이터 분석 모듈
"""

import pandas as pd
from datetime import datetime, timedelta
from ktools_login import ktools_login
from ktools_수집 import fetch_all


# =============================================================================
# 데이터 수집 & 전처리
# =============================================================================

def load_data():
    """k-tools에서 전체 데이터 수집 → DataFrame 변환"""
    session = ktools_login('hicor', 'dlacodnr1!')
    raw = fetch_all(session)
    df = pd.DataFrame(raw)

    # 날짜 컬럼 변환 (YYYYMMDD 문자열 → datetime)
    date_cols = ['rcpnYmd', 'exrsWrtnYmd', 'fnshScdlYmd', 'nxtrExrsYmd',
                 'snctYmd', 'isncYmd', 'smplOutDate', 'rectYmd']
    for col in date_cols:
        df[col] = pd.to_datetime(df[col], format='%Y%m%d', errors='coerce')

    return df


# =============================================================================
# Priority 1: 핵심 분석
# =============================================================================

def 미처리현황(df):
    """미처리 건 필터링 + 체류일수 계산 (오래된 순)"""
    today = datetime.now()
    미처리 = df[df['pgstNm'].str.contains('미처리', na=False)].copy()
    미처리['체류일수'] = (today - 미처리['rcpnYmd']).dt.days
    미처리 = 미처리.sort_values('체류일수', ascending=False)

    cols = ['acptNo', 'rcpnYmd', '체류일수', 'entpPrdNm', 'prdnCmpnNm',
            'stszNm', 'mngmRsprNm', 'fnshScdlYmd']
    print(f'\n=== 미처리 현황: {len(미처리)}건 ===')
    print(미처리[cols].to_string(index=False))
    return 미처리


def 교정소요기간(df):
    """접수일 → 성적서작성일 소요기간 통계"""
    완료 = df[df['exrsWrtnYmd'].notna()].copy()
    완료['소요일수'] = (완료['exrsWrtnYmd'] - 완료['rcpnYmd']).dt.days
    # 음수/이상치 제거
    완료 = 완료[완료['소요일수'] >= 0]

    print('\n=== 교정 소요기간 통계 ===')
    print(완료['소요일수'].describe().round(1))

    # 제품별 평균 소요기간
    제품별 = 완료.groupby('prdNm')['소요일수'].agg(['mean', 'median', 'count'])
    제품별 = 제품별[제품별['count'] >= 5].sort_values('mean', ascending=False)
    제품별.columns = ['평균', '중앙값', '건수']
    print('\n--- 제품별 평균 소요기간 (5건 이상) ---')
    print(제품별.round(1).head(20).to_string())

    return 완료


def 차기교정임박(df):
    """차기교정일 임박 건 분류 (D-30/60/90) + 스마트 알림"""
    today = datetime.now()

    # 차기교정일이 있는 건만
    대상 = df[df['nxtrExrsYmd'].notna()].copy()
    대상['D_day'] = (대상['nxtrExrsYmd'] - today).dt.days

    # 소요기간 통계 (스마트 알림용)
    완료 = df[(df['exrsWrtnYmd'].notna()) & (df['rcpnYmd'].notna())].copy()
    완료['소요일수'] = (완료['exrsWrtnYmd'] - 완료['rcpnYmd']).dt.days
    완료 = 완료[완료['소요일수'] >= 0]
    평균소요일 = int(완료['소요일수'].median())  # 중앙값 사용
    여유일 = 14  # 접수 준비 여유일

    # 접수 권장일 = 차기교정일 - 평균소요일 - 여유일
    대상['접수권장일'] = 대상['nxtrExrsYmd'] - timedelta(days=평균소요일 + 여유일)
    대상['접수시급'] = 대상['접수권장일'] <= today

    # D-day 구간 분류
    d30 = 대상[(대상['D_day'] >= 0) & (대상['D_day'] <= 30)]
    d60 = 대상[(대상['D_day'] > 30) & (대상['D_day'] <= 60)]
    d90 = 대상[(대상['D_day'] > 60) & (대상['D_day'] <= 90)]
    만료 = 대상[대상['D_day'] < 0]

    print(f'\n=== 차기교정 임박 알림 (평균소요 {평균소요일}일 + 여유 {여유일}일 기준) ===')
    print(f'  이미 만료: {len(만료)}건')
    print(f'  D-30 이내: {len(d30)}건')
    print(f'  D-31~60:   {len(d60)}건')
    print(f'  D-61~90:   {len(d90)}건')

    # 접수 시급 건
    시급 = 대상[대상['접수시급']].sort_values('D_day')
    cols = ['acptNo', 'entpPrdNm', 'nxtrExrsYmd', 'D_day', '접수권장일']
    if len(시급) > 0:
        print(f'\n--- 즉시 접수 필요: {len(시급)}건 ---')
        print(시급[cols].head(20).to_string(index=False))

    return 대상


# =============================================================================
# Priority 2: 일반 현황
# =============================================================================

def 진행상태분포(df):
    """pgstNm별 건수/비율"""
    분포 = df['pgstNm'].value_counts()
    비율 = df['pgstNm'].value_counts(normalize=True).mul(100).round(1)
    result = pd.DataFrame({'건수': 분포, '비율(%)': 비율})
    print('\n=== 진행상태 분포 ===')
    print(result.to_string())
    return result


def 월별접수추이(df):
    """rcpnYmd 기준 월별 접수 건수"""
    df_valid = df[df['rcpnYmd'].notna()].copy()
    df_valid['접수월'] = df_valid['rcpnYmd'].dt.to_period('M')
    월별 = df_valid.groupby('접수월').size()
    print('\n=== 월별 접수 추이 (최근 12개월) ===')
    print(월별.tail(12).to_string())
    return 월별


def 과제별현황(df):
    """prjcCd별 건수, 총비용"""
    과제 = df.groupby('prjcCd').agg(
        건수=('acptNo', 'count'),
        총비용=('totalSum', 'sum')
    ).sort_values('건수', ascending=False)
    print('\n=== 과제별 현황 ===')
    print(과제.to_string())
    return 과제


def 제조사별분포(df):
    """prdnCmpnNm별 건수 Top 20"""
    제조사 = df['prdnCmpnNm'].value_counts().head(20)
    print('\n=== 제조사별 분포 (Top 20) ===')
    print(제조사.to_string())
    return 제조사


def 담당자별처리량(df):
    """mngmRsprNm별 건수"""
    담당자 = df['mngmRsprNm'].value_counts()
    print('\n=== 담당자별 처리량 ===')
    print(담당자.to_string())
    return 담당자


# =============================================================================
# 실행
# =============================================================================

if __name__ == '__main__':
    print('데이터 수집 중...')
    df = load_data()
    print(f'총 {len(df)}건 로드 완료\n')

    # Priority 1
    미처리현황(df)
    교정소요기간(df)
    차기교정임박(df)

    # Priority 2
    진행상태분포(df)
    월별접수추이(df)
    과제별현황(df)
    제조사별분포(df)
    담당자별처리량(df)
