# -*- coding: utf-8 -*-
"""
Created on Sat Feb 22 2026

@author: hicor
교정성적서 Excel 다운로드 & 파싱
- 로그인 → 토큰 발급 → PDF→Excel 변환 → 다운로드 → 파싱
- 갑지(기본정보) + 적합성검토서(Conformity Review) 위주로 파싱
- 2차 시도: 규칙기반 실패 시 Mistral LLM API로 보강
"""

import sys
import io
import json
import time
import requests
import openpyxl
from io import BytesIO
from ktools_login import ktools_login

# Windows 콘솔 인코딩 문제 방지 (Spyder IDE 호환)
if sys.platform == 'win32' and hasattr(sys.stdout, 'buffer') and not isinstance(sys.stdout, io.TextIOWrapper):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

USER_ID = 'hicor'
USER_PWD = 'dlacodnr1!'
BASE_URL = 'https://k-tools.ktl.re.kr'

# Mistral LLM API 설정
MISTRAL_API_KEY = '8GmClOHJYZr3PpZUAunyzQykOJPghT8D'
MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions'
MISTRAL_MODEL = 'mistral-small-latest'

# LLM fallback 발동 기준: 핵심 필드 중 이 개수 이상 누락 시 LLM 호출
LLM_MISSING_THRESHOLD = 2
LLM_KEY_FIELDS = ['제조사', '모델', '시리얼', '교정일']


# =============================================================================
# API 함수
# =============================================================================

def get_token(session):
    """보안 토큰 발급"""
    res = session.post(f'{BASE_URL}/spm/api/getSecToken')
    data = res.json()
    if data.get('code') != 200:
        raise Exception(f'토큰 발급 실패: {data}')
    return data['data']['token']


def make_api_acpt_no(item):
    """DB 데이터에서 API용 접수번호 생성 (끝자리 zero-padding 제거)
    DB: acptNo='26-010119-02-012' → API: '26-010119-02-12'
    """
    return f'{item["incsRcpnSrno"]}-{int(item["rcpnArtcSrno"])}'


def download_cert_excel(session, api_acpt_no):
    """교정성적서 Excel 다운로드
    1) PDF→Excel 변환 요청 (서버에서 변환)
    2) 변환된 Excel 파일 다운로드
    반환: Excel 바이트 또는 None (실패 시)
    """
    token = get_token(session)

    # Step 1: 변환 요청
    convert_res = session.post(
        f'{BASE_URL}/spm/api/spm0907_saveReportCardPdfToExcel.ajax',
        data=f'acptNo={api_acpt_no}&token={token}',
    )
    result = convert_res.json()
    if result.get('code') != 200:
        return None

    # Step 2: 다운로드
    download_res = session.get(f'{BASE_URL}/excel/getAcptNoPdfToExcel.do')
    content_type = download_res.headers.get('Content-Type', '')
    if 'spreadsheet' not in content_type:
        return None

    return download_res.content


# =============================================================================
# LLM 백업 파서 (Mistral API)
# =============================================================================

_LLM_SYSTEM_PROMPT = """You are a calibration certificate data extraction assistant.
You will receive the text content of a calibration certificate Excel file (converted from PDF).
The certificate may contain:
- 갑지 (Cover page): basic equipment info
- 을지 (Calibration results): measurement data (may be multiple pages)
- 적합성검토서 (Conformity Review): PASS/FAIL results (last page, optional)

Extract ALL available information and return a JSON object with these fields:
{
  "성적서번호": "certificate number",
  "고객명": "client/customer name",
  "장비명": "equipment description",
  "제조사": "manufacturer",
  "모델": "model name",
  "시리얼": "serial number",
  "관리번호": "identification/management number",
  "교정일": "date of calibration",
  "차기교정일": "next calibration date",
  "전체판정": "PASS" or "FAIL" or null,
  "측정요약": "brief summary of measurements in Korean (1-2 sentences)"
}

Rules:
- Return ONLY the JSON object, no additional text
- If a field is not found, use null
- Dates should be in original format
- For 전체판정: PASS only if ALL measurement points passed, FAIL if any failed"""


def _excel_to_text(excel_bytes):
    """Excel 바이트 → 시트별 텍스트 변환 (LLM 입력용)"""
    wb = openpyxl.load_workbook(BytesIO(excel_bytes))
    parts = []
    for sn in wb.sheetnames:
        ws = wb[sn]
        lines = [f'=== Sheet: {sn} ===']
        for row in ws.iter_rows(values_only=True):
            vals = [str(v).strip() if v is not None else '' for v in row]
            if not any(vals):
                continue
            lines.append(' | '.join(vals))
        parts.append('\n'.join(lines))
    wb.close()
    return '\n\n'.join(parts)


def _call_mistral(prompt, system_prompt=None, temperature=0.0, max_tokens=2000):
    """Mistral API 호출 → 응답 텍스트 반환"""
    messages = []
    if system_prompt:
        messages.append({'role': 'system', 'content': system_prompt})
    messages.append({'role': 'user', 'content': prompt})

    payload = {
        'model': MISTRAL_MODEL,
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
        'response_format': {'type': 'json_object'},
    }
    headers = {
        'Authorization': f'Bearer {MISTRAL_API_KEY}',
        'Content-Type': 'application/json',
    }

    res = requests.post(MISTRAL_URL, json=payload, headers=headers, timeout=30)
    if res.status_code != 200:
        raise Exception(f'Mistral API {res.status_code}: {res.text[:200]}')

    data = res.json()
    return data['choices'][0]['message']['content']


def _llm_parse(excel_bytes):
    """Mistral LLM으로 교정성적서 파싱 (2차 시도용)
    반환: dict (필드명: 값) 또는 None (실패 시)
    """
    try:
        text = _excel_to_text(excel_bytes)
        if len(text) > 8000:
            text = text[:8000] + '\n... (truncated)'

        content = _call_mistral(
            f'다음은 교정성적서 Excel 파일의 내용입니다. 정보를 추출해주세요.\n\n{text}',
            system_prompt=_LLM_SYSTEM_PROMPT,
        )

        # JSON 파싱
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start = content.find('{')
            end = content.rfind('}') + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
            return None
    except Exception:
        return None


def _llm_supplement(result, excel_bytes):
    """규칙기반 결과에 LLM으로 누락 필드 보강

    핵심 필드 중 LLM_MISSING_THRESHOLD 이상 누락 시 LLM 호출.
    LLM 결과로 빈 필드만 채움 (기존 규칙기반 결과 우선).
    반환: (보강된 result, llm_used: bool)
    """
    missing = [f for f in LLM_KEY_FIELDS if not result.get(f)]
    if len(missing) < LLM_MISSING_THRESHOLD:
        return result, False

    llm = _llm_parse(excel_bytes)
    if not llm:
        return result, False

    # 누락 필드만 LLM으로 보강
    FILL_FIELDS = ['성적서번호', '고객명', '장비명', '제조사', '모델',
                   '시리얼', '관리번호', '교정일', '차기교정일', '전체판정']
    filled = []
    for f in FILL_FIELDS:
        if not result.get(f) and llm.get(f) and str(llm[f]) != 'null':
            result[f] = str(llm[f])
            filled.append(f)

    # 측정요약은 항상 LLM에서 가져옴 (규칙기반에는 없는 필드)
    if llm.get('측정요약') and str(llm['측정요약']) != 'null':
        result['측정요약'] = str(llm['측정요약'])

    result['_llm_보강'] = filled
    return result, True


# =============================================================================
# 파싱 함수
# =============================================================================

def _find_conformity_sheet(wb):
    """적합성검토서 시트 찾기 (마지막 시트에서 역순 탐색)"""
    for sn in reversed(wb.sheetnames):
        ws = wb[sn]
        for row in ws.iter_rows(max_row=3, values_only=True):
            joined = ' '.join(str(v) for v in row if v).upper()
            if 'CONFORMITY' in joined:
                return ws
    return None


def _parse_cover(wb):
    """갑지 (Page 1) 파싱 — 기본 정보 추출"""
    info = {}
    ws = wb['Page 1'] if 'Page 1' in wb.sheetnames else wb[wb.sheetnames[0]]

    cells = {}
    for row in ws.iter_rows(values_only=False):
        for cell in row:
            if cell.value is not None:
                cells[(cell.row, cell.column)] = str(cell.value).strip()

    found_client = False
    for (r, c), val in sorted(cells.items()):
        # 성적서번호
        if 'Certificate No' in val and ':' in val:
            info['성적서번호'] = val.split(':')[-1].strip()
        elif '성적서 번호' in val and ':' in val:
            info['성적서번호'] = val.split(':')[-1].strip()

        # Client 섹션 감지
        if 'Client' in val:
            found_client = True

        # 고객명 — Client 섹션 아래의 Name
        if found_client and ('Name' in val and 'Model' not in val and ':' in val):
            name_val = cells.get((r, c + 2)) or cells.get((r, c + 1))
            if name_val and '고객명' not in info:
                info['고객명'] = name_val
            found_client = False  # 첫 번째 Name만

        # 장비명
        if 'Description' in val and ':' in val:
            desc_val = cells.get((r, c + 2)) or cells.get((r, c + 1))
            if desc_val and '장비명' not in info:
                info['장비명'] = desc_val

        # 제조사/모델
        if 'Manufacturer and Model' in val:
            model_val = cells.get((r, c + 4)) or cells.get((r, c + 3)) or cells.get((r, c + 2))
            if model_val:
                parts = model_val.split('/')
                info['제조사'] = parts[0].strip()
                info['모델'] = parts[1].strip() if len(parts) > 1 else ''

        # 시리얼
        if val.startswith('Serial Number') or val.startswith('시리얼') or '일련번호' in val:
            sn_val = cells.get((r, c + 2)) or cells.get((r, c + 1))
            if sn_val and '시리얼' not in info:
                info['시리얼'] = sn_val.split('[')[0].strip()
                if '[' in str(sn_val):
                    info['관리번호'] = str(sn_val).split(':')[-1].strip().rstrip(']')

        # 교정일
        if 'Date of Calibration' in val or '교정일자' in val:
            date_val = cells.get((r, c + 3)) or cells.get((r, c + 2)) or cells.get((r, c + 1))
            if date_val and '교정일' not in info:
                info['교정일'] = str(date_val).strip()

    # 후처리: 영문 라벨이 값으로 잘못 파싱된 경우 제거
    BAD_VALUES = {'Serial Number', 'The due date', 'Manufacturer', 'Model',
                  'Description', 'Date of Calibration', 'Certificate No',
                  'Identification Number', 'Client', 'Name'}
    for key in list(info.keys()):
        if info[key] in BAD_VALUES:
            del info[key]

    return info


def _parse_conformity(ws):
    """적합성검토서 파싱 — 장비정보 + 측정결과 + PASS/FAIL"""
    info = {}
    measurements = []

    rows = list(ws.iter_rows(values_only=True))

    # --- 장비 헤더 영역 파싱 ---
    # 적합성검토서 헤더는 2가지 레이아웃이 있음:
    # 패턴A: ['DYTRAN', 'Model', '3273A2', 'Description', 'Vibration transducers']
    #         ['Manufacturer']
    # 패턴B: ['Manufacturer', 'KULITE', 'Model', 'HKL-375-100A', 'Description', '...']
    #
    # 공통: Manufacturer/Model/Description 라벨과 값이 같은 행 또는 인접 행에 있음

    HEADER_LABELS = {'Manufacturer', 'Model', 'Description', 'Serial Number',
                     'Certificate No.', 'Identification', 'Number'}

    for idx, row in enumerate(rows):
        vals = [str(v).strip() if v is not None else '' for v in row]
        joined = ' '.join(vals)

        # Manufacturer/Model/Description 처리
        if 'Manufacturer' in vals or 'Model' in vals:
            # 이 행 + 바로 위 행을 합쳐서 분석 (패턴A 대응)
            combined = list(vals)
            if idx > 0:
                prev = [str(v).strip() if v is not None else '' for v in rows[idx - 1]]
                # 위 행에 라벨 없이 값만 있으면 = 패턴A
                if not any(v in HEADER_LABELS for v in prev):
                    combined = prev + combined

            # 라벨-값 쌍 추출
            for i, v in enumerate(combined):
                if v == 'Manufacturer' and '제조사' not in info:
                    # 두 가지 레이아웃:
                    # 패턴A (Manufacturer 단독 행):
                    #   행1: [제조사, 'Model', 모델, 'Description', 장비명]
                    #   행2: ['Manufacturer']
                    #   → 위 행에서 찾기
                    # 패턴B (같은 행):
                    #   행: ['Manufacturer', 제조사, 'Model', 모델, 'Description']
                    #   → 같은 행에서 Manufacturer 바로 뒤 값

                    # 같은 행(vals)에 Manufacturer 외에 Model도 있으면 → 패턴B
                    if 'Model' in vals:
                        # 패턴B: 같은 행에서 Manufacturer와 Model 사이의 값
                        mfr_idx = vals.index('Manufacturer')
                        model_idx = vals.index('Model')
                        for j in range(mfr_idx + 1, model_idx):
                            if vals[j] and vals[j] not in HEADER_LABELS:
                                info['제조사'] = vals[j]
                                break
                    else:
                        # 패턴A: 위 행에서 찾기
                        for j in range(i - 1, -1, -1):
                            if combined[j] and combined[j] not in HEADER_LABELS:
                                info['제조사'] = combined[j]
                                break

                if v == 'Model' and '모델' not in info:
                    # 같은 행(vals)에서 Model 뒤의 첫 비-라벨 값
                    if v in vals:
                        m_idx = vals.index('Model')
                        for j in range(m_idx + 1, len(vals)):
                            if vals[j] and vals[j] not in HEADER_LABELS:
                                info['모델'] = vals[j]
                                break

                if v == 'Description' and '장비명' not in info:
                    # 같은 행(vals)에서 Description 뒤의 첫 비-라벨 값
                    if v in vals:
                        d_idx = vals.index('Description')
                        for j in range(d_idx + 1, len(vals)):
                            if vals[j] and vals[j] not in HEADER_LABELS:
                                info['장비명'] = vals[j]
                                break

        if 'Serial Number' in joined:
            for i, v in enumerate(vals):
                if 'Serial Number' in v or v == 'Serial Number':
                    for j in range(i + 1, len(vals)):
                        if vals[j] and vals[j] != 'Serial Number':
                            info['시리얼'] = vals[j]
                            break
                    break

        if 'Certificate No' in joined:
            for i, v in enumerate(vals):
                if 'Certificate No' in v:
                    if ':' in v:
                        info['성적서번호'] = v.split(':')[-1].strip()
                    else:
                        for j in range(i + 1, len(vals)):
                            if vals[j]:
                                info['성적서번호'] = vals[j]
                                break
                    break

        if 'Identification' in joined:
            for i, v in enumerate(vals):
                if 'Identification' in v:
                    for j in range(i + 1, len(vals)):
                        if vals[j] and vals[j] not in ('Number', 'Identification Number'):
                            info['관리번호'] = vals[j]
                            break
                    break

        if 'Date of Calibration' in joined or 'Calibration' in joined:
            for i, v in enumerate(vals):
                if 'Calibration' in v and 'Date' in joined:
                    for j in range(i + 1, len(vals)):
                        if vals[j] and any(c.isdigit() for c in vals[j]):
                            info['교정일'] = vals[j]
                            # 차기교정일은 그 다음 날짜
                            for k in range(j + 1, len(vals)):
                                if vals[k] and any(c.isdigit() for c in vals[k]):
                                    info['차기교정일'] = vals[k]
                                    break
                            break
                    break

    # --- 측정 데이터 영역 파싱 ---
    # PASS/FAIL이 있는 행을 데이터 행으로 인식
    for row in rows:
        vals = [v for v in row]
        str_vals = [str(v).strip() if v is not None else '' for v in vals]

        # PASS 또는 FAIL이 포함된 행 = 측정 데이터
        if 'PASS' not in str_vals and 'FAIL' not in str_vals:
            continue

        # 숫자 데이터 추출
        numbers = []
        conformity = ''
        non_empty = []
        for v in vals:
            sv = str(v).strip() if v is not None else ''
            if sv in ('PASS', 'FAIL'):
                conformity = sv
            elif sv and sv != '-' and sv != 'None':
                non_empty.append(sv)
                try:
                    numbers.append(float(sv.replace(' ', '').replace(',', '')))
                except ValueError:
                    pass

        if conformity:
            measurements.append({
                '원본데이터': non_empty,
                '숫자값': numbers,
                '판정': conformity,
            })

    info['측정결과'] = measurements
    info['측정포인트수'] = len(measurements)
    if measurements:
        pass_cnt = sum(1 for m in measurements if m['판정'] == 'PASS')
        fail_cnt = sum(1 for m in measurements if m['판정'] == 'FAIL')
        info['PASS'] = pass_cnt
        info['FAIL'] = fail_cnt
        info['전체판정'] = 'PASS' if fail_cnt == 0 else 'FAIL'
    else:
        info['전체판정'] = None

    return info


def _cross_validate(cover, conf):
    """갑지 vs 적합성검토서 교차검증 — 불일치 항목 검출

    검증 대상: 성적서번호, 제조사, 모델, 시리얼, 관리번호
    반환: 불일치 목록 [{'항목': ..., '갑지': ..., '적합성검토': ...}, ...]
    """
    CHECK_FIELDS = [
        ('성적서번호', '성적서번호'),
        ('제조사', '제조사'),
        ('모델', '모델'),
        ('시리얼', '시리얼'),
        ('관리번호', '관리번호'),
    ]

    mismatches = []
    for field, label in CHECK_FIELDS:
        cover_val = cover.get(field, '').strip()
        conf_val = conf.get(field, '').strip()

        # 둘 다 없으면 비교 불가 → skip
        if not cover_val or not conf_val:
            continue

        # 정규화 비교 (대소문자, 공백 무시)
        if cover_val.lower().replace(' ', '') != conf_val.lower().replace(' ', ''):
            mismatches.append({
                '항목': label,
                '갑지': cover_val,
                '적합성검토': conf_val,
            })

    return mismatches


def parse_cert_excel(excel_bytes, use_llm=True):
    """교정성적서 Excel 파싱 → 구조화된 dict 반환

    파싱 전략:
    1차: 규칙기반 파싱 (갑지 + 적합성검토서)
    2차: 핵심 필드 누락 시 Mistral LLM API로 보강 (use_llm=True일 때)

    구조:
    - 갑지: 기본 정보 (Page 1)
    - 적합성검토서: 측정 결과 + PASS/FAIL (마지막 시트)
    - 갑지 ↔ 적합성검토서 교차검증 (불일치 감지)
    - 적합성검토서가 없으면 갑지 정보만 반환
    """
    wb = openpyxl.load_workbook(BytesIO(excel_bytes))

    result = {
        '시트수': len(wb.sheetnames),
        '시트목록': wb.sheetnames,
    }

    # 갑지 파싱
    cover = _parse_cover(wb)
    result.update(cover)

    # 적합성검토서 파싱
    conformity_ws = _find_conformity_sheet(wb)
    if conformity_ws:
        result['적합성검토'] = True
        conf = _parse_conformity(conformity_ws)

        # 교차검증
        mismatches = _cross_validate(cover, conf)
        result['불일치'] = mismatches

        # 최종 값 결정: 갑지 우선, 적합성검토서로 보강
        for key in ('장비명', '교정일', '차기교정일', '성적서번호'):
            if key in conf and conf[key] and key not in result:
                result[key] = conf[key]
        if '차기교정일' in conf and conf['차기교정일']:
            result['차기교정일'] = conf['차기교정일']
        if '관리번호' in conf and conf['관리번호'] and '관리번호' not in cover:
            result['관리번호'] = conf['관리번호']

        result['측정결과'] = conf['측정결과']
        result['측정포인트수'] = conf['측정포인트수']
        result['PASS'] = conf.get('PASS', 0)
        result['FAIL'] = conf.get('FAIL', 0)
        result['전체판정'] = conf['전체판정']
    else:
        result['적합성검토'] = False
        result['불일치'] = []
        result['측정결과'] = []
        result['측정포인트수'] = 0
        result['전체판정'] = None

    wb.close()

    # 2차: LLM 백업 파싱 (핵심 필드 누락 시)
    result['_llm_보강'] = []
    if use_llm:
        result, _ = _llm_supplement(result, excel_bytes)

    return result


# =============================================================================
# 실행
# =============================================================================

if __name__ == '__main__':
    import random
    from ktools_수집 import fetch_all

    print('=' * 70)
    print('교정성적서 Excel 다운로드 & 파싱 테스트 (LLM 백업 통합)')
    print('=' * 70)

    # 1. 로그인 & 데이터 수집
    print('\n[1] 로그인 & 데이터 수집...')
    session = ktools_login(USER_ID, USER_PWD)
    session.get(f'{BASE_URL}/spm/contents/spm0907.do?cnsnClsIdx=32')
    all_data = fetch_all(session)

    completed = [d for d in all_data if '완료' in d.get('pgstNm', '')]
    print(f'    전체: {len(all_data)}건, 완료(성적서有): {len(completed)}건')

    # 2. 샘플링: 다양한 장비 유형 10건
    random.seed(42)
    samples = random.sample(completed, min(10, len(completed)))
    print(f'\n[2] 랜덤 {len(samples)}건 테스트 (LLM fallback 포함)\n')

    success = 0
    fail = 0
    llm_count = 0

    for i, d in enumerate(samples):
        api_acpt = make_api_acpt_no(d)
        prd = d.get('entpPrdNm', '')[:40]

        excel = download_cert_excel(session, api_acpt)
        if not excel:
            print(f'  [{i+1}] NG  {api_acpt:22s}  다운로드 실패  {prd}')
            fail += 1
            time.sleep(0.3)
            continue

        cert = parse_cert_excel(excel, use_llm=True)
        success += 1

        llm_fields = cert.get('_llm_보강', [])
        if llm_fields:
            llm_count += 1

        # 결과 출력
        conf_mark = 'O' if cert['적합성검토'] else 'X'
        llm_mark = f' [LLM+{len(llm_fields)}]' if llm_fields else ''
        print(f'  [{i+1}] {api_acpt:22s}  적합{conf_mark}{llm_mark}  {prd}')
        print(f'       성적서번호={cert.get("성적서번호", "?")}')
        print(f'       제조사={cert.get("제조사", "?")} / 모델={cert.get("모델", "?")}')
        print(f'       시리얼={cert.get("시리얼", "?")} / 관리번호={cert.get("관리번호", "?")}')
        print(f'       교정일={cert.get("교정일", "?")} / 차기={cert.get("차기교정일", "?")}')
        print(f'       판정={cert.get("전체판정", "-")} / 측정={cert.get("측정포인트수", 0)}pt')
        if llm_fields:
            print(f'       LLM 보강 필드: {", ".join(llm_fields)}')
        if cert.get('측정요약'):
            print(f'       측정요약: {cert["측정요약"]}')
        print()
        time.sleep(0.3)

    print(f'{"="*70}')
    print(f'결과: 성공={success}, 실패={fail}, LLM 보강={llm_count}건')
    print(f'{"="*70}')
