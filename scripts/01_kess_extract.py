# KESS 학교별 엑셀(5개년)에서 광주·전남 학교만 뽑아 work/kess_YYYY.json 으로 저장
import openpyxl, json, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WANT = {
 '시도':'sido','행정구':'sgg','교육\n(지원)청':'office','학교급':'kind','고등학교\n유형':'hsType','학교세부유형':'subType',
 '학교명':'name','학교코드\n(KEDI)':'kedi','본분교':'branch','설립':'found','남녀공학\n구분':'coed','상태':'state',
 '지역규모':'region','개교일':'opened','주소':'addr','전화번호':'tel','홈페이지':'web','학교수':'nSchool',
 '일반학급_학급수':'genClass','특수학급_학급수':'spClass','특수학급_학생수_계':'spStu','편성학급수_계':'classes',
 '학생수_총계_계':'students','1학년_학생수_계':'g1','2학년_학생수_계':'g2','3학년_학생수_계':'g3',
 '4학년_학생수_계':'g4','5학년_학생수_계':'g5','6학년_학생수_계':'g6','학급당\n 학생수':'perClass',
 '교원수_총계_계':'teachers','교원수_정규_계':'teachersReg','교원수_기간제교원_계':'teachersTemp','교원1인당 학생수':'perTeacher',
 '전체직원_계':'staff','전출':'out','전입':'in','입학자_계':'entrants','졸업자_계':'grads',
 '일반\n교실':'rmGen','교과\n교실':'rmSubj','특별\n교실':'rmSpec','수준별교실':'rmLvl','기타\n교실':'rmEtc','교지면적':'site',
}
def norm(s): return (s or '').replace('\r','').strip() if isinstance(s,str) else s
for y in [2022,2023,2024,2025,2026]:
    wb = openpyxl.load_workbook(f'{ROOT}/raw/kess_{y}.xlsx', read_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    hdr = None
    for row in it:
        if row and any(norm(c) == '학교명' for c in row):
            hdr = [norm(c) for c in row]; break
    idx = {}
    for k,v in WANT.items():
        kk = norm(k)
        cand = [i for i,h in enumerate(hdr) if isinstance(h,str) and h.replace('\n','').replace(' ','') == kk.replace('\n','').replace(' ','')]
        if not cand: print(y,'MISSING',repr(k)); continue
        idx[v] = cand[0]
    out = []
    for row in it:
        if not row or row[idx['sido']] not in ('광주', '전남'): continue
        rec = {v: row[i] for v,i in idx.items()}
        for k,val in list(rec.items()):
            if isinstance(val,str): rec[k] = val.strip()
        if rec['sido'] == '광주': rec['sgg'] = '광주 ' + (rec['sgg'] or '')
        out.append(rec)
    json.dump(out, open(f'{ROOT}/work/kess_{y}.json','w',encoding='utf-8'), ensure_ascii=False)
    print(y, 'rows', len(out))
