# 원자료 엑셀에서 직접 다시 더해 docs/data/stats.json 합계와 대조한다(변환 경로와 별개로 계산)
import openpyxl, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
stats = json.load(open(f'{ROOT}/docs/data/stats.json', encoding='utf-8'))
KINDS = {'초등학교', '중학교', '고등학교', '특수학교'}
bad = 0
for yi, y in enumerate(stats['years']):
    ws = openpyxl.load_workbook(f'{ROOT}/raw/kess_{y}.xlsx', read_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True)
    for row in it:
        if row and '학교명' in [str(c).strip() if c else '' for c in row]:
            h = [str(c).replace('\n', '').replace(' ', '') if c else '' for c in row]; break
    I = lambda name: h.index(name)
    stu = cls = tch = 0; per_sgg = {}
    for r in it:
        if not r or r[I('시도')] not in ('광주', '전남') or r[I('학교급')] not in KINDS: continue
        s = r[I('학생수_총계_계')] or 0
        stu += s; cls += r[I('편성학급수_계')] or 0; tch += r[I('교원수_총계_계')] or 0
        g = ('광주 ' if r[I('시도')] == '광주' else '') + str(r[I('행정구')]).strip()
        per_sgg[g] = per_sgg.get(g, 0) + s
    mine = stats['total']['all'][yi]
    ok = (stu, cls, tch) == (mine['students'], mine['classes'], mine['teachers'])
    for g, v in per_sgg.items():
        if stats['sigun'][g]['all'][yi]['students'] != v: ok = False; print('  시군 불일치', y, g, v, stats['sigun'][g]['all'][yi]['students'])
    print(y, '원자료', stu, cls, tch, '| 지도', mine['students'], mine['classes'], mine['teachers'], '→', '일치' if ok else '불일치')
    bad += not ok
schools = json.load(open(f'{ROOT}/docs/data/schools.json', encoding='utf-8'))
s26 = sum(s['stu'][4] or 0 for s in schools)
print('학교 점 합계 2026', s26, '/ 통계', stats['total']['all'][4]['students'], '일치' if s26 == stats['total']['all'][4]['students'] else '불일치')
bad += s26 != stats['total']['all'][4]['students']
sys.exit(1 if bad else 0)
