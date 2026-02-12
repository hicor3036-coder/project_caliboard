# -*- coding: utf-8 -*-
"""
Created on Thu Feb 12 11:27:38 2026

@author: hicor
"""

import requests


def ktools_login(user_id, user_pwd, session=None):
    if session is None:
        session = requests.Session()

    session.headers.update({
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://k-tools.ktl.re.kr',
        'Referer': 'https://k-tools.ktl.re.kr/spm/contents/login01.do',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
    })

    data = f'userId={user_id}&userPwd={user_pwd}'

    session.post(
        'https://k-tools.ktl.re.kr/spm/module/login01_spmLoginProc.ajax',
        data=data,
    )

    return session


if __name__ == '__main__':
    session = ktools_login('hicor', 'dlacodnr1!')
    jsessionid = session.cookies.get('KTOOLS_JSESSIONID')
    print(f'KTOOLS_JSESSIONID: {jsessionid}')
