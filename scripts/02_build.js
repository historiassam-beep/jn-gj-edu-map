// 전남광주교육지도 자료 만들기 (원작: 경북교육지도 @kimju.zip, github.com/kimju1416/gb-edu-map)
// 입력: work/kess_YYYY.json(01_kess_extract.py), raw/schloc.csv, raw/closed.json, raw/byeokji.json, work/gb_emd_full.geojson
// 출력: docs/data/schools.json, closed.json, stats.json
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const YEARS = [2022, 2023, 2024, 2025, 2026];
const LAST = 2026;
const KINDS = ['초등학교', '중학교', '고등학교', '특수학교'];
const SMALL_LIMIT = 60; // 소규모학교: 학생 60명 이하(교육부 적정규모 권고 기준의 면·도서벽지 기준)

// 인구감소지역(행정안전부 2021 지정) · 인구감소관심지역(2025-12 지정)
// 전남 16개 군(2021-10 지정). 관심지역: 광주 동구(2025-09 기준 18곳 목록). 재지정 시 행정안전부 고시로 갱신할 것
const DECLINE = ['강진군', '고흥군', '곡성군', '구례군', '담양군', '보성군', '신안군', '영광군', '영암군', '완도군', '장성군', '장흥군', '진도군', '함평군', '해남군', '화순군'];
const DECLINE_WATCH = ['광주 동구'];
const plainSgg = (s) => (s || '').replace(/^광주 /, '');

// ---------- 경계: 점이 어느 읍면동에 들어가는지 ----------
const emdGeo = rd('work/gb_emd_full.geojson');
const emdList = emdGeo.features.map((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let minX = 999, minY = 999, maxX = -999, maxY = -999, ax = 0, ay = 0, aa = 0;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      const cr = x1 * y2 - x2 * y1;
      aa += cr; ax += (x1 + x2) * cr; ay += (y1 + y2) * cr;
      minX = Math.min(minX, x2); maxX = Math.max(maxX, x2); minY = Math.min(minY, y2); maxY = Math.max(maxY, y2);
    }
  }
  return { ...f.properties, polys, bbox: [minX, minY, maxX, maxY], cx: ax / (3 * aa), cy: ay / (3 * aa), area: Math.abs(aa / 2) };
});
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function findEmd(lon, lat) {
  for (const e of emdList) {
    const b = e.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const poly of e.polys) {
      if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h))) return e;
    }
  }
  return null;
}
// 면적 가중 대표점이 폴리곤 밖이면(오목한 모양) 안쪽 점을 찾는다
for (const e of emdList) {
  if (findEmd(e.cx, e.cy) !== e) {
    const ring = e.polys.reduce((a, p) => (p[0].length > a.length ? p[0] : a), []);
    const [x0, y0, x1, y1] = e.bbox;
    let best = null;
    for (let gx = 1; gx < 20 && !best; gx++) for (let gy = 1; gy < 20; gy++) {
      const x = x0 + ((x1 - x0) * gx) / 20, y = y0 + ((y1 - y0) * gy) / 20;
      if (inRing(x, y, ring)) { const d = (x - e.cx) ** 2 + (y - e.cy) ** 2; if (!best || d < best.d) best = { x, y, d }; }
    }
    if (best) { e.cx = best.x; e.cy = best.y; }
  }
}

function nearestEmd(lon, lat) {
  let best = null, bd = Infinity;
  for (const e of emdList) { const d = (e.cx - lon) ** 2 + ((e.cy - lat) * 1.2) ** 2; if (d < bd) { bd = d; best = e; } }
  return bd < 0.0004 ? best : null; // 약 2km 안에서만
}
// ---------- 학교 위치 표준데이터 ----------
function parseCsv(txt) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const locRows = parseCsv(fs.readFileSync(path.join(ROOT, 'raw/schloc.csv'), 'utf8').replace(/^﻿/, ''));
const LH = locRows[0];
const loc = locRows.slice(1).filter((r) => /광주|전라남|전남/.test(r[LH.indexOf('시도교육청명')]))
  .map((r) => Object.fromEntries(LH.map((h, i) => [h, r[i]])));
const fallbackPath = path.join(ROOT, 'work/geo_fallback.json');
const fallback = fs.existsSync(fallbackPath) ? rd('work/geo_fallback.json') : {};
const locByName = {};
for (const l of loc) (locByName[l['학교명']] ||= []).push(l);

// ---------- KESS 5개년 ----------
const nm = (s) => (s || '').replace(/\s+/g, '');
const kess = {};
for (const y of YEARS) {
  kess[y] = rd(`work/kess_${y}.json`).filter((r) => KINDS.includes(r.kind));
}
const keyOf = (r) => `${r.kind}|${r.sgg}|${nm(r.name)}`;
// 주소 키: 도로명+건물번호까지만(2026 KESS는 주소 뒤에 학교 이름이 괄호 없이 붙음)
const addrKey = (r) => { const a = (r.addr || '').replace(/\s+/g, ' ').match(/^(.*?(?:로|길)\s*\d+(?:-\d+)?)/); return a ? `${r.kind}|${r.sgg}|${nm(a[1])}` : null; };
const byYear = {}, byAddr = {};
const AMBIG = { ambiguous: true };
for (const y of YEARS) {
  byYear[y] = {}; byAddr[y] = {};
  for (const r of kess[y]) { const ak = addrKey(r); if (!ak) continue; byAddr[y][ak] = byAddr[y][ak] && byAddr[y][ak] !== r ? AMBIG : r; } // 한 주소에 같은 학교급이 둘이면 잇지 않는다
  for (const r of kess[y]) {
    const k = keyOf(r);
    if (byYear[y][k]) console.warn('중복', y, k); // 같은 이름 학교
    byYear[y][k] = r;
  }
}

// 도서벽지
const byeokji = rd('raw/byeokji.json').filter((b) => b.isSchool);
// 법령 별표의 옛 이름 → 지금 이름
// 도서벽지 별표의 학교명과 KESS 학교명이 다른 경우의 대응표(전남·광주용으로 직접 채울 것)
const BJ_ALIAS = {};
// 같은 이름 학교가 여러 시군에 있으므로(예: 신기초 구미·문경) 시군까지 맞춘다
const bjKey = (sigun, name) => `${sigun}|${nm(name)}`;
const bjByName = Object.fromEntries(byeokji.map((b) => [bjKey(b.area.split(' ')[0], BJ_ALIAS[b.school] || b.school), b]));

// ---------- 학교 목록(2026 기준, 폐교 제외) ----------
const n = (v) => (v === null || v === undefined || v === '' ? null : +v);
const r1 = (v) => (v === null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const schools = [];
const unmatchedLoc = [];
const relinked = [];
for (const r of kess[LAST]) {
  if (r.state === '폐(원)교') continue;
  const k = keyOf(r);
  let cands = (locByName[r.name] || locByName[nm(r.name)] || []).filter((c) => c['교육지원청명'].includes(r.office) || c['소재지도로명주소'].includes(plainSgg(r.sgg)));
  if (cands.length > 1) cands = cands.filter((c) => c['학교급구분'] === r.kind);
  const l = cands[0];
  let lat, lon, geo;
  if (l) { lat = +l['위도']; lon = +l['경도']; }
  else if (fallback[`${r.sgg}|${r.name}`]) {
    const f = fallback[`${r.sgg}|${r.name}`]; lat = f.lat; lon = f.lon; geo = f.how;
    const fe = f.emd && emdList.find((e) => e.sigun === r.sgg && e.emd === f.emd); // 읍면 대표점은 02의 '안쪽 대표점'으로 맞춘다(섬 많은 동에서 바다에 찍히지 않게)
    if (fe) { lat = fe.cy; lon = fe.cx; }
  }
  else { unmatchedLoc.push({ sgg: r.sgg, name: r.name, kind: r.kind, office: r.office, addr: r.addr }); continue; }
  const emd = findEmd(lon, lat) || nearestEmd(lon, lat); // 경계 틈에 걸린 점은 가장 가까운 읍면동 대표점으로
  // 이름이 바뀐 학교는 같은 주소로 지난 해 자료를 잇는다
  // 옛 이름: 03 스크립트가 찾은 alias/addr 연결을 그대로 쓴다
  const oldName = geo && /^(alias|addr):/.test(geo) ? geo.split(':')[1] : null;
  const ak = addrKey(r);
  const rowOf = (y) => byYear[y][k] || (oldName && byYear[y][`${r.kind}|${r.sgg}|${nm(oldName)}`]) || (ak && byAddr[y][ak] !== AMBIG && byAddr[y][ak]) || null;
  const linked = YEARS.some((y) => y < LAST && !byYear[y][k] && rowOf(y));
  if (linked) relinked.push(r.name);
  const series = (f) => YEARS.map((y) => (rowOf(y) ? n(rowOf(y)[f]) : null));
  const stu = series('students');
  const bj = bjByName[bjKey(r.sgg, r.name)];
  schools.push({
    id: r.kedi, name: r.name, kind: r.kind, sub: r.subType !== r.kind ? r.subType : undefined,
    sigun: r.sgg, emd: emd ? emd.emd : null, emdCode: emd ? emd.code : null,
    lat: +lat.toFixed(5), lon: +lon.toFixed(5),
    found: r.found, coed: r.coed || undefined, branch: r.branch === '분교장' ? 1 : undefined,
    state: r.state === '기존(원)교' ? undefined : r.state.replace('(원)교', ''),
    region: r.region, opened: r.opened, addr: r.addr, tel: (r.tel || '').replace(/\s+/g, ''), web: r.web || undefined,
    stu, cls: series('classes'), tch: series('teachers'),
    g: [r.g1, r.g2, r.g3, r.g4, r.g5, r.g6].map(n),
    g25: rowOf(2025) ? ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((f) => n(rowOf(2025)[f])) : null, // 학년 진급 비율 계산용
    perClass: n(r.perClass), perTeacher: n(r.perTeacher),
    tReg: n(r.teachersReg), tTmp: n(r.teachersTemp), staff: n(r.staff),
    spClass: r.kind === '특수학교' ? null : n(r.spClass), spStu: r.kind === '특수학교' ? null : n(r.spStu), entrants: n(r.entrants),
    moveIn: n(r.in), moveOut: n(r.out),
    rooms: [r.rmGen, r.rmSubj, r.rmSpec, r.rmLvl, r.rmEtc].map(n),
    site: n(r.site), sitePer: stu[4] ? r1(n(r.site) / stu[4]) : null,
    _rows: YEARS.map(rowOf),
    geo, bj: bj ? `${bj.category}${bj.grade === '벽지' || bj.grade === '도서' ? '' : ' ' + bj.grade}` : undefined,
  });
}
fs.writeFileSync(path.join(ROOT, 'work/unmatched.json'), JSON.stringify(unmatchedLoc, null, 1));
if (unmatchedLoc.length) console.warn('좌표 못 찾음', unmatchedLoc.length, unmatchedLoc.map((u) => u.name));
const noEmd = schools.filter((s) => !s.emd);
if (noEmd.length) console.warn('읍면동 밖 좌표', noEmd.map((s) => s.name));

// 가장 가까운 같은 학교급 학교(직선거리 km)
const R = 6371;
const dist = (a, b) => {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
for (const s of schools) {
  if (s.kind === '특수학교') continue;
  let best = null;
  for (const t of schools) {
    if (t === s || t.kind !== s.kind || t.state === '휴') continue;
    const d = dist(s, t);
    if (!best || d < best.d) best = { d, name: t.name, sg: t.sigun };
  }
  if (best) { s.near = r1(best.d); s.nearName = best.name; s.nearSg = best.sg; }
}

// ---------- 폐교(표준데이터) → 읍면 대표점 ----------
const closedRaw = rd('raw/closed.json').filter((r) => /광주|전라남|전남/.test(r.CTPV_NM));
const emdBySigun = {};
for (const e of emdList) (emdBySigun[e.sigun] ||= []).push(e);
const closed = [];
const slot = {};
for (const c of closedRaw) {
  const sigun0 = c.SGG_NM.replace(/^(광주광역시|전라남도|전남광주통합특별시)\s*/, '').replace(/\s.*$/, '');
  const sigun = /구$/.test(sigun0) ? '광주 ' + sigun0 : sigun0;
  const toks = [c.LNMADR, c.RDNMADR].filter(Boolean).map((a) => a.split(/\s+/));
  let e = null;
  for (const t of toks) {
    const cand = t.find((w, i) => i >= 2 && /[읍면동]$/.test(w));
    if (!cand) continue;
    e = (emdBySigun[sigun] || []).find((x) => x.emd === cand) ||
        (emdBySigun[sigun] || []).find((x) => x.emd.replace(/\d+동$/, '동').startsWith(cand.replace(/동$/, '')));
    if (e) break;
  }
  const baseE = e;
  const key = baseE ? baseE.code : sigun;
  const i = (slot[key] = (slot[key] || 0) + 1) - 1;
  // 같은 읍면 안에서 겹치지 않도록 대표점 둘레에 나선형으로 놓는다
  let lon, lat, approx;
  if (baseE) {
    const r = Math.sqrt(baseE.area) * 0.12 * Math.sqrt(i);
    const a = i * 2.399963;
    lon = baseE.cx + (i ? r * Math.cos(a) : 0); lat = baseE.cy + (i ? r * Math.sin(a) * 0.8 : 0);
    approx = 'emd';
  } else {
    const es = emdBySigun[sigun] || [];
    const big = es.reduce((a, x) => (!a || x.area > a.area ? x : a), null);
    const r = Math.sqrt(big.area) * 0.12 * Math.sqrt(i), a = i * 2.399963;
    lon = big.cx + (i ? r * Math.cos(a) : 0); lat = big.cy + (i ? r * Math.sin(a) * 0.8 : 0); approx = 'sigun';
  }
  closed.push({
    name: c.CLS_CO_NM, kind: c.SCHL_RK_SE_NM, year: n(c.CLS_CO_YR), use: c.PRCUSE_STUS_SE_NM,
    sigun, emd: baseE ? baseE.emd : null, approx, lat: +lat.toFixed(5), lon: +lon.toFixed(5),
    site: n(c.SITE), bldg: n(c.BLDG_TOTAREA), addr: c.LNMADR || c.RDNMADR, office: c.ED_NM.replace(/^(광주광역시|전라남도|전남광주통합특별시)(교육청)?\s*/, ''), date: c.CRTR_YMD,
  });
}
console.log('폐교', closed.length, '읍면 배치', closed.filter((c) => c.approx === 'emd').length);

// ---------- 시군·읍면 통계 ----------
const SIGUN = [...new Set(emdList.map((e) => e.sigun))];
function aggregate(rows, y) {
  const main = rows.filter((r) => r.branch !== '분교장');
  const stu = rows.reduce((a, r) => a + (n(r.students) || 0), 0);
  const cls = rows.reduce((a, r) => a + (n(r.classes) || 0), 0);
  const tch = rows.reduce((a, r) => a + (n(r.teachers) || 0), 0);
  const site = rows.some((r) => n(r.site) !== null) ? rows.reduce((a, r) => a + (n(r.site) || 0), 0) : null; // 교지 자료가 없으면 null
  const act = rows.filter((r) => r.state !== '휴(원)교' && r.state !== '폐(원)교');
  const small = act.filter((r) => r.kind !== '특수학교' && (n(r.students) || 0) <= SMALL_LIMIT).length;
  const nonSp = act.filter((r) => r.kind !== '특수학교').length;
  const zero = act.filter((r) => ['초등학교', '중학교', '고등학교'].includes(r.kind) && (n(r.entrants) || 0) === 0).length;
  const rural = act.filter((r) => r.region === '면지역' || r.region === '특수지역').length;
  return {
    students: stu, schools: main.filter((r) => r.state !== '폐(원)교').length, campuses: rows.filter((r) => r.state !== '폐(원)교').length,
    classes: cls, teachers: tch,
    perClass: cls ? r1(stu / cls) : null, perTeacher: tch ? r1(stu / tch) : null,
    sitePer: stu && site !== null ? r1(site / stu) : null,
    small, smallShare: nonSp ? r1((small / nonSp) * 100) : null,
    zero, ruralShare: act.length ? r1((rural / act.length) * 100) : null,
    // 특수학교 행은 특수학급 칸에 전교생이 들어 있으므로 학급 합계에서 빼고, 학생은 전교생으로 한 번만 센다
    spClass: rows.filter((r) => r.kind !== '특수학교').reduce((a, r) => a + (n(r.spClass) || 0), 0),
    spStu: rows.filter((r) => r.kind !== '특수학교').reduce((a, r) => a + (n(r.spStu) || 0), 0) + rows.filter((r) => r.kind === '특수학교').reduce((a, r) => a + (n(r.students) || 0), 0),
    closedNow: rows.filter((r) => r.state === '휴(원)교').length,
  };
}
const stats = { years: YEARS, total: {}, sigun: {}, emd: {} };
const byKind = (rows, k) => (k === 'all' ? rows : rows.filter((r) => r.kind === k));
for (const k of ['all', ...KINDS]) {
  stats.total[k] = YEARS.map((y) => aggregate(byKind(kess[y], k), y));
  for (const sg of SIGUN) {
    (stats.sigun[sg] ||= {})[k] = YEARS.map((y) => aggregate(byKind(kess[y].filter((r) => r.sgg === sg), k), y));
  }
}
for (const sg of SIGUN) {
  const s = stats.sigun[sg];
  s.decline = DECLINE.includes(sg) ? '인구감소지역' : DECLINE_WATCH.includes(sg) ? '인구감소관심지역' : null;
  s.bj = schools.filter((x) => x.sigun === sg && x.bj).length;
  { const w = (fs.existsSync(path.join(ROOT, 'raw/wee.json')) ? rd('raw/wee.json') : []).filter((r) => r.sigun.includes(sg)); if (w.length) s.wee = w.map((r) => r.name); }
  s.closed = closed.filter((c) => c.sigun === sg).length;
  s.closedUnused = closed.filter((c) => c.sigun === sg && c.use === '미활용').length;
  s.closedRecent = closed.filter((c) => c.sigun === sg && c.year >= 2021).length;
}
// 2022년 학교(이후 폐교한 곳 포함)를 읍면동에 배정: 지금 학교와 이어지면 그 위치, 아니면 주소의 읍면동 이름
const s22ByEmd = {}; let s22Lost = 0;
const key2sch = {}; for (const sc of schools) { key2sch[`${sc.kind}|${sc.sigun}|${nm(sc.name)}`] = sc; }
for (const r of kess[2022]) {
  let code = null;
  const cur = key2sch[keyOf(r)] || schools.find((sc) => sc.kind === r.kind && sc.sigun === r.sgg && sc._rows && sc._rows[0] === r);
  if (cur) code = cur.emdCode;
  else { const toks = (r.addr || '').replace(/[().,]/g, ' ').split(/\s+/); const e = (emdBySigun[r.sgg] || []).find((x) => toks.includes(x.emd)); if (e) code = e.code; }
  if (code) s22ByEmd[code] = (s22ByEmd[code] || 0) + (n(r.students) || 0); else s22Lost += n(r.students) || 0;
}
console.log('2022 읍면동 배정 못 한 학생', s22Lost);
// 읍면동: 2026 학교 수·학생 수 + 가장 가까운 중·고교
for (const e of emdList) {
  const in26 = schools.filter((s) => s.emdCode === e.code);
  const near = (kind) => {
    let best = null;
    for (const s of schools) if (s.kind === kind && s.state !== '휴') { const d = dist({ lat: e.cy, lon: e.cx }, s); if (!best || d < best) best = d; }
    return r1(best);
  };
  stats.emd[e.code] = {
    sigun: e.sigun, emd: e.emd, cx: +e.cx.toFixed(5), cy: +e.cy.toFixed(5),
    schools: in26.length, students: in26.reduce((a, s) => a + (s.stu[4] || 0), 0),
    s22: s22ByEmd[e.code] || 0,
    nearE: near('초등학교'), nearM: near('중학교'), nearH: near('고등학교'),
    closed: closed.filter((c) => c.emd === e.emd && c.sigun === e.sigun).length,
  };
}
const KESS_SRC = { name: kess[LAST].some((r) => r.teachers !== null && r.teachers !== undefined)
  ? '한국교육개발원 교육통계서비스(KESS) 학교별 데이터셋 2022~2026(상반기)'
  : '한국교육개발원 교육통계서비스(KESS) 학교별 학과별 학년별 반별 학생수 2022~2026(학교 단위로 합침)' };
const LOC_DATE = (() => { const i = LH.indexOf('데이터기준일자'); const d = i >= 0 && locRows[1] ? locRows[1][i] : ''; return d || '–'; })();
const CLOSED_DATE = (() => { const ds = closedRaw.map((c) => c.CRTR_YMD).filter(Boolean).sort(); return ds.length ? (ds[0] === ds[ds.length - 1] ? ds[0] : `${ds[0]}~${ds[ds.length - 1]}`) : '–'; })();
stats.meta = {
  builtAt: new Date().toISOString(),
  smallLimit: SMALL_LIMIT,
  referenceDate: '2026-04-01',
  sources: [
    { name: KESS_SRC.name, url: 'https://kess.kedi.re.kr/contents/dataset', date: '매년 4월 1일 기준' },
    { name: '한국교육시설안전원 초중등학교위치 표준데이터', url: 'https://www.data.go.kr/data/15159184/fileData.do', date: LOC_DATE },
    { name: '통계청 SGIS 기반 행정동 경계(vuski/admdongkor)', url: 'https://github.com/vuski/admdongkor', date: '2026-07-01' },
    { name: '전국폐교재산기본정보 표준데이터(광주·전남분)', url: 'https://www.data.go.kr/data/15107729/standard.do', date: CLOSED_DATE },
    ...(byeokji.length ? [{ name: '도서·벽지 교육진흥법 시행규칙 별표(교육부령 제374호)', url: 'https://www.law.go.kr/LSW/lsBylInfoP.do?bylSeq=17938657&lsiSeq=282771&efYd=20260301', date: '2026-03-01 시행' }] : []),
    { name: '행정안전부 인구감소지역·인구감소관심지역 지정', url: 'https://www.mois.go.kr/frt/sub/a06/b06/populationDecline/screen.do', date: '2021-10 / 2025-09 기준' },
  ],
};

// 법령 별표에는 있으나 통계상 이미 폐교된 학교
stats.meta.bjClosed = byeokji.filter((b) => !schools.some((x) => bjKey(x.sigun, x.name) === bjKey(b.area.split(' ')[0], BJ_ALIAS[b.school] || b.school))).map((b) => ({ name: b.school, grade: b.category + ' ' + b.grade, area: b.area }));
stats.meta.bjTotal = byeokji.length;
stats.meta.s22Lost = s22Lost;
for (const sc of schools) delete sc._rows;
console.log('옛 기록 이어 붙인 학교', relinked.length, relinked);
fs.writeFileSync(path.join(ROOT, 'docs/data/schools.json'), JSON.stringify(schools));
fs.writeFileSync(path.join(ROOT, 'docs/data/closed.json'), JSON.stringify(closed));
fs.writeFileSync(path.join(ROOT, 'docs/data/stats.json'), JSON.stringify(stats));
console.log('학교', schools.length, '/ 2026 KESS 대상', kess[LAST].filter((r) => r.state !== '폐(원)교').length);
console.log('전남·광주 합계 2026', stats.total.all[4]);
console.log('도서벽지 연결', schools.filter((s) => s.bj).length, '/', byeokji.length, '이미 폐교', stats.meta.bjClosed.map((b) => b.name));
console.log('좌표 방법', schools.filter((s) => s.geo).map((s) => s.name + ':' + s.geo));
