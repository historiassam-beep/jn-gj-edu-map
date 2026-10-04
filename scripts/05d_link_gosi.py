# raw/gosi_groups.json(05c) → raw/hakgun.json : 학교군·중학구별 초·중학교 id 목록
import json, re, os, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(ROOT, 'docs/data/schools.json'), encoding='utf-8'))
G = json.load(open(os.path.join(ROOT, 'raw/gosi_groups.json'), encoding='utf-8'))
norm = lambda s: re.sub(r'[\s·ㆍ.\-]', '', s)
idx = collections.defaultdict(list)
for s in S: idx[(norm(s['name']))].append(s)
def find(name, sg, kind, gwangju):
    n = norm(name); c = [s for s in idx.get(n, []) if s['kind'] == kind]
    if not c and n.endswith('분교장'): c = [s for s in idx.get(n[:-3], []) if s['kind'] == kind]
    if not c and gwangju: c = [s for s in idx.get('광주' + n, []) if s['kind'] == kind]
    if len(c) > 1:
        c2 = [s for s in c if s['sigun'] == sg or s['sigun'] == '광주 ' + (sg or '')] or [s for s in c if gwangju == s['sigun'].startswith('광주')] or c
        c = c2
    return c[0] if c else None
out = {}; miss = collections.Counter(); missn = []
for g in G:
    gw = g['region'] == '광주'
    key = ('G:' if gw else 'J:') + (g['sigun'] + ':' if not gw else '') + g['name']
    rec = {'name': g['name'], 'sigun': g['sigun'], 'm': [], 'e': []}
    for m in g['mids']:
        s = find(m, g['sigun'], '중학교', gw)
        (rec['m'].append(s['id']) if s else (miss.update(['m']), missn.append(('중', g['name'], m))))
    for e in g['elems']:
        s = find(e['n'], e['sg'] if e['sg'] and e['sg'] != '광주' else g['sigun'], '초등학교', gw)
        (rec['e'].append(s['id']) if s else (miss.update(['e']), missn.append(('초', g['name'], e['n']))))
    out[key] = rec
json.dump(out, open(os.path.join(ROOT, 'raw/hakgun.json'), 'w'), ensure_ascii=False)
mids = {s['id'] for s in S if s['kind'] == '중학교' and not s.get('state')}; els = {s['id'] for s in S if s['kind'] == '초등학교' and not s.get('state')}
cm = {i for r in out.values() for i in r['m']}; ce = {i for r in out.values() for i in r['e']}
print('학교군', len(out), '/ 못 찾음', dict(miss)); print('중학교 연결', len(cm & mids), '/', len(mids), '초등학교 연결', len(ce & els), '/', len(els))
print('못찾은 예', missn[:25])
print('연결 안 된 중학교', [s['name'] for s in S if s['id'] in mids - cm][:30])
