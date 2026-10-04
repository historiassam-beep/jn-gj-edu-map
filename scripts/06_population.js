// 행정안전부 행정동별 1세 단위 주민등록 인구(raw/pop.csv, EUC-KR)와 학구 경계를 stats.json·schools.json에 붙인다
// 02_build.js 다음에 실행한다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const stats = rd('docs/data/stats.json');
const schools = rd('docs/data/schools.json');

/* ---------- 인구 ---------- */
const txt = new TextDecoder('euc-kr').decode(fs.readFileSync(path.join(ROOT, 'raw/pop.csv')));
const lines = txt.split(/\r?\n/).filter(Boolean);
const H = lines[0].split(',');
const col = (name) => H.indexOf(name);
const ageCols = (a) => [col(`${a}세남자`), col(`${a}세여자`)];
const month = lines[1].split(',')[col('기준연월')].replace(/\D/g, ''); // 예: 20260831
let hit = 0;
const pop = {};
for (const ln of lines.slice(1)) {
  const r = ln.split(',');
  if (!/광주|전라남|전남/.test(r[col('시도명')])) continue;
  const code = r[col('행정기관코드')];
  const age = (a) => ageCols(a).reduce((s, i) => s + (+r[i] || 0), 0);
  const range = (a, b) => { let s = 0; for (let x = a; x <= b; x++) s += age(x); return s; };
  pop[code] = { total: +r[col('계')] || 0, a0: range(0, 2), a6: range(6, 8), a0_5: range(0, 5), a6_11: range(6, 11), a12_17: range(12, 17), a0_14: range(0, 14) };
}
const r1 = (v) => (v === null || !isFinite(v) ? null : Math.round(v * 10) / 10);
for (const [code, e] of Object.entries(stats.emd)) {
  const p = pop[code];
  if (!p) { console.warn('인구 없음', e.sigun, e.emd, code); continue; }
  hit++;
  Object.assign(e, { pop: p.total, k05: p.a0_5, k611: p.a6_11, k014: p.a0_14, a0: p.a0, a6: p.a6,
    kidShare: p.total ? r1((p.a0_14 / p.total) * 100) : null });
}
console.log('읍면동 인구 연결', hit, '/', Object.keys(stats.emd).length, '기준', month);
for (const sg of Object.keys(stats.sigun)) {
  const es = Object.values(stats.emd).filter((e) => e.sigun === sg && e.pop !== undefined);
  const sum = (k) => es.reduce((a, e) => a + (e[k] || 0), 0);
  const s = stats.sigun[sg];
  Object.assign(s, { pop: sum('pop'), k05: sum('k05'), k611: sum('k611'), k014: sum('k014'), a0: sum('a0'), a6: sum('a6') });
  s.kidShare = s.pop ? r1((s.k014 / s.pop) * 100) : null;
  // 0~2세 ÷ 6~8세(지금 초1~3 또래): 몇 년 뒤 초등 입학생이 지금보다 얼마나 줄어드는지
  s.cohort = s.a6 ? r1((s.a0 / s.a6 - 1) * 100) : null;
}
for (const e of Object.values(stats.emd)) e.cohort = e.a6 >= 30 ? r1((e.a0 / e.a6 - 1) * 100) : null; // 6~8세가 30명 미만이면 비율이 튀므로 비움
const tot = (k) => Object.values(stats.sigun).reduce((a, s) => a + (s[k] || 0), 0);
stats.popTotal = { pop: tot('pop'), k05: tot('k05'), k611: tot('k611'), k014: tot('k014'), a0: tot('a0'), a6: tot('a6') };
stats.popTotal.cohort = r1((stats.popTotal.a0 / stats.popTotal.a6 - 1) * 100);
stats.meta.popMonth = `${month.slice(0, 4)}. ${+month.slice(4, 6)}.`;
stats.meta.sources = stats.meta.sources.filter((s) => !/주민등록|학구도|학교군 및 중학구 등에 관한 고시/.test(s.name)).concat([
  { name: '행정안전부 지역별(행정동) 성별 연령별 주민등록 인구수', url: 'https://www.data.go.kr/data/15097972/fileData.do', date: `${month.slice(0, 4)}. ${+month.slice(4, 6)}. 말` },
  ...(rd('docs/data/zones_m.geojson').features.length ? [{ name: '학구도 중학교학교군(한국교육시설안전원, 공공데이터포털)', url: 'https://www.data.go.kr', date: '2025-09-22' }] : []),
  ...(fs.existsSync(path.join(ROOT, 'raw/hakgun.json')) ? [{ name: '전남광주통합특별시교육청 고시 제2026-403호(안) 「중학교 학교군 및 중학구 등에 관한 고시」 행정예고(초·중학교 연결표)', url: 'https://www.jne.go.kr', date: '2026-10-01 예고' }] : []),
  ...(rd('docs/data/zones_e.geojson').features.length ? [{ name: '학구도 초등학교통학구역(한국지방교육행정연구재단, 공공데이터포털)', url: 'https://www.data.go.kr', date: '2025-09-22' }] : []),
]);
console.log('전남·광주 인구', stats.popTotal);

/* ---------- 학구: 학교 점이 들어가는 통학구역 ---------- */
function inRing(x, y, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
function ringKm2(ring, lat) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return Math.abs(a / 2) * 111.32 * 110.54 * Math.cos((lat * Math.PI) / 180); }
for (const [lv, kind, key] of [['e', '초등학교', 'ze'], ['m', '중학교', 'zm']]) {
  const z = rd(`docs/data/zones_${lv}.geojson`).features;
  z.forEach((f) => { const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; f._p = rings; const lat = rings[0][0][0][1]; f._km2 = rings.reduce((a, p) => a + ringKm2(p[0], lat) - p.slice(1).reduce((b, h) => b + ringKm2(h, lat), 0), 0); });
  let n = 0;
  // 중학교는 학구도 연결표(학교 ↔ 학구ID)가 있으면 그 ID로 먼저 잇고, 없으면 학교 점이 들어가는 학구를 쓴다
  const idIdx = {}, linkOf = {};
  if (lv === 'm' && fs.existsSync(path.join(ROOT, 'raw/midzones.json')) && fs.existsSync(path.join(ROOT, 'raw/zones_m.geojson'))) {
    rd('raw/zones_m.geojson').features.forEach((f, i) => { if (f.properties.id) idIdx[f.properties.id] = i; });
    for (const [zid, ids] of Object.entries(rd('raw/midzones.json'))) for (const id of ids) linkOf[id] = zid;
  }
  for (const s of schools.filter((x) => x.kind === kind)) {
    let i = linkOf[s.id] !== undefined && idIdx[linkOf[s.id]] !== undefined ? idIdx[linkOf[s.id]] : -1;
    if (i < 0) i = z.findIndex((f) => f._p.some((p) => inRing(s.lon, s.lat, p[0]) && !p.slice(1).some((h) => inRing(s.lon, s.lat, h))));
    if (i >= 0) { s[key] = i; s[key + 'n'] = z[i].properties.name; s[key + 'a'] = r1(z[i]._km2); n++; }
  }
  console.log(kind, '학구 연결', n, '/', schools.filter((x) => x.kind === kind).length);
}
fs.writeFileSync(path.join(ROOT, 'docs/data/stats.json'), JSON.stringify(stats));
fs.writeFileSync(path.join(ROOT, 'docs/data/schools.json'), JSON.stringify(schools));
