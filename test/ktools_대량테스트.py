# -*- coding: utf-8 -*-
"""
교정성적서 대량 다운로드 & 파싱 테스트
- API 부하/속도 측정
- 파싱 성공률/실패 패턴 분석
- 적합성검토서 구조 통계
"""

import sys
import io
import json
import time
import random
from collections import Counter
from ktools_login import ktools_login
from ktools_수집 import fetch_all
from ktools_성적서 import make_api_acpt_no, download_cert_excel, parse_cert_excel

if sys.platform == 'win32' and not isinstance(sys.stdout, io.TextIOWrapper):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

USER_ID = 'hicor'
USER_PWD = 'dlacodnr1!'
BASE_URL = 'https://k-tools.ktl.re.kr'

# 테스트 설정
SAMPLE_SIZE = 100        # 테스트할 건수
DELAY_BETWEEN = 0.3      # API 호출 간 딜레이 (초) — 서버 부하 방지


def run_bulk_test():
    print('=' * 70)
    print(f'교정성적서 대량 테스트 ({SAMPLE_SIZE}건)')
    print('=' * 70)

    # 1. 로그인 & 데이터 수집
    print('\n[1] 데이터 수집...')
    session = ktools_login(USER_ID, USER_PWD)
    session.get(f'{BASE_URL}/spm/contents/spm0907.do?cnsnClsIdx=32')
    all_data = fetch_all(session)

    completed = [d for d in all_data if '완료' in d.get('pgstNm', '')]
    print(f'    전체: {len(all_data)}건, 완료: {len(completed)}건')

    # 2. 샘플링 — 다양한 장비 유형 + 랜덤
    random.seed(42)
    samples = random.sample(completed, min(SAMPLE_SIZE, len(completed)))
    print(f'    샘플: {len(samples)}건 (랜덤)')

    # 3. 대량 테스트
    print(f'\n[2] 대량 다운로드 & 파싱 시작...\n')

    results = []
    download_times = []
    parse_times = []

    # 통계 카운터
    stats = {
        'download_ok': 0,
        'download_fail': 0,
        'parse_ok': 0,
        'parse_fail': 0,
        'conformity_yes': 0,
        'conformity_no': 0,
        'cross_ok': 0,
        'cross_mismatch': 0,
        'all_pass': 0,
        'has_fail': 0,
        'no_measurements': 0,
    }
    sheet_counts = Counter()        # 시트 수 분포
    measurement_counts = []         # 측정포인트 수
    conformity_sheet_counts = Counter()  # 적합성검토서 시트 수
    fail_reasons = []               # 실패 원인
    mismatch_details = []           # 교차검증 불일치 상세

    total_start = time.time()
    relogin_count = 0

    for i, d in enumerate(samples):
        api_acpt = make_api_acpt_no(d)
        prd = d.get('entpPrdNm', '')[:35]
        progress = f'[{i+1}/{len(samples)}]'

        # 다운로드
        t0 = time.time()
        try:
            excel = download_cert_excel(session, api_acpt)
        except Exception as e:
            # 세션 만료 시 재로그인
            if '401' in str(e) or 'token' in str(e).lower():
                print(f'  {progress} 세션 만료 — 재로그인')
                session = ktools_login(USER_ID, USER_PWD)
                session.get(f'{BASE_URL}/spm/contents/spm0907.do?cnsnClsIdx=32')
                relogin_count += 1
                try:
                    excel = download_cert_excel(session, api_acpt)
                except Exception:
                    excel = None
            else:
                excel = None

        dl_time = time.time() - t0
        download_times.append(dl_time)

        if not excel:
            stats['download_fail'] += 1
            fail_reasons.append({'acptNo': api_acpt, '단계': '다운로드', '원인': 'Excel 변환/다운로드 실패'})
            print(f'  {progress} NG  {api_acpt:22s}  다운로드실패  {prd}')
            time.sleep(DELAY_BETWEEN)
            continue

        stats['download_ok'] += 1

        # 파싱
        t1 = time.time()
        try:
            cert = parse_cert_excel(excel)
            parse_time = time.time() - t1
            parse_times.append(parse_time)
            stats['parse_ok'] += 1
        except Exception as e:
            parse_time = time.time() - t1
            stats['parse_fail'] += 1
            fail_reasons.append({'acptNo': api_acpt, '단계': '파싱', '원인': str(e)[:100]})
            print(f'  {progress} NG  {api_acpt:22s}  파싱실패: {str(e)[:50]}  {prd}')
            time.sleep(DELAY_BETWEEN)
            continue

        # 통계 수집
        sheet_counts[cert['시트수']] += 1

        if cert['적합성검토']:
            stats['conformity_yes'] += 1

            # 적합성검토서가 몇 장인지 (마지막 시트에서 페이지 표시 확인)
            # 간단히: 전체 시트 - 갑지(1) - 을지(나머지) = 적합성검토
            # 실제로는 Conformity가 있는 시트 수를 세야 하지만 지금은 1장으로 가정

            if cert.get('불일치'):
                stats['cross_mismatch'] += 1
                for m in cert['불일치']:
                    mismatch_details.append({
                        'acptNo': api_acpt,
                        **m
                    })
            else:
                stats['cross_ok'] += 1

            if cert['측정포인트수'] > 0:
                measurement_counts.append(cert['측정포인트수'])
                if cert['전체판정'] == 'PASS':
                    stats['all_pass'] += 1
                else:
                    stats['has_fail'] += 1
            else:
                stats['no_measurements'] += 1
        else:
            stats['conformity_no'] += 1

        # 핵심 필드 추출 확인
        missing = []
        for field in ['성적서번호', '제조사', '모델', '시리얼', '교정일']:
            if not cert.get(field):
                missing.append(field)

        status = 'OK' if not missing else f'부분({",".join(missing)})'
        judge = cert.get('전체판정', '-') or '-'
        pts = cert.get('측정포인트수', 0)
        conf = 'O' if cert['적합성검토'] else 'X'

        print(f'  {progress} {status:20s}  {api_acpt:22s}  {cert["시트수"]}시트  적합{conf}  {pts:3d}pt  {judge:4s}  {dl_time:.1f}s  {prd}')

        results.append(cert)
        time.sleep(DELAY_BETWEEN)

    total_time = time.time() - total_start

    # 4. 결과 리포트
    print(f'\n{"="*70}')
    print(f'테스트 결과 리포트')
    print(f'{"="*70}')

    print(f'\n--- 처리 현황 ---')
    print(f'  테스트 건수:   {len(samples)}')
    print(f'  다운로드 성공: {stats["download_ok"]}  실패: {stats["download_fail"]}  ({stats["download_ok"]/len(samples)*100:.1f}%)')
    print(f'  파싱 성공:     {stats["parse_ok"]}  실패: {stats["parse_fail"]}  ({stats["parse_ok"]/max(stats["download_ok"],1)*100:.1f}%)')
    print(f'  재로그인 횟수: {relogin_count}')

    print(f'\n--- 속도 ---')
    print(f'  총 소요시간:       {total_time:.0f}초 ({total_time/60:.1f}분)')
    print(f'  건당 평균(다운):   {sum(download_times)/max(len(download_times),1):.2f}초')
    print(f'  건당 평균(파싱):   {sum(parse_times)/max(len(parse_times),1):.3f}초')
    avg_per_item = total_time / len(samples) if samples else 0
    print(f'  건당 평균(전체):   {avg_per_item:.2f}초')
    print(f'  시간당 처리량:     {3600/avg_per_item:.0f}건/시간' if avg_per_item > 0 else '')

    print(f'\n--- 적합성검토서 ---')
    print(f'  있음: {stats["conformity_yes"]}  없음: {stats["conformity_no"]}  ({stats["conformity_yes"]/max(stats["parse_ok"],1)*100:.1f}%)')

    print(f'\n--- 교차검증 (갑지 vs 적합성검토) ---')
    print(f'  일치: {stats["cross_ok"]}  불일치: {stats["cross_mismatch"]}')
    if mismatch_details:
        mismatch_fields = Counter(m['항목'] for m in mismatch_details)
        print(f'  불일치 항목별: {dict(mismatch_fields)}')
        print(f'  불일치 상세 (최대 10건):')
        for m in mismatch_details[:10]:
            print(f'    {m["acptNo"]:22s}  [{m["항목"]}] 갑지="{m["갑지"][:30]}" vs 적합성="{m["적합성검토"][:30]}"')

    print(f'\n--- 측정 결과 ---')
    print(f'  전체 PASS: {stats["all_pass"]}  FAIL 포함: {stats["has_fail"]}  측정없음: {stats["no_measurements"]}')
    if measurement_counts:
        print(f'  측정포인트 수: 평균={sum(measurement_counts)/len(measurement_counts):.1f}  '
              f'최소={min(measurement_counts)}  최대={max(measurement_counts)}')

    print(f'\n--- 시트 수 분포 ---')
    for cnt in sorted(sheet_counts.keys()):
        bar = '#' * sheet_counts[cnt]
        print(f'  {cnt}시트: {sheet_counts[cnt]:4d}건  {bar}')

    print(f'\n--- 핵심 필드 추출율 ---')
    field_counts = Counter()
    for cert in results:
        for field in ['성적서번호', '고객명', '장비명', '제조사', '모델', '시리얼', '관리번호', '교정일', '차기교정일']:
            if cert.get(field):
                field_counts[field] += 1
    total_parsed = len(results)
    for field in ['성적서번호', '고객명', '장비명', '제조사', '모델', '시리얼', '관리번호', '교정일', '차기교정일']:
        cnt = field_counts.get(field, 0)
        pct = cnt / max(total_parsed, 1) * 100
        bar = '#' * int(pct / 2)
        print(f'  {field:10s}: {cnt:4d}/{total_parsed}  ({pct:5.1f}%)  {bar}')

    if fail_reasons:
        print(f'\n--- 실패 상세 (최대 20건) ---')
        for f in fail_reasons[:20]:
            print(f'  {f["acptNo"]:22s}  [{f["단계"]}] {f["원인"][:60]}')

    # 5. JSON 저장
    report = {
        'sample_size': len(samples),
        'stats': stats,
        'speed': {
            'total_seconds': round(total_time, 1),
            'avg_download_sec': round(sum(download_times)/max(len(download_times),1), 2),
            'avg_parse_sec': round(sum(parse_times)/max(len(parse_times),1), 3),
            'items_per_hour': round(3600/avg_per_item) if avg_per_item > 0 else 0,
        },
        'sheet_distribution': dict(sheet_counts),
        'mismatches': mismatch_details,
        'failures': fail_reasons,
    }
    report_path = 'e:/2. hicor/Python/project_caliboard/test/bulk_test_report.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f'\n리포트 저장: {report_path}')

    print(f'\n{"="*70}')
    print(f'테스트 완료')
    print(f'{"="*70}')


if __name__ == '__main__':
    run_bulk_test()
