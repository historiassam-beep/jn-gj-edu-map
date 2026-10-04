# 「전남광주통합특별시 중학교 학교군 및 중학구 등에 관한 고시(안)」 PDF(pdftotext -bbox-layout 결과 html) → raw/gosi_groups.json
# 사용: pdftotext -bbox-layout 고시.pdf all.html ; python scripts/05c_parse_gosi.py all.html
import re, json, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(sys.argv[1], encoding='utf-8').read()
pages = re.findall(r'<page [^>]*>(.*?)</page>', html, re.S)
NAME_END = re.compile(r'(학교군|중학구|학구|학군)$')
groups = {}; order = []
region = '전남'
cur_sigun = None; cur_key = None; pend_name = ''
for pi, pg in enumerate(pages):
    lines = []
    for m in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', pg, re.S):
        w = re.findall(r'>([^<]+)</word>', m.group(5))
        txt = ' '.join(w)
        parts = re.split(r'\s(?=[◦○❍]\s)', txt)
        if len(parts) > 1 and not txt[0] in '◦○❍':
            lines.append((float(m.group(2)), float(m.group(1)), parts[0]))
            lines.append((float(m.group(2)) + 0.1, float(m.group(3)) - 1000 + 1000 - 0, ' '.join(parts[1:])))  # x는 아래에서 열 판정에 쓰이므로 큰 값으로 대체
            lines[-1] = (lines[-1][0], 9999.0, lines[-1][2])
        else:
            lines.append((float(m.group(2)), float(m.group(1)), txt))
    lines.sort()
    grp, gy, gi = [], None, -1
    for l in lines:
        if gy is None or l[0] - gy > 6: gi += 1; gy = l[0]
        grp.append((gi, l[1], l))
    lines = [g[2] for g in sorted(grp, key=lambda g: (g[0], g[1]))]
    # 헤더 열 위치
    hdr = [l for l in lines if l[2].replace(' ', '') in ('중학교', '중') or l[2].startswith('중 ')]
    ech = [l for l in lines if l[2].replace(' ', '') == '초등학교']
    if not ech or not hdr: continue
    hh = [h for h in hdr if h[0] < 250]
    if not hh: continue
    xm = min(h[1] for h in hh); xe = ech[0][1]
    mid_cut = (xm + xe) / 2 - 10; name_cut = xm - 45
    last_bullet = None
    for y, x, t in lines:
        if t.replace(' ', '').startswith('(종전)광주광역시중학교'):
            region = '광주'; cur_sigun = '광주'; cur_key = None; pend_name = ''; esg = None
            h2 = [l for l in lines if l[0] > y and l[2].replace(' ', '') in ('중학교', '중')]
            e2 = [l for l in lines if l[0] > y and l[2].replace(' ', '') == '초등학교']
            if h2 and e2: xm, xe = min(h[1] for h in h2), e2[0][1]; mid_cut = (xm + xe) / 2 - 10; name_cut = xm - 45
            continue
        if y < 250 and (t in ('시군별', '명칭') or '학교군 또는' in t or t.replace(' ', '') in ('중학교', '초등학교', '중', '학', '교')): continue
        isb = t[:1] in '◦○❍'
        if not isb and ((region == '전남' and x < name_cut) or (region == '광주' and x < 130 and re.match(r'^(제\d+학교군|.+중학구)$', t.strip()))):
            tt = t.strip()
            if tt in ('시군별', '학교군', '또는', '중학구', '명칭') or tt.startswith('(종전)'): continue
            if region == '전남' and x < 100: cur_sigun = tt if not pend_name else cur_sigun; continue
            pend_name = (pend_name + tt) if pend_name else tt
            if NAME_END.search(pend_name):
                cur_key = (region, cur_sigun, pend_name)
                if cur_key not in groups: groups[cur_key] = {'region': region, 'sigun': cur_sigun, 'name': pend_name, 'mids': [], 'elems': []}; order.append(cur_key)
                pend_name = ''
                esg = cur_sigun
            continue
        if cur_key is None: continue
        if 'esg' not in dir() or esg is None: esg = cur_sigun
        g = groups[cur_key]
        if x < mid_cut:
            if t.startswith('◦') or t.startswith('○') or t.startswith('❍'):
                g['mids'].append(re.sub(r'^[◦○❍]\s*', '', t).replace(' ', '')); last_bullet = ('m', g['mids'])
            continue
        # 초등학교 열
        s = t.replace(' ', '')
        mm = re.match(r'^<(.+)>$', s)
        if mm: esg = mm.group(1); continue
        if t[0] in '◦○❍':
            g['elems'].append({'n': re.sub(r'^[◦○❍]\s*', '', t).replace(' ', ''), 'sg': esg, 'note': ''}); last_bullet = ('e', g['elems'])
        elif last_bullet and last_bullet[0] == 'e' and g['elems']:
            g['elems'][-1]['note'] = (g['elems'][-1]['note'] + ' ' + t).strip()
    esg = None
out = [groups[k] for k in order]
# ---- 후처리: 분교장 중학구(이름이 두 줄로 나뉜 표 칸)는 앞 칸에 섞여 들어온 학교를 옮기고, 괄호 설명·중복을 정리한다 ----
by = {g['name']: g for g in out}
def move_mid(frm, to, key):
    a, b = by[frm], by[to]
    for m in [m for m in a['mids'] if key in m]: a['mids'].remove(m); b['mids'].append(m)
def move_el(frm, to, key):
    a, b = by[frm], by[to]
    for e in [e for e in a['elems'] if e['n'].startswith(key)]: a['elems'].remove(e); b['elems'].append(e)
for frm, to, mkey, ekeys in [('화양중학구', '화양중학교화양남분교장학구', '분교장', ['안일초등학교']), ('남평중학구', '남평중학교다도분교장학구', '분교장', ['다도초등학교']),
                             ('노화중학구', '노화중학교넙도분교장학구', '넙도초등학교노화', ['넙도초등학교']), ('금일중학구', '금일중학교생일분교장학구', '분교장', ['생영초등학교']),
                             ('신안흑산중학구', '신안흑산중학교가거도분교장학구', '', ['가거도초등학교'])]:
    if frm in by and to in by:
        if mkey: move_mid(frm, to, mkey)
        for ek in ekeys: move_el(frm, to, ek)
if '노화중학교넙도분교장학구' in by:  # 이름이 쪼개진 중학교 이름 복원
    g = by['노화중학교넙도분교장학구']; g['mids'] = ['노화중학교넙도분교장']
    for a in out:
        if a['name'] == '노화중학구': a['mids'] = [m for m in a['mids'] if m != '넙도초등학교노화']
if '신안흑산중학교가거도분교장학구' in by:
    by['신안흑산중학교가거도분교장학구']['mids'] = ['신안흑산중학교가거도분교장']
    by['신안흑산중학구']['elems'] = [e for e in by['신안흑산중학구']['elems'] if e['n'] in ('흑산초등학교',)]
    by['신안흑산중학교가거도분교장학구']['elems'] = [{'n': '가거도초등학교', 'sg': '신안군', 'note': ''}]
for g in out:
    seen = set(); els = []
    for e in g['elems']:
        n = re.split(r'[(（]', e['n'])[0]
        if not n.endswith(('초등학교', '분교장', '분교', '초')) or n in seen: continue
        seen.add(n); e['n'] = n; els.append(e)
    g['elems'] = els
out = [g for g in out if g['mids'] or g['elems']]
# 시군을 바꿔 들어간 초등학교(esg)가 시군 표기가 아니면 정리
json.dump(out, open(os.path.join(ROOT, 'raw/gosi_groups.json'), 'w'), ensure_ascii=False, indent=0)
print(len(out), '개 학교군/중학구', sum(len(g['mids']) for g in out), '중학교', sum(len(g['elems']) for g in out), '초등학교')
