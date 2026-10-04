# 전남광주교육지도

전라남도·광주광역시 초·중·고·특수학교 1,185곳의 5년(2022~2026) 통계를 3D 지도로 보는 교사용 정보 사이트(작업본).

## 원작 표기

이 프로젝트는 **경북교육지도**(제작 [@kimju.zip](https://www.instagram.com/kimju.zip/),
[github.com/kimju1416/gb-edu-map](https://github.com/kimju1416/gb-edu-map))의 코드와 구성을 바탕으로
전남·광주 자료에 맞게 고쳤습니다. 사이트 하단과 「자료·방법」 창에 원작 크레딧이 들어 있으니 지우지 마세요.
원작 저장소에는 라이선스 파일이 없으므로, **공개 배포 전에 원작자의 허락을 받는 것을 전제**로 합니다(NOTICE.md).

## 지금 상태

`docs/` 폴더가 완성된 사이트입니다(`docs/data/`에 자료 포함). 내 컴퓨터에서 바로 열어 볼 수 있습니다.

```
cd docs
python -m http.server 8000      # 그다음 브라우저에서 http://localhost:8000
```
(index.html을 더블클릭하면 자료를 못 불러옵니다. 꼭 위처럼 서버로 여세요.)

### 들어 있는 것
- 학교 1,185곳(초 612 · 중 347 · 고 211 · 특수 15, 휴교·분교장 포함) — KESS 학교별 주요통계 2022~2026
- 학생·학급·학년별 학생·교원(정규·기간제)·교지·입학자·전출입, 이름이 바뀐 학교 15곳은 옛 기록을 이어 붙임
- 27개 시군구·393개 행정동 경계(2026. 7. 1., 전남광주통합특별시)
- 소규모학교, 신입생 0명 학교, 교원 1인당 학생, 학생 1인당 교지, 통학 거리, 특수교육 학생
- 폐교 재산 125곳, 인구감소지역(전남 16개 군) · 관심지역(광주 동구)
- 주민등록 인구(2026. 7. 말): 읍면동 아이 수, 0~2세 ÷ 6~8세 입학생 전망
- 학교 카드: 나이스 급식·학사일정 실시간(광주 F10 / 전남 Q10)
- 위치 자료에 없는 29곳(특수학교 16, 휴교 분교장 13)은 주소의 읍면동 대표점에 놓고 학교 카드에 안내

- 중학교 학교군·중학구 경계 207곳(학구도 2025-09-22)과, 고시(안)의 초·중학교 연결표(`raw/hakgun.json`)로 만든 중학교 추정
- 도서·벽지 지정 학교 99곳(교육부령 제374호 별표, 2026. 3. 1. 시행; `raw/byeokji.json`)
- 초등 통학구역 669곳(학구도 2025-09-22, 학교 610/612 연결)과 학구별 0~5세·학생 변화
- 5년 뒤(2027~2032) 학생 추정: 초등은 학구 인구 비율법, 중학교는 학교군·중학구 고시(안, 2026. 10. 1.)의 초·중학교 연결표(`raw/hakgun.json`, 중학교 333곳 연결) 기준 같은 학교군 초6 흐름, 고등은 중3 흐름 시나리오

### 아직 없는 것 (자료가 없으면 화면에서 자동으로 숨겨짐 → 자료를 넣고 다시 만들면 저절로 나타남)
| 기능 | 필요한 자료 |
|---|---|
| 해발 고도, 학교알리미 공시 | 인터넷 되는 컴퓨터에서 07·10번 스크립트 실행 |
| 위성 사진·건물 3D | 브이월드 키 → `docs/index.html`의 `VWORLD_KEY`, `VW_DOMAIN` |

참고: 학구도 원자료에 학구가 그려지지 않은 빈 곳이 있어(광주 풍암·동림·일곡동 등) 지역 0~5세의 약 90%만 학구에 담깁니다.

## 자료 다시 만들기 (Node 18+, Python 3 + openpyxl, 추가 패키지 없음)

`raw/`: `kess_2022~2026.xlsx`(학교별 주요통계), `hjd.geojson`, 그리고 받은 폐교·인구·학교위치 파일
```
python scripts/00_boundaries.py                    # 행정동 경계 → 경계 5종
python scripts/01b_prepare_inputs.py <받은파일폴더>  # 폐교·인구·학교위치 변환 (CLASS=1이면 반별 KESS도)
python scripts/01_kess_extract.py                  # KESS 학교별 주요통계 → work/kess_YYYY.json
node scripts/02_build.js                           # 학교·통계 자료 (위치 못 찾은 학교 → work/unmatched.json)
node scripts/03_geocode_fallback.js                # 옛 이름·같은 주소·(OSM)·읍면동 대표점으로 위치 채우기
node scripts/02_build.js                           # 한 번 더
python scripts/05b_zones_from_shp.py e <초등학교통학구역.shp>   # (학구 shp가 있을 때)
python scripts/05b_zones_from_shp.py m <중학교학교군.shp>
pdftotext -bbox-layout 고시.pdf all.html && python scripts/05c_parse_gosi.py all.html   # 학교군 고시 PDF → raw/gosi_groups.json
python scripts/05d_link_gosi.py                    # → raw/hakgun.json (학교 번호 연결)
node scripts/06_population.js                      # 주민등록 인구·학구 연결
node scripts/08_forecast.js                        # 5년 뒤 학생 추정(추가 패키지 없음)
python scripts/04_verify.py                        # 원자료 합계와 대조(학생·학급·교원, 불일치면 실패)
```

## 원작에서 바꾼 점
- 지역 필터: 경북 → 광주·전남(통합특별시 표기 포함). 광주 자치구는 `광주 동구`처럼 표기
- 카메라 범위, 산간(곡성·구례·화순)·섬(신안) 시연 구간, 설명 문구, 한글 보고서 틀
- 원작 로고·OG 이미지·브이월드 키는 쓰지 않음
- 경계 처리(mapshaper) → 추가 패키지 없는 `00_boundaries.py`
- 없는 자료에 기대는 지표·이야기·버튼 자동 숨김
