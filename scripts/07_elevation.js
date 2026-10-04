// 학교·읍면동 대표점의 해발 고도(AWS Terrarium 지형 타일 z12, 키 없음)를 schools.json·stats.json에 붙인다
const fs = require('fs'), path = require('path'), https = require('https');
const { PNG } = require(path.join(__dirname, '../tools/node_modules/pngjs'));
const ROOT = path.join(__dirname, '..');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const schools = rd('docs/data/schools.json'), stats = rd('docs/data/stats.json');
const Z = 12, cacheDir = path.join(ROOT, 'work/dem');
fs.mkdirSync(cacheDir, { recursive: true });
const get = (u) => new Promise((ok, no) => https.get(u, (r) => { const b = []; r.on('data', (d) => b.push(d)); r.on('end', () => ok(Buffer.concat(b))); }).on('error', no));
const tiles = {};
async function tile(x, y) {
  const k = `${x}_${y}`; if (tiles[k]) return tiles[k];
  const f = path.join(cacheDir, k + '.png');
  if (!fs.existsSync(f)) fs.writeFileSync(f, await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`));
  return (tiles[k] = PNG.sync.read(fs.readFileSync(f)));
}
async function elev(lon, lat) {
  const n = 2 ** Z, xf = ((lon + 180) / 360) * n, yf = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const x = Math.floor(xf), y = Math.floor(yf), t = await tile(x, y);
  const px = Math.min(255, Math.floor((xf - x) * 256)), py = Math.min(255, Math.floor((yf - y) * 256)), i = (py * 256 + px) * 4;
  return Math.round(t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768);
}
(async () => {
  for (const s of schools) s.alt = s.geo === 'emd' ? null : Math.max(0, await elev(s.lon, s.lat)); // 읍면 대표점 학교는 고도를 알 수 없음
  for (const e of Object.values(stats.emd)) e.alt = Math.max(0, await elev(e.cx, e.cy));
  for (const sg of Object.keys(stats.sigun)) {
    const a = schools.filter((s) => s.sigun === sg && !s.state && s.alt !== null);
    stats.sigun[sg].altMed = a.length ? a.map((s) => s.alt).sort((x, y) => x - y)[a.length >> 1] : null;
    stats.sigun[sg].high = a.filter((s) => s.alt >= 300).length;
  }
  fs.writeFileSync(path.join(ROOT, 'docs/data/schools.json'), JSON.stringify(schools));
  fs.writeFileSync(path.join(ROOT, 'docs/data/stats.json'), JSON.stringify(stats));
  const top = [...schools].sort((a, b) => b.alt - a.alt).slice(0, 8).map((s) => `${s.sigun} ${s.name} ${s.alt}m ${s.stu[4]}명`);
  const hi = schools.filter((s) => s.alt !== null && s.alt >= 300);
  console.log('타일', Object.keys(tiles).length, '해발 300m 이상', hi.length, '학생 중앙값', hi.map((s) => s.stu[4]).sort((a, b) => a - b)[hi.length >> 1], '| 전체 중앙값', schools.map((s) => s.stu[4]).sort((a, b) => a - b)[schools.length >> 1]);
  console.log(top.join('\n'));
})();
