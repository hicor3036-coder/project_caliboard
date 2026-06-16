# KAI-METCAL 사업기획서 핵심 정리

> 근거: `수출패키지(KAI-METCAL)체계개발 사업기획 및 제안 보고_20260521_R9.pdf` (36쪽) 전문 정독.
> 작성일: 2026-06-16.

---

## 0. 한 문장

> **KAI가 미 공군 AFMETCAL 표준을 패키징해서, FA-50·KF-21 수출에 "교정 시스템(SW+HW+서비스+훈련)"을 끼워 파는 사업.**
> 2027년 200억 → 2030년 3,000억 → 2035년 2조. "항공기 회사 → 국가 측정 신뢰성(Measurement Trust) 수출 회사"로 진화.
> 핵심 통찰: 항공기를 수출하면 그걸 정비할 교정 인프라(PMEL)가 반드시 따라간다 → 후속군수(MRO) 매출. 항공기 1대당 METCAL 5~15억.

---

## 1. ★ 우리가 공부한 표준문서 = 이 사업의 설계도

사업기획서가 USAF 거버넌스 3계층을 그대로 사업 구조로 변환 (p.5, p.8, p.26, p.35):
```
Tier 1: DAFPD 21-1     → "한국형 마스터플랜"
Tier 2: DAFMAN 21-113  → "DAFMAN 21-113 동등 한국형 매뉴얼 발행"  ← 우리가 정독한 "정신"
Tier 3: TO 00-20-14    → "TO 00-20-14 §10 기반 연간 평가"
        TO 33K 시리즈   → "K-METCAL TO Library"
```
담당자가 21-113을 "정신"이라 한 이유 100% 확인: 사업 ⑥영역(METCAL Program)이 통째로 "21-113 한국판".

---

## 2. 사업의 7대 핵심 영역 + 근거 표준 (= 표준문서 활용 지도)

| # | 영역 | 매출비중 | 근거 표준 (우리가 공부한 것) | CaliBoard 관련 |
|:--:|---|:--:|---|:--:|
| ① | 장비 Equipment | HW 45% | MIL-PRF-28800G, MIL-STD-1839D | — |
| ② | 시험소 Laboratory | (HW) | FC 4-218-01F (시설기준) | — |
| ③ | 문서화 Documentation | — | MIL-PRF-38793C, DI-QCIC, 33K | ★ |
| ④ | 훈련 Training | — | CFETP 2P0X1 | ★ |
| ⑤ | EITMS/IETM | SW 25% | MIL-STD-3048C(S1000D), MetWeb | ★★ |
| ⑥ | **METCAL Program** | — | **DAFMAN 21-113, TO 00-20-14, DAFPD 21-1** | ★★★ |
| ⑦ | 교정서비스 CSP | 서비스 30% | ISO 17025, ANSI/NCSL Z540.3 | ★★ |

- KAI 우선순위: ①장비 → ②시험소 (HW가 돈). **우리/CaliBoard 기여처 = ⑤·⑥·⑦ (SW·프로그램·서비스).**
- 솔루션 매출 비중(2030): HW 45 / SW 25 / 서비스 30.

---

## 3. ★★★ CaliBoard가 정확히 어디에 들어가는가

기획서에 우리 시스템 자리가 명시됨:
- **PAMS-K** (p.35 ④, p.30): "PMEL Automated Mgmt System 한국형 + WebAFCAV 동등 뷰어 + 모바일", "교정 데이터베이스(PAMS-K)"
- **K-METCAL Cloud** (p.9, p.24): "자산관리·AI예측교정·디지털트윈", "실시간 KPI 대시보드"

> **CaliBoard = PAMS-K + K-METCAL Cloud의 원형/프로토타입.**
> 이미 가진 것 1:1 대응 → 자산관리(ktools_items 9311건) / AI 예측교정([[phase-g-cycle-analysis]]) / KPI 대시보드(reception·freshness).
> 우리가 만들던 게 사업 SW Tier(매출 25%)의 핵심. 절반은 만들어 둔 셈.

---

## 4. 사업이 반복 인용하는 정량 기준 (우리 시스템이 보증할 숫자)

| 지표 | 값 | 출처 표준 | 의미 |
|---|---|---|---|
| **TUR** (Test Uncertainty Ratio) | **≥ 4:1** | MIL-STD-1839D §4, Z540.3 | 교정기가 피교정기보다 4배 정확 |
| **False Accept** (오수락) | **≤ 2%** | ANSI/NCSL Z540.3 §5.3 | 불합격품을 합격으로 오판할 확률 |
| False Reject (오기각) | ≤ 15% | OPNAVINST 3960.16C | 합격품을 불합격으로 오판 |
| 교정 정시 인도율 | ≥ 98% | KAI KPI | (21-113 회송 15일과 연결) |
| 재교정율(rework) | ≤ 2% | KAI KPI | |
| NIST 소급성 | 의무 | MIL-STD-1839D | 끊김 없는 사슬 |

> **새 발견**: 21-113의 "주기말 신뢰성 85%"에 더해, **TUR 4:1 / False Accept 2% (Z540.3 §5.3)**가 군 계약 필수.
> → 우리 교정주기 분석(Phase G **가드밴드** G-3에서 이미 다룸)의 다음 고도화 목표. False Accept는 가드밴드와 직결.

---

## 5. 한국 생태계 (사업 플레이어)

- **ROKAF**: 자체 85정밀표준정비창 운영, KRISS·민간 KOLAS 의존, 노후화 → 현대화 대상
- **K-AFMETCAL Center**: ROKAF 중앙 측정교정센터를 KAI가 위탁운영 (= 美 Heath, Ohio 한국판)
- **KRISS**(한국 NIST, CMC 세계6위) / **KOLAS**(ISO17025 인증) / **KTL**(임채욱 선임 소속) / **DAPA**(발주처) / **DTaQ**(품질)
- 소급성 사슬 한국판: SI → BIPM → NIST·KRISS → AFPSL/**KAI-PSL(사천)** → Type II PMEL → Field TMDE (p.35)
- → 임채욱 KTL 선임 ICMPM 키노트(DCC 소급성)와 같은 무대.

---

## 6. 경쟁 구도 (p.15)

- 경쟁사: Fluke(HW 1위), Keysight(RF), Beamex(교정SW 25%), Trescal(서비스망) 등 — 모두 "군용 통합 솔루션 부재"가 약점.
- KAI 차별화 4: ①OEM 기반 통합(SW+HW+서비스+훈련) ②K-Defense 번들(FA-50·KF-21 동반) ③저비용(유럽比 20~30%, 미국比 55%) ④3중 표준정합(NATO·KRISS·NIST, Vendor-Neutral).
- 포지셔닝: "항공기 제조사 × 통합 솔루션 × NATO 표준 적합" = Blue Ocean.

---

## 7. 핵심 결론 3가지

1. **공부한 표준문서 = 사업 설계도.** 21-113=⑥, ISO17025/Z540.3=⑦, CFETP=④, 33K/DI-QCIC=③. 헛공부 아님, 사업 모듈에 1:1 대응.
2. **CaliBoard = PAMS-K + K-METCAL Cloud 원형.** 자산관리·AI주기예측·KPI대시보드가 SW Tier(25%) 핵심. 이미 절반 완성.
3. **다음 고도화 방향 명확**: 85% 신뢰성 → TUR 4:1 / False Accept ≤2% (Z540.3 §5.3). 우리 Phase G 가드밴드를 이 방향으로.
