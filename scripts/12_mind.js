// 마음건강 집계: docs/data/disc/{id}.json (학교알리미 수집분) → docs/data/mind.json
//  학교별  s[id] = [전문상담교사 수, Wee클래스(1/0/-1), 교내 상담전문가 상담 실시(1/0/-1)]   (-1 = 자료 없음)
//  지역별  sigun[시군], emd[읍면동코드] = { 학교급: {a:항목22 자료 학교 수, t:전문상담교사 배치 학교 수, b:항목61 자료 학교 수, w:Wee클래스 설치 학교 수, i:교내 상담전문가 실시 학교 수} , all: 같은 구조(특수 포함 전체) }
// 사용: node scripts/12_mind.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const schools = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/schools.json'), 'utf8'));
const DIR = path.join(ROOT, 'docs/data/disc');
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return String(v ?? '').trim() !== '' && isFinite(n) ? n : null; };
function kv(j, it) { const m = {}; if (!j[it]) return m; for (const t of j[it].tables) for (const r of t.rows) if (r.length >= 2 && !(r[0] in m)) m[r[0]] = r[r.length - 1]; return m; }
const yn = (v) => (v === 'Y' ? 1 : v === 'N' ? 0 : -1);
const out = { s: {}, sigun: {}, emd: {}, meta: { schools: 0, withData: 0 } };
const blank = () => ({ a: 0, t: 0, b: 0, w: 0, i: 0 });
function add(box, kind, r) {
  for (const k of [kind, 'all']) {
    const o = (box[k] ||= blank());
    if (r[0] !== null) { o.a++; if (r[0] > 0) o.t++; }
    if (r[1] >= 0) { o.b++; if (r[1] === 1) o.w++; }
    if (r[2] >= 0 && r[1] >= 0 && r[2] === 1) o.i++;
  }
}
for (const s of schools) {
  out.meta.schools++;
  const f = path.join(DIR, s.id + '.json'); if (!fs.existsSync(f)) continue;
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
  const t22 = kv(j, '22'), t61 = kv(j, '61');
  const tcr = j['22'] ? num(t22['전문상담교사(계)']) : null;
  const wee = yn(t61['교내 WEE클래스 설치여부(2025년 이후 적용)']);
  const inn = yn(t61['상담실적(내부상담전문가실시여부)']);
  if (tcr === null && wee < 0) continue;
  out.meta.withData++;
  const r = [tcr, wee, inn];
  out.s[s.id] = [tcr === null ? -1 : tcr, wee, inn];
  add((out.sigun[s.sigun] ||= {}), s.kind, r);
  if (s.emdCode) add((out.emd[s.emdCode] ||= {}), s.kind, r);
}
fs.writeFileSync(path.join(ROOT, 'docs/data/mind.json'), JSON.stringify(out));
console.log(`학교 ${out.meta.schools}곳 중 자료 있는 ${out.meta.withData}곳 → docs/data/mind.json`);
for (const [k, v] of Object.entries(out.sigun)) { const a = v.all; console.log(`${k}: 전문상담교사 ${a.t}/${a.a}, Wee클래스 ${a.w}/${a.b}`); }
