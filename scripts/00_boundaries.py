# 00_boundaries.sh(mapshaper)를 대신하는 순수 파이썬 버전 — 추가 패키지 없이 동작
# 입력: raw/hjd.geojson (vuski/admdongkor 전국 행정동)
# 출력: work/gb_emd_full.geojson, docs/data/emd.geojson, sigun.geojson, neighbors.geojson, mask.geojson
import json, os, re, math
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda p: os.path.join(ROOT, p)
REG = re.compile('광주|전라남|전남')
src = json.load(open(R('raw/hjd.geojson'), encoding='utf-8'))

def polys_of(g):
    return [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']

def geom_of(polys):
    polys = [p for p in polys if p and len(p[0]) >= 4]
    if not polys: return None
    return {'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': polys}

# ---------- 단순화: Douglas-Peucker (고리별) ----------
def dp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0: d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best: best, bi = d, i
        if best > eps * eps:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def simplify_ring(ring, eps, prec):
    out = dp(ring, eps)
    out = [[round(x, prec), round(y, prec)] for x, y in out]
    ded = [out[0]]
    for p in out[1:]:
        if p != ded[-1]: ded.append(p)
    if ded[0] != ded[-1]: ded.append(ded[0])
    return ded if len(ded) >= 4 else None

def simplify_polys(polys, eps, prec, min_area=0):
    out = []
    for poly in polys:
        outer = simplify_ring(poly[0], eps, prec)
        if not outer: continue
        if min_area and abs(ring_area(outer)) < min_area: continue
        holes = [h for h in (simplify_ring(h, eps, prec) for h in poly[1:]) if h]
        out.append([outer] + holes)
    if not out:  # 너무 작은 곳도 모양은 남긴다(keep-shapes)
        p = max(polys, key=lambda p: abs(ring_area(p[0])))
        out = [[[[round(x, prec), round(y, prec)] for x, y in p[0]]]]
    return out

def ring_area(r):
    return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2

# ---------- 합치기(dissolve): 서로 반대 방향으로 겹치는 변을 지우고 고리를 다시 잇는다 ----------
def dissolve(list_of_polys, prec=7):
    key = lambda p: (round(p[0], prec), round(p[1], prec))
    edges = defaultdict(int)
    for polys in list_of_polys:
        for poly in polys:
            for k, ring in enumerate(poly):
                # 바깥 고리는 반시계, 구멍은 시계로 맞춘다
                a = ring_area(ring)
                r = ring if ((a > 0) == (k == 0)) else ring[::-1]
                for i in range(len(r) - 1):
                    u, v = key(r[i]), key(r[i + 1])
                    if u == v: continue
                    if edges.get((v, u), 0) > 0:
                        edges[(v, u)] -= 1
                        if edges[(v, u)] == 0: del edges[(v, u)]
                    else:
                        edges[(u, v)] += 1
    nxt = defaultdict(list)
    for (u, v), n in edges.items():
        for _ in range(n): nxt[u].append(v)
    rings = []
    while nxt:
        start = next(iter(nxt)); ring = [start]; cur = start
        while True:
            vs = nxt.get(cur)
            if not vs: break
            v = vs.pop()
            if not vs: del nxt[cur]
            ring.append(v); cur = v
            if cur == start: break
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append([list(p) for p in ring])
    outers = [r for r in rings if ring_area(r) > 0]
    holes = [r for r in rings if ring_area(r) <= 0]
    polys = [[o] for o in sorted(outers, key=lambda r: -ring_area(r))]
    for h in holes:
        hx, hy = h[0]
        for p in polys:
            if point_in_ring(hx, hy, p[0]): p.append(h); break
    return polys

def point_in_ring(x, y, ring):
    c = False
    for i in range(len(ring) - 1):
        (xi, yi), (xj, yj) = ring[i], ring[i + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c

def fc(feats): return {'type': 'FeatureCollection', 'features': feats}
def dump(obj, p):
    os.makedirs(os.path.dirname(R(p)), exist_ok=True)
    json.dump(obj, open(R(p), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{p}: {len(obj["features"])}개, {os.path.getsize(R(p)) // 1024}KB')

# ---------- 대상 지역 행정동 ----------
mine, others = [], []
for f in src['features']:
    p = f['properties']
    (mine if REG.search(p['sidonm']) else others).append(f)

full = []
for f in mine:
    p = f['properties']
    sg = re.sub(r'^(광주광역시|전라남도|전남광주통합특별시)\s*', '', p['sggnm'])
    sigun = ('광주 ' if sg.endswith('구') else '') + sg
    full.append({'type': 'Feature', 'properties': {'sigun': sigun, 'emd': p['adm_nm'].split(' ')[-1], 'code': p['adm_cd2'], 'sggnm': p['sggnm']}, 'geometry': f['geometry']})
dump(fc(full), 'work/gb_emd_full.geojson')

# emd: 0.0004도(약 40m) 단순화
emd = []
for f in full:
    g = geom_of(simplify_polys(polys_of(f['geometry']), 0.0004, 4))
    emd.append({'type': 'Feature', 'properties': {k: f['properties'][k] for k in ('sigun', 'emd', 'code')}, 'geometry': g})
dump(fc(emd), 'docs/data/emd.geojson')

# sigun: 시군구별 합치기 후 단순화
by = defaultdict(list)
for f in full: by[f['properties']['sigun']].append(polys_of(f['geometry']))
sig = []
for sg, lst in by.items():
    polys = dissolve(lst)
    g = geom_of(simplify_polys(polys, 0.0005, 4, min_area=1e-7))
    sig.append({'type': 'Feature', 'properties': {'sigun': sg}, 'geometry': g})
dump(fc(sig), 'docs/data/sigun.geojson')

# 전체 지역 외곽(가림막 구멍용)
region = dissolve([polys_of(f['geometry']) for f in full])

# neighbors: 주변 시도(범위 안) 시도별 합치기, 굵게 단순화
BB = (124.5, 33.5, 128.9, 36.3)
def in_bb(polys):
    for poly in polys:
        for x, y in poly[0]:
            if BB[0] <= x <= BB[2] and BB[1] <= y <= BB[3]: return True
    return False
bys = defaultdict(list)
for f in others:
    ps = polys_of(f['geometry'])
    if in_bb(ps): bys[f['properties']['sidonm']].append(ps)
nb = []
for s, lst in bys.items():
    g = geom_of(simplify_polys(dissolve(lst), 0.004, 3, min_area=1e-5))
    if g: nb.append({'type': 'Feature', 'properties': {'sidonm': s}, 'geometry': g})
dump(fc(nb), 'docs/data/neighbors.geojson')

# mask: 넓은 사각형에 지역 모양 구멍(원작과 같은 형식 — 바깥 고리 + 구멍들)
outer = [[118, 30], [140, 30], [140, 45], [118, 45], [118, 30]]
holes = []
for poly in simplify_polys(region, 0.002, 3, min_area=2e-5):
    r = poly[0]
    holes.append(r if ring_area(r) < 0 else r[::-1])
dump(fc([{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'Polygon', 'coordinates': [outer] + holes}}]), 'docs/data/mask.geojson')
print('시군구', len(sig), sorted(by))
