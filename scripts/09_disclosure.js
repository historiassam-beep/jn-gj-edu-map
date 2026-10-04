// 학교알리미 공시 비교표(unified-school-mcp get_school_report로 받은 raw/disclosure.json)를 학교 자료에 붙인다
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const schools = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/schools.json'), 'utf8'));
const disc = JSON.parse(fs.readFileSync(path.join(ROOT, 'raw/disclosure.json'), 'utf8'));
const nm = (s) => (s || '').replace(/\s+/g, '');
const idx = new Map(disc.map((d) => [`${d.sigun}|${d.kind}|${nm(d.name)}`, d]));
let hit = 0;
for (const s of schools) {
  const d = idx.get(`${s.sigun}|${s.kind}|${nm(s.name)}`);
  if (!d) continue;
  hit++;
  s.disc = { meal: d['급식'] || null, temp: d['기간제비율'] ?? null, club: d['동아리'] ?? null, perClass: d['학급당'] ?? null };
}
fs.writeFileSync(path.join(ROOT, 'docs/data/schools.json'), JSON.stringify(schools));
console.log('공시 연결', hit, '/', schools.length);
console.log('못 붙은 학교', schools.filter((s) => !s.disc).slice(0, 15).map((s) => s.sigun + ' ' + s.name).join(', '));
