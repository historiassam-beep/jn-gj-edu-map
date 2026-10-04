// 위치 표준데이터에 없는 학교(특수학교·이름 바뀐 학교)의 좌표를 키 없이 채운다
// 순서: ① 옛 이름으로 위치 자료 찾기 ② OpenStreetMap 이름 검색(같은 시군 안일 때만) ③ 주소의 읍면동 대표점
// 출력: work/geo_fallback.json  { "시군|학교명": {lat, lon, how} }
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = path.join(__dirname, '..');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// 이름이 바뀐 학교: 새 이름 → 위치 자료에 남은 옛 이름
// 이름이 바뀐 학교의 옛 이름 대응표. 02_build.js가 위치를 못 찾은 학교(work/unmatched.json)를 보고
// 전남·광주 학교에 맞게 채우세요. (원작의 경북 항목은 제거함)
const ALIAS = {
};

const emd = rd('work/gb_emd_full.geojson').features.map((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let ax = 0, ay = 0, aa = 0;
  for (const p of polys) { const r = p[0]; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const c = r[j][0] * r[i][1] - r[i][0] * r[j][1]; aa += c; ax += (r[j][0] + r[i][0]) * c; ay += (r[j][1] + r[i][1]) * c; } }
  return { ...f.properties, polys, cx: ax / (3 * aa), cy: ay / (3 * aa) };
});
const inRing = (x, y, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const findEmd = (x, y) => emd.find((e) => e.polys.some((p) => inRing(x, y, p[0])));

const csv = fs.readFileSync(path.join(ROOT, 'raw/schloc.csv'), 'utf8').replace(/^﻿/, '').split('\n').map((l) => l.split(','));
const H = csv[0];
const loc = csv.slice(1).filter((r) => /광주|전라남|전남/.test(r[H.indexOf('시도교육청명')]));

const get = (url) => new Promise((ok, no) => https.get(url, { headers: { 'User-Agent': 'jngj-edu-map/0.1 (derived from gb-edu-map; school statistics map for teachers)' } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { no(e); } }); }).on('error', no));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const out = fs.existsSync(path.join(ROOT, 'work/geo_fallback.json')) ? rd('work/geo_fallback.json') : {};
  for (const u of rd('work/unmatched.json')) {
    const key = `${u.sgg}|${u.name}`;
    if (out[key]) continue;
    // ① 옛 이름
    const old = ALIAS[u.name];
    const l = old && loc.find((r) => r[H.indexOf('학교명')] === old && r.join(',').includes(u.sgg.replace(/^광주 /, '')));
    if (l) { out[key] = { lat: +l[H.indexOf('위도')], lon: +l[H.indexOf('경도')], how: 'alias:' + old }; console.log('옛 이름', u.name); continue; }
    // ①-2 같은 도로명주소(같은 학교급)
    const road = (u.addr || '').match(/^(?:광주광역시|전라남도|전남광주통합특별시)\s+\S+\s+(?:\S+[읍면]\s+)?\S+(?:로|길)\s*[\d-]+/);
    const byAddr = road && loc.find((r) => r[H.indexOf('학교급구분')] === u.kind && r[H.indexOf('소재지도로명주소')].replace(/\s+/g, '').startsWith(road[0].replace(/\s+/g, '')));
    if (byAddr) { out[key] = { lat: +byAddr[H.indexOf('위도')], lon: +byAddr[H.indexOf('경도')], how: 'addr:' + byAddr[H.indexOf('학교명')] }; console.log('같은 주소', u.name, '←', byAddr[H.indexOf('학교명')]); continue; }
    // ② OSM
    let hit = null;
    for (const q of [u.name, `${u.name.replace(/^(전남|전라남도|광주|광주광역시)/, '')} ${u.sgg.replace(/^광주 /, '')}`]) {
      let res = []; try { res = await get(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=kr&limit=5&viewbox=125.0,35.6,127.95,33.9&bounded=1&q=${encodeURIComponent(q)}`); } catch (e) { if (!globalThis.osmWarned) { console.warn('OSM 접속 실패 — 건너뜀'); globalThis.osmWarned = true; } break; }
      await wait(1100);
      hit = res.find((r) => { const e = findEmd(+r.lon, +r.lat); return e && e.sigun === u.sgg; });
      if (hit) break;
    }
    if (hit) { out[key] = { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5), how: 'osm' }; console.log('OSM', u.name); continue; }
    // ③ 주소 읍면동
    const toks = (u.addr || '').replace(/[().,]/g, ' ').split(/\s+/).filter((w) => /[읍면동]$/.test(w));
    const mine = emd.filter((x) => x.sigun === u.sgg);
    const e = mine.find((x) => toks.includes(x.emd)) || mine.find((x) => toks.some((w) => /동$/.test(w) && x.emd.replace(/\d+동$/, '동') === w)); // 주월동 → 주월1동
    if (e) { out[key] = { lat: +e.cy.toFixed(5), lon: +e.cx.toFixed(5), how: 'emd', emd: e.emd }; console.log('읍면 대표점', u.name, e.emd); continue; }
    // ④ 법정동 → 행정동: 같은 법정동 지번주소를 가진 다른 학교 좌표가 들어가는 행정동
    const legal = toks.filter((w) => /동$/.test(w));
    const sgPlain = u.sgg.replace(/^광주 /, '');
    const votes = {};
    for (const r of loc) {
      const j = r[H.indexOf('소재지지번주소')] || '';
      if (!j.includes(sgPlain) || !legal.some((w) => j.split(/\s+/).includes(w))) continue;
      const ee = findEmd(+r[H.indexOf('경도')], +r[H.indexOf('위도')]);
      if (ee && ee.sigun === u.sgg) votes[ee.emd] = (votes[ee.emd] || 0) + 1;
    }
    // 같은 법정동에 다른 학교가 없어 직접 확인한 대응(덕흥동은 유촌동과 함께 유덕동, 달동=달리도는 목포 서쪽 섬들과 함께 유달동)
    const LEGAL = { '광주 서구|덕흥동': '유덕동', '목포시|달동': '유달동' };
    for (const w of legal) if (LEGAL[`${u.sgg}|${w}`]) votes[LEGAL[`${u.sgg}|${w}`]] = 99;
    const best = Object.entries(votes).sort((x, y) => y[1] - x[1])[0];
    const e2 = best && mine.find((x) => x.emd === best[0]);
    if (e2) { out[key] = { lat: +e2.cy.toFixed(5), lon: +e2.cx.toFixed(5), how: 'emd', emd: e2.emd }; console.log('읍면 대표점(법정동)', u.name, legal.join('/'), '→', e2.emd, JSON.stringify(votes)); continue; }
    console.log('실패', u.name, u.addr);
  }
  fs.writeFileSync(path.join(ROOT, 'work/geo_fallback.json'), JSON.stringify(out, null, 1));
})();
