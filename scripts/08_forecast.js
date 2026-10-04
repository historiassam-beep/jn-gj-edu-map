// 학교별 학생 수 예측(2027~2032) — 비율법(cohort ratio)
// 1) 통학구역 ∩ 행정동 면적 비율로 학구 안 나이별 인구를 추정
// 2) 2026 실제 1학년 ÷ 학구 안 같은 출생 연도 인구 = 이 학교로 오는 비율(r)
// 3) 더 어린 출생 연도에 r을 곱해 해마다 입학생, 학교별 진급 비율로 학년을 올림
// 4) 중학교 입학생 = 중학구 안 초등학교 6학년(전년) × 비율
// 06_population.js 다음에 실행. 결과: schools[].pj, stats.sigun[].pj, stats.pjTotal
const fs = require('fs'), path = require('path');
// [전남광주판] turf 대신 추가 패키지 없는 계산: 행정동 안에 격자점을 찍어 학구별로 세어 겹치는 면적 비율을 구한다
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const inPolys = (ps, x, y) => ps.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
const bboxOf = (ps) => { let a = [999, 999, -999, -999]; for (const p of ps) for (const [x, y] of p[0]) { a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; } return a; };
const ROOT = path.join(__dirname, '..');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const schools = rd('docs/data/schools.json'), stats = rd('docs/data/stats.json');
const emds = rd('work/gb_emd_full.geojson').features;
const PY = [2027, 2028, 2029, 2030, 2031, 2032];

/* 행정동 1세 단위 인구 0~17세 (2026. 8. 말) */
const txt = new TextDecoder('euc-kr').decode(fs.readFileSync(path.join(ROOT, 'raw/pop.csv')));
const L = txt.split(/\r?\n/).filter(Boolean), H = L[0].split(','), c = (n) => H.indexOf(n);
const ages = {};
for (const ln of L.slice(1)) { const r = ln.split(','); if (!/광주|전라남|전남/.test(r[c('시도명')])) continue; ages[r[c('행정기관코드')]] = Array.from({ length: 18 }, (_, a) => (+r[c(`${a}세남자`)] || 0) + (+r[c(`${a}세여자`)] || 0)); }
// 출생 연도 B 인구 ≈ 만 나이(2026−B)의 M/12 + 만 나이(2025−B)의 (12−M)/12 (M월 말 기준, 출생 고르게 가정)
const POP_M = +(L[1].split(',')[c('기준연월')] || '').replace(/\D/g, '').slice(4, 6) || 8;
const born = (a, B) => (POP_M / 12) * (a[2026 - B] || 0) + ((12 - POP_M) / 12) * (a[2025 - B] || 0);
// 입학 연도 Y의 초1 = Y−7년생
const entryCohort = (a, Y) => born(a, Y - 7);

/* 학구 ∩ 행정동 → 학구의 나이별 인구 (격자점 표본: 행정동마다 약 1,500점) */
let ZW = null; // ZW[zi] = [[emd index, 면적 비율], ...]
function buildZoneWeights(zones) {
  const zp = zones.map((z) => polysOf(z.geometry)), zb = zp.map(bboxOf);
  ZW = zones.map(() => []);
  emds.forEach((e, i) => {
    const ps = polysOf(e.geometry), b = bboxOf(ps);
    const cand = zb.map((q, zi) => (q[0] > b[2] || q[2] < b[0] || q[1] > b[3] || q[3] < b[1] ? -1 : zi)).filter((zi) => zi >= 0);
    if (!cand.length) return;
    const N = 60, cnt = {}; let tot = 0;
    for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
      const x = b[0] + ((gx + 0.5) / N) * (b[2] - b[0]), y = b[1] + ((gy + 0.5) / N) * (b[3] - b[1]);
      if (!inPolys(ps, x, y)) continue;
      tot++;
      for (const zi of cand) { const q = zb[zi]; if (x < q[0] || x > q[2] || y < q[1] || y > q[3]) continue; if (inPolys(zp[zi], x, y)) { cnt[zi] = (cnt[zi] || 0) + 1; break; } }
    }
    if (tot) for (const [zi, n] of Object.entries(cnt)) ZW[zi].push([i, n / tot]);
  });
}
function zoneAges(zone, zi) {
  const out = new Array(18).fill(0);
  for (const [i, w] of ZW[zi]) { const a = ages[emds[i].properties.code]; if (!a) continue; for (let k = 0; k < 18; k++) out[k] += w * a[k]; }
  return out;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const med = (a) => { const b = a.filter((v) => isFinite(v)).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };

/* 진급 비율: 학교 값을 시군 값 쪽으로 당긴다(작은 학교는 흔들림이 크므로) */
function survival(s, grades) {
  if (!s.g25) return null;
  const prev = sum(s.g25.slice(0, grades - 1)), now = sum(s.g.slice(1, grades));
  return prev ? { v: now / prev, n: prev } : null;
}
const sgSurv = {};
for (const kind of ['초등학교', '중학교', '고등학교']) {
  const gr = kind === '초등학교' ? 6 : 3;
  for (const sg of Object.keys(stats.sigun)) {
    const xs = schools.filter((s) => s.kind === kind && s.sigun === sg).map((s) => survival(s, gr)).filter(Boolean);
    const p = sum(xs.map((x) => x.n)), q = sum(xs.map((x) => x.v * x.n));
    (sgSurv[kind] ||= {})[sg] = p ? clamp(q / p, 0.9, 1.08) : 1;
  }
}
const survOf = (s, gr) => { const x = survival(s, gr), base = sgSurv[s.kind][s.sigun]; return x ? clamp((x.n * x.v + 40 * base) / (x.n + 40), 0.85, 1.1) : base; };

/* ---------- 초등학교 ---------- */
const zonesE = rd('docs/data/zones_e.geojson').features; // 06과 같은 순서(학교의 ze 번호)
const els = schools.filter((s) => s.kind === '초등학교' && !s.state);
const byZoneE = {}; els.forEach((s) => { if (s.ze !== undefined) (byZoneE[s.ze] ||= []).push(s); });
const zAgeE = {};
let t0 = Date.now();
buildZoneWeights(zonesE);
for (const zi of Object.keys(byZoneE)) zAgeE[zi] = zoneAges(zonesE[zi], zi);
{ // 검산: 모든 학구에 나눠 담은 0~5세 합 ÷ 지역 전체 0~5세(학구 밖 바다·겹침이 없으면 100%에 가까워야 함)
  let inZ = 0, all = 0; for (const a of Object.values(ages)) all += a.slice(0, 6).reduce((x, y) => x + y, 0);
  zonesE.forEach((z, zi) => { inZ += zoneAges(z, zi).slice(0, 6).reduce((x, y) => x + y, 0); });
  console.log('학구에 담긴 0~5세', Math.round(inZ), '/', all, (inZ / all * 100).toFixed(1) + '%');
  if (process.env.COV) {
    const cov = new Array(emds.length).fill(0); ZW.forEach((l) => l.forEach(([i, w]) => (cov[i] += w)));
    emds.map((e, i) => { const k = (ages[e.properties.code] || []).slice(0, 6).reduce((x, y) => x + y, 0); return [e.properties.sigun, e.properties.emd, cov[i], k, k * (1 - cov[i])]; })
      .sort((x, y) => y[4] - x[4]).slice(0, 15).forEach((r) => console.log(`  ${r[0]} ${r[1]} 덮임 ${(r[2] * 100).toFixed(0)}% 0~5세 ${r[3]} 빠짐 ${Math.round(r[4])}`));
  }
}
console.log('초등 학구 인구 계산', Object.keys(zAgeE).length, '곳', ((Date.now() - t0) / 1000).toFixed(1) + '초');
// 비율 r 계산(공동학구는 올해 1학년 비중으로 나눔)
const rE = [];
for (const [zi, list] of Object.entries(byZoneE)) {
  const g1 = sum(list.map((s) => s.g[0]));
  for (const s of list) {
    s._share = g1 ? (s.g[0] || 0) / g1 : 1 / list.length;
    const base = s._share * entryCohort(zAgeE[zi], 2026);
    s._r = base >= 3 ? (s.g[0] || 0) / base : null;
    if (s._r !== null) rE.push({ sg: s.sigun, r: s._r });
  }
}
const rMedSg = {}; for (const sg of Object.keys(stats.sigun)) rMedSg[sg] = med(rE.filter((x) => x.sg === sg).map((x) => x.r)) ?? 1;
function projectElem(s) {
  const a = s.ze !== undefined ? zAgeE[s.ze] : null;
  const r = clamp(s._r ?? rMedSg[s.sigun], 0, 60), sv = survOf(s, 6); // 도시 학구는 면적 비례 인구가 작게 잡혀 r이 크다 — 비율법이라 그대로 써야 합이 맞음
  let g = s.g.map((v) => v || 0);
  const out = { stu: [], g1: [], g6: [] };
  for (const Y of PY) {
    const e1 = a ? r * s._share * entryCohort(a, Y) : (s.g[0] || 0);
    g = [e1, ...g.slice(0, 5).map((v) => v * sv)];
    out.stu.push(Math.round(sum(g))); out.g1.push(Math.round(e1)); out.g6.push(g[5]);
  }
  return out;
}
for (const s of els) { const p = projectElem(s); s.pj = { stu: p.stu, g1: p.g1, how: s.ze !== undefined ? (s._r !== null ? 'zone' : 'zone-sg') : 'flat' }; s._g6 = p.g6; }
// 학구 안 0~5세(앞으로 이 학교에 올 아이들), 공동학구는 올해 1학년 비중으로 나눔
for (const s of els) if (s.ze !== undefined && zAgeE[s.ze]) s.pj.kids05 = Math.round(s._share * zAgeE[s.ze].slice(0, 6).reduce((x, y) => x + y, 0));

/* ---------- 중학교 ---------- */
const zonesM = fs.existsSync(path.join(ROOT, 'docs/data/zones_m.geojson')) ? rd('docs/data/zones_m.geojson').features : [];
function inZone(z, lon, lat) { return inPolys(polysOf(z.geometry), lon, lat); }
const mids = schools.filter((s) => s.kind === '중학교' && !s.state);
// 중학구 자료가 없으면 시군구를 하나의 '중학구'로 본다(같은 시군구 초6 → 중1 흐름)
const NO_ZM = !zonesM.length;
// 광주 4개 구는 배정 시행계획의 학교군표(raw/hakgun.json: 학교군별 초·중 목록)를 우선 쓴다
const HK = fs.existsSync(path.join(ROOT, 'raw/hakgun.json')) ? rd('raw/hakgun.json') : {};
const hkOf = {}, hkE = {}; for (const [g, v] of Object.entries(HK)) { if (g[0] === '_') continue; hkE[g] = new Set(v.e); for (const id of v.m) hkOf[id] = g; }
// 학교군표가 없는 지역(광산구·전남): 학구도 연결표(raw/midzones.json)로 같은 학교군·중학구에 묶인 중학교를 알 수 있다.
// 어느 초등학교가 어느 중학구로 가는지는 경계 자료가 없어서, 같은 시군구에서 가장 가까운 중학교의 학교군으로 근사한다.
const MZ = fs.existsSync(path.join(ROOT, 'raw/midzones.json')) ? rd('raw/midzones.json') : {};
const mzOf = {}; for (const [z, ids] of Object.entries(MZ)) for (const id of ids) mzOf[id] = z;
const dist2 = (a, b) => (a.lon - b.lon) ** 2 + ((a.lat - b.lat) * 1.2) ** 2;
const midsSg = {}; for (const m of mids) if (mzOf[m.id] && !hkOf[m.id]) (midsSg[m.sigun] ||= []).push(m);
const nearZone = {}; // 초등학교 id -> 학교군(Z…)
for (const e of els) { const c = midsSg[e.sigun]; if (!c || hkE_has(e.id)) continue; let b = null, bd = 1e9; for (const m of c) { const d = dist2(e, m); if (d < bd) { bd = d; b = m; } } if (b) nearZone[e.id] = mzOf[b.id]; }
function hkE_has(id) { return Object.values(hkE).some((st) => st.has(id)); }
const byZoneM = {}; mids.forEach((s) => { const k = hkOf[s.id] ? 'hk:' + hkOf[s.id] : mzOf[s.id] ? 'mz:' + mzOf[s.id] : NO_ZM ? s.sigun : s.zm; if (k !== undefined) (byZoneM[k] ||= []).push(s); });
for (const [zi, list] of Object.entries(byZoneM)) {
  let feeders = zi.startsWith('mz:') ? els.filter((e) => nearZone[e.id] === zi.slice(3)) : null;
  if (feeders && !feeders.length) feeders = els.filter((e) => list.some((m) => m.sigun === e.sigun));
  if (!feeders) feeders = zi.startsWith('hk:') ? els.filter((e) => hkE[zi.slice(3)].has(e.id)) : NO_ZM ? els.filter((e) => e.sigun === zi) : els.filter((e) => inZone(zonesM[zi], e.lon, e.lat));
  const g6now = sum(feeders.map((e) => (e.g25 ? e.g25[5] : 0))); // 올해 중1 = 작년 초6
  const g1 = sum(list.map((s) => s.g[0]));
  for (const s of list) {
    s._share = g1 ? (s.g[0] || 0) / g1 : 1 / list.length;
    s._r = g6now * s._share >= 3 ? (s.g[0] || 0) / (g6now * s._share) : null;
    s._feed = feeders;
  }
}
// 가까운 중학교로 근사한 학교군 연결은 틀릴 수 있어서, 같은 시군구 흐름과 크게 어긋나는 학교(연결된 초등 6학년 수와 실제 입학생이 안 맞음)는 시군구 흐름으로 되돌린다.
{
  const sgMids = {}; for (const m of mids) if (mzOf[m.id] && !hkOf[m.id]) (sgMids[m.sigun] ||= []).push(m);
  for (const [sg, list] of Object.entries(sgMids)) {
    const feeders = els.filter((e) => e.sigun === sg), g6now = sum(feeders.map((e) => (e.g25 ? e.g25[5] : 0))), g1 = sum(list.map((m) => m.g[0]));
    for (const m of list) {
      const sh = g1 ? (m.g[0] || 0) / g1 : 1 / list.length, rSg = g6now * sh >= 3 ? (m.g[0] || 0) / (g6now * sh) : null;
      m._sg = { feed: feeders, share: sh, r: rSg };
      const ratio = m._r != null && rSg ? m._r / rSg : null;
      if (ratio === null || ratio < 0.67 || ratio > 1.5) { m._feed = feeders; m._share = sh; m._r = rSg; m._back = true; }
    }
  }
}
const rM = mids.filter((s) => s._r !== undefined && s._r !== null);
const rMsg = {}; for (const sg of Object.keys(stats.sigun)) rMsg[sg] = med(rM.filter((s) => s.sigun === sg).map((s) => s._r)) ?? 1;
function projMid(s, feed, share, rr) {
  const sv = survOf(s, 3), r = clamp(rr ?? rMsg[s.sigun], 0, 60);
  let g = s.g.slice(0, 3).map((v) => v || 0);
  const out = [], g1s = [], mg3 = [];
  PY.forEach((Y, k) => {
    // Y년 중1 = (Y−1)년 초6. 2027년은 2026 실제 초6, 그 뒤는 예측
    const g6prev = feed ? sum(feed.map((e) => (k === 0 ? e.g[5] || 0 : e._g6[k - 1]))) : null;
    const e1 = feed && feed.length ? r * share * g6prev : (s.g[0] || 0);
    g = [e1, g[0] * sv, g[1] * sv];
    out.push(Math.round(sum(g))); g1s.push(Math.round(e1)); mg3.push(g[2]);
  });
  return { out, g1s, mg3 };
}
for (const s of mids) {
  let P = projMid(s, s._feed, s._share, s._r), how = s._feed && s._feed.length ? (hkOf[s.id] ? 'hakgun' : mzOf[s.id] ? (s._back ? 'sg-mid' : 'near-mid') : NO_ZM ? 'sg-mid' : 'zone') : 'flat';
  if (how === 'near-mid' && s._sg) { // 가까운 학교 기준 추정이 시군구 흐름 추정과 2배 넘게 벌어지면 연결을 믿기 어려워 시군구 흐름으로 되돌린다
    const Q = projMid(s, s._sg.feed, s._sg.share, s._sg.r), q = Q.out[5], n = P.out[5];
    if (q > 0 && (n / q > 1.6 || n / q < 0.625)) { P = Q; how = 'sg-mid'; }
  }
  s._mg3 = P.mg3; s.pj = { stu: P.out, g1: P.g1s, how };
}

/* ---------- 고등학교 ----------
   통학구역이 없어 학구 인구를 쓸 수 없다. Y년 고1 = 2026 실제 고1 × (Y−1년 중3 ÷ 2025년 중3)
   일반고는 같은 시군, 일반고 외 학교는 유형별 모집권역 자료가 없어 전남·광주 전체 중3 흐름을 쓴다.
   이는 입학 가능성이나 배정이 아니라 재학생 규모 시나리오다. */
const highs = schools.filter((s) => s.kind === '고등학교' && !s.state);
const WIDE = (s) => s.sub && s.sub !== '일반고등학교';
const mg3 = (list, k) => sum(list.map((m) => (k < 0 ? (m.g25 ? m.g25[2] : 0) : k === 0 ? m.g[2] || 0 : m._mg3[k - 1]))); // k: PY 인덱스(−1=2025, 0=2026 실제)
const midsBySg = {}; for (const m of mids) (midsBySg[m.sigun] ||= []).push(m);
for (const s of highs) {
  const pool = WIDE(s) ? mids : midsBySg[s.sigun] || mids;
  const base = mg3(pool, -1), sv = survOf(s, 3);
  let g = s.g.slice(0, 3).map((v) => v || 0);
  const out = [], g1s = [];
  PY.forEach((Y, k) => {
    const e1 = base ? (s.g[0] || 0) * (mg3(pool, k) / base) : (s.g[0] || 0);
    g = [e1, g[0] * sv, g[1] * sv];
    out.push(Math.round(sum(g))); g1s.push(Math.round(e1));
  });
  s.pj = { stu: out, g1: g1s, how: WIDE(s) ? 'gb' : 'sg' };
}

/* ---------- 결과 정리 ---------- */
for (const s of schools) {
  for (const k of Object.keys(s)) if (k.startsWith('_')) delete s[k];
  if (s.pj && s.kind !== '고등학교') {
    const below = PY.findIndex((y, i) => s.pj.stu[i] <= 60);
    s.pj.below60 = (s.stu[4] || 0) > 60 && below >= 0 ? PY[below] : null;
  }
}
const pjSum = (list) => PY.map((_, i) => sum(list.map((s) => (s.pj ? s.pj.stu[i] : 0))));
const actSum = (list, yi) => sum(list.map((s) => s.stu[yi]));
for (const sg of Object.keys(stats.sigun)) {
  const l = schools.filter((s) => s.sigun === sg && s.pj && s.kind !== '고등학교');
  // 초·중 학생: 2022~2026 실제(지금 있는 학교 기준) + 2027~2032 예측
  stats.sigun[sg].pj = [...[0, 1, 2, 3, 4].map((yi) => actSum(l, yi)), ...pjSum(l)];
  const a = stats.sigun[sg].pj;
  stats.sigun[sg].pjChg = a[4] ? Math.round((a[9] / a[4] - 1) * 1000) / 10 : null; // 2026→2031
  stats.sigun[sg].pjBelow = l.filter((s) => s.pj.below60 && s.pj.below60 <= 2031).length;
}
const all = schools.filter((s) => s.pj && s.kind !== '고등학교');
stats.pjTotal = { years: [2022, 2023, 2024, 2025, 2026, ...PY], stu: [...[0, 1, 2, 3, 4].map((yi) => actSum(all, yi)), ...pjSum(all)] };
stats.pjTotal.elem = pjSum(els); stats.pjTotal.mid = pjSum(mids);
stats.pjTotal.high = [...[0, 1, 2, 3, 4].map((yi) => actSum(highs, yi)), ...pjSum(highs)]; // 2022~2032, 고등학교(시군 흐름 어림)
stats.pjTotal.below = all.filter((s) => s.pj.below60 && s.pj.below60 <= 2031).length;
stats.pjTotal.small2031 = all.filter((s) => s.pj.stu[4] <= 60).length;
stats.pjTotal.small2026 = all.filter((s) => (s.stu[4] || 0) <= 60).length;
stats.meta.forecast = '비율법: 2026 실제 입학생 ÷ 학구 안 같은 출생 연도 인구 비율을 어린 연령에 적용, 진급 비율은 2025→2026 학교·시군 값';
fs.writeFileSync(path.join(ROOT, 'docs/data/schools.json'), JSON.stringify(schools));
fs.writeFileSync(path.join(ROOT, 'docs/data/stats.json'), JSON.stringify(stats));
const T = stats.pjTotal;
console.log('초·중 합계', T.years.map((y, i) => `${y}:${T.stu[i]}`).join(' '));
console.log('60명 이하 2026→2031', T.small2026, '→', T.small2031, '· 새로 60명 아래로', T.below);
console.log('고등 합계', stats.pjTotal.high.join(' '));
console.log('예측 방법', Object.entries(all.reduce((o, s) => ((o[s.pj.how] = (o[s.pj.how] || 0) + 1), o), {})));
const ex = [].map((n) => schools.find((s) => s.name === n)).filter(Boolean);
ex.forEach((s) => console.log(s.name, s.stu.join('/'), '→', s.pj.stu.join('/'), '입학', s.pj.g1.join('/')));
