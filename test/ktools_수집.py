# -*- coding: utf-8 -*-
"""
Created on Thu Feb 12 11:27:59 2026

@author: hicor
"""

import json
from ktools_login import ktools_login

USER_ID = 'hicor'
USER_PWD = 'dlacodnr1!'

# KAI 과제코드 목록
PRJC_CD_LIST = '[KL151000, KL161020, KL171020, KL171140, KL180940, KL181200, KL211420, KL221490, KL231360, KL241520, KL251650]'


def fetch_page(session, page=0, page_count=3000):
    """단일 페이지 조회
    - page: 시작 인덱스 (0, 1000, 2000, ...)
    - page_count: 한 번에 가져올 건수
    - 반환: 응답 JSON dict
    """
    data = {
        'page': str(page),           # 시작 인덱스 (offset)
        'pageCount': str(page_count), # 페이지당 건수
        'startDt': '',
        'endDt': '',
        'entpPrdNm': '',
        'prdnCmpnNm': '',
        'stszNm': '',
        'acptNo': '',
        'cnsnClsIdx': '32',           # KAI 과제 고유 번호
        'prjcCdList': PRJC_CD_LIST,
    }

    response = session.post(
        'https://k-tools.ktl.re.kr/spm/api/spm0907_getConsignCnfrmRvfrmList.ajax',
        data=data,
    )

    return json.loads(response.text)


def fetch_all(session, page_count=3000):
    """전체 데이터 순회 조회
    - page를 page_count씩 증가시키며 isEnd=True까지 반복
    - 401 세션 만료 시 자동 재로그인
    - 반환: 전체 list (dict 목록)
    """
    all_list = []
    page = 0

    while True:
        result = fetch_page(session, page, page_count)

        # 세션 만료 → 재로그인 후 같은 페이지 재시도
        if result.get('code') == 401:
            print('세션 만료 - 재로그인 시도')
            session = ktools_login(USER_ID, USER_PWD, session)
            result = fetch_page(session, page, page_count)

        items = result['data']['list']
        all_list.extend(items)

        total = result['data']['totalCount']
        print(f'  page={page}, 수신={len(items)}건, 누적={len(all_list)}/{total}건')

        # isEnd가 큰 pageCount에서 부정확 → totalCount 기준으로 판단
        if len(items) == 0 or len(all_list) >= total:
            break

        page += page_count  # 다음 페이지 offset

    print(f'수집 완료: 총 {len(all_list)}건')
    return all_list


if __name__ == '__main__':
    session = ktools_login(USER_ID, USER_PWD)
    all_data = fetch_all(session)
