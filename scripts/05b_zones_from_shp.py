# 학구도 shp(공공데이터포털 「학구도」, Korea 2000 중부원점 EPSG:5186) → raw/zones_{e,m}.geojson, docs/data/zones_{e,m}.geojson
# 추가 패키지 없이 shp/dbf를 직접 읽고 TM 역변환한다.
# 사용: python scripts/05b_zones_from_shp.py e <초등학교통학구역.shp>   /   python scripts/05b_zones_from_shp.py m <중학교학교군.shp>
#       python scripts/05b_zones_from_shp.py test <아무 학구도.shp>   (변환만 시험)
import struct, math, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = re.compile('광주|전라남|전남')

# ---------- TM 역변환 (GRS80, 중부원점 2010: lat0 38, lon0 127, k0 1, FE 200000, FN 600000) ----------
A, F = 6378137.0, 1 / 298.257222101
E2 = F * (2 - F); EP2 = E2 / (1 - E2)
def prj_params(prj):
    p = lambda k, d: float(re.search(rf'"{k}",(-?[\d.]+)', prj).group(1)) if re.search(rf'"{k}",', prj) else d
    return dict(lat0=p('Latitude_Of_Origin', 38.0), lon0=p('Central_Meridian', 127.0), k0=p('Scale_Factor', 1.0),
                fe=p('False_Easting', 200000.0), fn=p('False_Northing', 600000.0))
def M(phi):
    e4, e6 = E2 * E2, E2 ** 3
    return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
                + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))
def make_inv(P):
    lat0, lon0, k0, fe, fn = math.radians(P['lat0']), math.radians(P['lon0']), P['k0'], P['fe'], P['fn']
    M0 = M(lat0); e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    def inv(x, y):
        m = M0 + (y - fn) / k0
        mu = m / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256))
        p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
              + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
        s, c, t = math.sin(p1), math.cos(p1), math.tan(p1)
        C1, T1 = EP2 * c * c, t * t
        N1 = A / math.sqrt(1 - E2 * s * s); R1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5
        D = (x - fe) / (N1 * k0)
        lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
                                    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720)
        lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c
        return math.degrees(lon), math.degrees(lat)
    return inv

# ---------- dbf ----------
def read_dbf(path, enc):
    b = open(path, 'rb').read()
    n, hl, rl = struct.unpack('<IHH', b[4:12])
    flds = []; o = 32
    while b[o] != 0x0D:
        flds.append((b[o:o + 11].split(b'\0')[0].decode('ascii'), b[o + 16])); o += 32
    rows = []
    for i in range(n):
        p = hl + i * rl + 1; r = {}
        for name, ln in flds:
            r[name] = b[p:p + ln].decode(enc, errors='replace').strip(); p += ln
        rows.append(r)
    return rows

# ---------- shp (Polygon=5) ----------
def pip(x, y, ring):
    c = False
    for i in range(len(ring) - 1):
        (xi, yi), (xj, yj) = ring[i], ring[i + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c
def ring_area(r): return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2
def read_shp(path, inv, keep):
    b = open(path, 'rb').read(); o = 100; out = []; idx = 0
    while o < len(b):
        _, clen = struct.unpack('>ii', b[o:o + 8]); rec = b[o + 8:o + 8 + clen * 2]; o += 8 + clen * 2
        st = struct.unpack('<i', rec[:4])[0]
        if st != 5 or not keep(idx): out.append(None); idx += 1; continue
        npart, npt = struct.unpack('<ii', rec[36:44])
        parts = list(struct.unpack(f'<{npart}i', rec[44:44 + 4 * npart])) + [npt]
        pts = struct.unpack(f'<{2 * npt}d', rec[44 + 4 * npart:44 + 4 * npart + 16 * npt])
        rings = []
        for a, z in zip(parts[:-1], parts[1:]):
            r = [list(inv(pts[2 * i], pts[2 * i + 1])) for i in range(a, z)]
            rings.append(r)
        # 방향만 믿지 않는다: 다른 고리 안에 들어 있는 고리만 구멍으로, 나머지는 모두 바깥 고리로 본다
        # (실제 학구도 파일에는 떨어진 영역이 반시계로 저장된 경우가 있어, 방향으로 나누면 그 영역이 사라진다)
        order = sorted(range(len(rings)), key=lambda k: -abs(ring_area(rings[k])))
        polys = []
        for k in order:
            r = rings[k]; x, y = r[0]
            host = next((p for p in polys if abs(ring_area(p[0])) > abs(ring_area(r)) and pip(x, y, p[0]) and not any(pip(x, y, h) for h in p[1:])), None)
            if host is not None: host.append(r)
            else: polys.append([r])
        for p in polys:  # GeoJSON 규약: 바깥 반시계, 구멍 시계
            p[0] = p[0][::-1] if ring_area(p[0]) < 0 else p[0]
            for k in range(1, len(p)): p[k] = p[k][::-1] if ring_area(p[k]) > 0 else p[k]
        out.append(polys); idx += 1
    return out

def dp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop(); ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy; best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
            d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best: best, bi = d, i
        if best > eps * eps: keep[bi] = True; st += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]
def simp(polys, eps, prec):
    out = []
    for poly in polys:
        rr = []
        for r in poly:
            s = [[round(x, prec), round(y, prec)] for x, y in dp(r, eps)]
            if s[0] != s[-1]: s.append(s[0])
            if len(s) >= 4: rr.append(s)
        if rr: out.append(rr)
    return out
def geom(polys):
    return {'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': polys}

def from_geojson(lv, src):
    """학구도안내시스템에서 받은 geojson(ArcGIS rings, 경위도) → 다각형 정리·단순화 후 저장"""
    g = json.load(open(src, encoding='utf-8'))
    feats = []
    for f in g['features']:
        p = f['properties']
        if not REG.search(str(p.get('EDU_NM', '')) + str(p.get('EDU_UP_NM', ''))) and 'EDU_NM' in p: continue
        rings = f['geometry']['coordinates'] if f['geometry']['type'] == 'Polygon' else [r for poly in f['geometry']['coordinates'] for r in poly]
        order = sorted(range(len(rings)), key=lambda k: -abs(ring_area(rings[k])))
        polys = []
        for k in order:
            r = rings[k]; x, y = r[0]
            host = next((q for q in polys if pip(x, y, q[0]) and not any(pip(x, y, h) for h in q[1:])), None)
            (host.append(r) if host is not None else polys.append([r]))
        for q in polys:
            q[0] = q[0][::-1] if ring_area(q[0]) < 0 else q[0]
            for k in range(1, len(q)): q[k] = q[k][::-1] if ring_area(q[k]) > 0 else q[k]
        feats.append({'type': 'Feature', 'properties': {'name': p.get('HAKGUDO_NAME') or p.get('HAKGUDO_NM') or p.get('name', ''), 'office': p.get('EDU_NM') or p.get('office', ''), 'id': p.get('HAKGUDO_ID') or p.get('id', '')}, 'geometry': geom(polys)})
    print(f'{lv}: {len(feats)}개 (geojson)')
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(ROOT, f'raw/zones_{lv}.geojson'), 'w', encoding='utf-8'), ensure_ascii=False)
    small = [{'type': 'Feature', 'properties': {'name': f['properties']['name'], 'office': f['properties']['office']},
              'geometry': geom(simp([f['geometry']['coordinates']] if f['geometry']['type'] == 'Polygon' else f['geometry']['coordinates'], 0.0003, 4))} for f in feats]
    json.dump({'type': 'FeatureCollection', 'features': small}, open(os.path.join(ROOT, f'docs/data/zones_{lv}.geojson'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

if __name__ == '__main__':
    lv, shp = sys.argv[1], sys.argv[2]
    if shp.lower().endswith(('.geojson', '.json')):
        from_geojson(lv, shp); sys.exit(0)
    base = shp[:-4]
    enc = 'cp949'
    if os.path.exists(base + '.cpg'):
        c = open(base + '.cpg').read().strip().lower(); enc = 'utf-8' if 'utf' in c else 'cp949'
    rows = read_dbf(base + '.dbf', enc)
    P = prj_params(open(base + '.prj').read()) if os.path.exists(base + '.prj') else prj_params('')
    inv = make_inv(P)
    officeKey = next((k for k in ('EDU_UP_NM', 'SD_NM', 'EDU_NM') if k in rows[0]), None)
    nameKey = next((k for k in ('HAKGUDO_NM', 'OFFICE_NM', 'NAME') if k in rows[0]), None)
    keep = lambda i: lv == 'test' or (officeKey and REG.search(rows[i][officeKey] or ''))
    geoms = read_shp(base + '.shp', inv, keep)
    feats = []
    for r, g in zip(rows, geoms):
        if not g: continue
        feats.append({'type': 'Feature', 'properties': {'name': r.get(nameKey, ''), 'office': r.get('EDU_NM') or r.get(officeKey, ''), 'id': r.get('HAKGUDO_ID', '')}, 'geometry': geom(g)})
    print(f'{lv}: {len(feats)}개 (필드 {list(rows[0])[:8]})')
    xs = [p[0] for f in feats for poly in ([f['geometry']['coordinates']] if f['geometry']['type'] == 'Polygon' else f['geometry']['coordinates']) for p in poly[0]]
    ys = [p[1] for f in feats for poly in ([f['geometry']['coordinates']] if f['geometry']['type'] == 'Polygon' else f['geometry']['coordinates']) for p in poly[0]]
    if xs: print('경위도 범위', round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3))
    if lv in ('e', 'm'):
        json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(ROOT, f'raw/zones_{lv}.geojson'), 'w', encoding='utf-8'), ensure_ascii=False)
        small = [{**f, 'geometry': geom(simp([f['geometry']['coordinates']] if f['geometry']['type'] == 'Polygon' else f['geometry']['coordinates'], 0.0003, 4))} for f in feats]
        small = [{'type': 'Feature', 'properties': {'name': f['properties']['name'], 'office': f['properties']['office']}, 'geometry': f['geometry']} for f in small]
        json.dump({'type': 'FeatureCollection', 'features': small}, open(os.path.join(ROOT, f'docs/data/zones_{lv}.geojson'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        print('저장 완료', os.path.getsize(os.path.join(ROOT, f'docs/data/zones_{lv}.geojson')) // 1024, 'KB')
    else:
        json.dump({'type': 'FeatureCollection', 'features': feats}, open('/tmp/claude-0/zone_test.geojson', 'w', encoding='utf-8'), ensure_ascii=False)
