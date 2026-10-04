# 받은 원자료를 원작 스크립트가 읽는 형식으로 바꾼다 (전남광주교육지도용)
#  1) KESS 「학교별 학과별 학년별 반별 학생수」(반 단위) → 학교 단위 work/kess_YYYY.json
#     ※ 반 단위 자료에는 교원·교지·입학자·졸업·전출입·주소가 없어 null로 둔다(축소판)
#  2) 폐교재산 CSV(CP949) → raw/closed.json (원작 표준데이터 열 이름으로, 중복 제거)
#  3) 주민등록 인구 CSV → raw/pop.csv (출장소 인구를 상위 읍면에 합침)
#  4) 학교 위치 CSV → raw/schloc.csv
import openpyxl, json, os, sys, csv, io, glob, re
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda p: os.path.join(ROOT, p)
UP = sys.argv[1] if len(sys.argv) > 1 else R('raw/upload')
os.makedirs(R('work'), exist_ok=True)
REG = ('광주', '전남')
norm = lambda c: str(c).replace('\n', '').replace(' ', '') if c is not None else ''
num = lambda v: int(float(v)) if v not in (None, '') and str(v).strip() not in ('', '-') else 0

def first(*names):
    for n in names:
        if n in IX: return IX[n]
    return None

# ---------- 1) KESS (반 단위 자료일 때만: CLASS=1 환경변수를 줄 것. 학교 단위 자료는 01_kess_extract.py) ----------
only = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
for y in ([2022, 2023, 2024, 2025, 2026] if os.environ.get('CLASS') == '1' else []):
    if only and str(y) not in only: continue
    wb = openpyxl.load_workbook(R(f'raw/kess_class_{y}.xlsx'), read_only=True)
    ws = next(wb[s] for s in wb.sheetnames if '학생수' in s and '요약' not in s)
    it = ws.iter_rows(values_only=True)
    for row in it:
        if row and any(norm(c) == '학교명' for c in row):
            H = [norm(c) for c in row]; break
    IX = {h: i for i, h in enumerate(H)}
    C = dict(sido=first('시도'), sgg=first('행정구역'), office=first('교육(지원)청', '교육청'), kedi=first('학교코드(KEDI)', 'KEDI학교코드'),
             name=first('학교명'), kind=first('학제대분류'), hsType=first('고등학교유형'), subType=first('학교세부유형', '세부학제'),
             branch=first('본분교'), found=first('설립'), coed=first('남녀학교'), state=first('학교상태'), region=first('지역규모'),
             cls=first('학급수'), stu=first('학생수_계'), grade=first('학년'), gen=first('일반/특수/순회'))
    miss = [k for k, v in C.items() if v is None and k not in ('coed', 'kedi')]
    if miss: print(y, '열 없음:', miss); sys.exit(1)
    sch = {}
    for r in it:
        if not r or r[C['sido']] not in REG or not r[C['name']]: continue
        sido = r[C['sido']]; sgg = str(r[C['sgg']]).strip()
        if sido == '광주': sgg = '광주 ' + sgg
        k = (sgg, str(r[C['name']]).strip())
        s = sch.get(k)
        if not s:
            g = lambda c: (str(r[C[c]]).strip() if C[c] is not None and r[C[c]] not in (None, '') else None)
            br = g('branch') or ''
            s = sch[k] = dict(sido=sido, sgg=sgg, office=g('office'), kind=g('kind'), hsType=g('hsType'), subType=g('subType'),
                              name=k[1], kedi=(str(r[C['kedi']]).strip() if C['kedi'] is not None else None), branch='분교장' if '분교' in br else '본교', found=g('found'), coed=g('coed'),
                              state=g('state'), region=g('region'), opened=None, addr=None, tel=None, web=None, nSchool=1,
                              genClass=0, spClass=0, spStu=0, classes=0, students=0, g1=0, g2=0, g3=0, g4=0, g5=0, g6=0,
                              perClass=None, teachers=None, teachersReg=None, teachersTemp=None, perTeacher=None, staff=None,
                              out=None, **{'in': None}, entrants=None, grads=None, rmGen=None, rmSubj=None, rmSpec=None, rmLvl=None,
                              rmEtc=None, site=None)
        cl, st = num(r[C['cls']]), num(r[C['stu']])
        gen = str(r[C['gen']] or '').strip()
        s['classes'] += cl; s['students'] += st
        if gen == '특수': s['spClass'] += cl; s['spStu'] += st
        else: s['genClass'] += cl
        gr = num(r[C['grade']])
        if 1 <= gr <= 6 and gen != '특수': s[f'g{gr}'] += st
    out = list(sch.values())
    ST = {'기존': '기존(원)교', '신설': '신설(원)교', '휴교': '휴(원)교', '휴원': '휴(원)교', '폐교': '폐(원)교'}
    for s in out:
        s['perClass'] = round(s['students'] / s['genClass'], 1) if s['genClass'] else None
        s['state'] = ST.get(s['state'], s['state'])
        s['entrants'] = s['g1']  # 반 단위 자료엔 입학자가 없어 4월 1일 1학년 재학생 수로 대신(축소판)
    json.dump(out, open(R(f'work/kess_{y}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(y, '학교', len(out), dict(Counter(s['kind'] for s in out)), '학생', sum(s['students'] for s in out),
          '| 상태', dict(Counter(s['state'] for s in out)), '| 분교', sum(s['branch'] == '분교장' for s in out))

if only: sys.exit(0)

def find(pat):
    f = glob.glob(os.path.join(UP, pat)); return f[0] if f else None

# ---------- 2) 폐교 ----------
f = find('*폐교*.csv') or find('6bd3cc26*')
rows = list(csv.DictReader(io.open(f, encoding='cp949', newline='')))
seen, closed = set(), []
for r in rows:
    if not re.search('광주|전라남|전남', r['시도명']): continue
    key = (r['폐교명'].strip(), (r['소재지지번주소'] or r['소재지도로명주소']).replace(' ', ''))
    if key in seen: continue
    seen.add(key)
    closed.append(dict(CTPV_NM=r['시도명'], SGG_NM=r['시군구명'], CLS_CO_NM=r['폐교명'], SCHL_RK_SE_NM=r['학교급구분명'],
                       CLS_CO_YR=r['폐교연도'], PRCUSE_STUS_SE_NM=r['활용현황구분명'], SITE=r['대지'], BLDG_TOTAREA=r['건물연면적'],
                       LNMADR=r['소재지지번주소'], RDNMADR=r['소재지도로명주소'], ED_NM=r['교육지원청명'], CRTR_YMD=r['데이터기준일자']))
json.dump(closed, open(R('raw/closed.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print('폐교', len(rows), '→ 광주·전남 중복 제거', len(closed), dict(Counter(c['CTPV_NM'] for c in closed)))

# ---------- 3) 인구 (출장소 → 상위 읍면) ----------
f = find('*주민등록*.csv') or find('b1162d93*')
txt = io.open(f, encoding='cp949', newline='').read()
rd = list(csv.reader(io.StringIO(txt)))
H, body = rd[0], rd[1:]
iS, iG, iE = H.index('시도명'), H.index('시군구명'), H.index('읍면동명')
numcols = [i for i, h in enumerate(H) if h == '계' or h in ('남자', '여자') or '세' in h]
byname = {(r[iS], r[iG].strip(), r[iE].strip()): r for r in body}
merged, keep = 0, []
for r in body:
    m = re.match(r'^(.+?[읍면동])(.+)출장소$', r[iE].strip())
    if m and (r[iS], r[iG].strip(), m.group(1)) in byname:
        p = byname[(r[iS], r[iG].strip(), m.group(1))]
        for i in numcols: p[i] = str(num(p[i].replace(',', '')) + num(r[i].replace(',', '')))
        merged += 1; continue
    keep.append(r)
buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n'); w.writerow(H); w.writerows(keep)
open(R('raw/pop.csv'), 'wb').write(buf.getvalue().encode('cp949'))
print('인구 행', len(body), '→ 출장소 합침', merged, '→', len(keep))

# ---------- 4) 학교 위치 ----------
f = find('*위치*.csv') or find('f6b0a702*')
open(R('raw/schloc.csv'), 'w', encoding='utf-8').write(io.open(f, encoding='utf-8-sig', newline='').read())
print('학교 위치 복사 완료')
