// 학교알리미 OpenAPI(내 인증키)로 공시 항목을 받아 docs/data/disc/{학교id}.json 으로 저장한다.
// 사용(Windows PowerShell):  $env:SCHOOLINFO_KEY="내키"; node scripts/11_disclosure_api.js test
//        (macOS/Linux):      SCHOOLINFO_KEY=내키 node scripts/11_disclosure_api.js test
//   test   : 광주 동구 초등학교 기본정보 1건만 받아 키·주소가 맞는지 확인
//   (인자 없음): 광주·전남 전체(시군구 × 학교급 × 항목). 받은 응답은 work/api/ 에 저장해 두어, 끊겨도 다시 실행하면 이어서 한다.
//   ITEMS=22,61 node ...  : 일부 항목만
// 인증키는 파일에 적지 말고 환경변수로만 넣을 것(깃허브에 올라가지 않게).
const fs = require('fs'), path = require('path'), https = require('https');
const ROOT = path.join(__dirname, '..');
const KEY = process.env.SCHOOLINFO_KEY;
if (!KEY) { console.error('환경변수 SCHOOLINFO_KEY 에 학교알리미 인증키를 넣고 다시 실행하세요.'); process.exit(1); }
const RAW = path.join(ROOT, 'work/api'), OUT = path.join(ROOT, 'docs/data/disc');
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'raw/openapi_spec.json'), 'utf8'));
const schools = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/schools.json'), 'utf8'));
// 표준 행정구역 코드(시도 2자리, 시군구 5자리). 학교알리미 「시도시군구코드.xlsx」와 다르면 이 표를 고치세요.
const SGG = [
  ['29', '29110', '광주 동구'], ['29', '29140', '광주 서구'], ['29', '29155', '광주 남구'], ['29', '29170', '광주 북구'], ['29', '29200', '광주 광산구'],
  ['46', '46110', '목포시'], ['46', '46130', '여수시'], ['46', '46150', '순천시'], ['46', '46170', '나주시'], ['46', '46230', '광양시'],
  ['46', '46710', '담양군'], ['46', '46720', '곡성군'], ['46', '46730', '구례군'], ['46', '46770', '고흥군'], ['46', '46780', '보성군'],
  ['46', '46790', '화순군'], ['46', '46800', '장흥군'], ['46', '46810', '강진군'], ['46', '46820', '해남군'], ['46', '46830', '영암군'],
  ['46', '46840', '무안군'], ['46', '46860', '함평군'], ['46', '46870', '영광군'], ['46', '46880', '장성군'], ['46', '46890', '완도군'],
  ['46', '46900', '진도군'], ['46', '46910', '신안군'],
];
const KINDS = [['02', '초등학교'], ['03', '중학교'], ['04', '고등학교'], ['05', '특수학교']];
const ITEMS = (process.env.ITEMS || '08,10,16,17,18,21,22,34,35,38,51,56,58,59,61,64,68,73,90,94,43').split(',');
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const nm = (s) => String(s || '').replace(/[\s·ㆍ.\-()]/g, '');
function get(url) {
  return new Promise((ok, no) => https.get(url, { timeout: 60000 }, (r) => {
    let b = ''; r.setEncoding('utf8'); r.on('data', (d) => (b += d));
    r.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { no(new Error('응답을 읽지 못함: ' + b.slice(0, 150))); } });
  }).on('error', no).on('timeout', function () { this.destroy(new Error('시간 초과')); }));
}
async function api1(type, sido, sgg, kind, yr, dep) {
  const f = path.join(RAW, `${type}_${sgg}_${kind}${yr ? '_' + yr : ''}${dep ? '_d' + dep : ''}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const url = `https://www.schoolinfo.go.kr/openApi.do?apiKey=${encodeURIComponent(KEY)}&apiType=${type}&sidoCode=${sido}&sggCode=${sgg}&schulKndCode=${kind}${yr ? '&pbanYr=' + yr : ''}${dep ? '&depthNo=' + dep : ''}`;
  let j, err;
  for (let t = 1; t <= 3; t++) { try { j = await get(url); break; } catch (e) { err = e; await sleep(1500 * t); } }
  if (!j) throw err;
  if (j.resultCode !== 'success') return { list: [], msg: j.resultMsg };
  fs.writeFileSync(f, JSON.stringify(j));
  return j;
}
// 기본정보(0)를 뺀 항목은 공시연도(pbanYr)가 필수. 최신 연도부터 시도하고 비어 있으면 이전 연도로.
const YEARS = (process.env.PBAN || '2026,2025').split(',');
async function api(type, sido, sgg, kind, dep) {
  if (type === '0') return api1(type, sido, sgg, kind, '');
  let last;
  for (const y of YEARS) { last = await api1(type, sido, sgg, kind, y, dep); if ((last.list || []).length) return last; }
  if (last && last.msg && !/존재하지 않/.test(last.msg)) console.log(`  ! ${type} ${sgg} ${kind}: ${last.msg}`);
  return last || { list: [] };
}
if (process.argv[2] === 'test') {
  (async () => {
    const j = await api('0', '29', '29110', '02');
    console.log('결과', j.resultCode, j.resultMsg, '학교 수', (j.list || []).length);
    const r = (j.list || [])[0]; if (r) console.log('첫 학교:', r.SCHUL_NM, r.SCHUL_RDNMA, r.ADRCD_NM, 'SCHUL_CODE', r.SCHUL_CODE);
    else console.log('학교가 0곳입니다. 시도·시군구 코드나 인증키를 확인하세요.');
    try { fs.unlinkSync(path.join(RAW, '0_29110_02.json')); } catch (e) {} // 시험 호출 결과는 지움
  })().catch((e) => console.error('실패:', e.message));
  return;
}
// 학교 찾기: (시군구, 이름) → 학교
const ALIAS = { 광주자동화설비공업고등학교: '광주자동화설비마이스터고등학교' }; // 학교 이름이 바뀐 경우
const byKey = {}; for (const s of schools) (byKey[nm(s.name)] ||= []).push(s);
function match(rec, sgName) {
  const c = byKey[nm(ALIAS[rec.SCHUL_NM] || rec.SCHUL_NM)] || [];
  const near = c.filter((s) => s.sigun === sgName);
  return near[0] || (c.length === 1 ? c[0] : null);
}
const bySchool = {}; // 학교id → { item → {title, tables} }
let unmatched = new Set();
(async () => {
  let n = 0; const tot = SGG.length * KINDS.length * ITEMS.length;
  const DEPTH = { 35: [1, 2], 58: [1, 2] }; // depthNo가 필수인 항목
  const JOBS = []; for (const it of ITEMS) for (const d of (DEPTH[it] || [0])) JOBS.push([it, d]);
  for (const [sido, sgg, sgName] of SGG) for (const [kc] of KINDS) for (const [it0, dep] of JOBS) {
    const it = dep ? `${it0}_${dep}` : it0;
    n++; if (n % 50 === 0) console.log(`${n} / ${tot}`);
    let j; try { j = await api(it0, sido, sgg, kc, dep); } catch (e) { console.log('  ! 실패', it, sgg, kc, e.message); continue; }
    await sleep(120);
    const sp = spec[it0]; if (!sp) continue;
    const recs = j.list || [];
    const groups = {}; for (const r of recs) (groups[r.SCHUL_CODE || r.SCHUL_NM] ||= []).push(r);
    for (const rows of Object.values(groups)) {
      const s = match(rows[0], sgName); if (!s) { unmatched.add(`${sgName} ${rows[0].SCHUL_NM}`); continue; }
      const fields = sp.fields.filter((f) => rows.some((r) => r[f.id] !== undefined));
      const val = (r, f) => (r[f.id] === null || r[f.id] === undefined ? '' : String(r[f.id]));
      let table;
      if (rows.length === 1) table = { sub: '', head: ['항목', '값'], rows: fields.map((f) => [f.name, val(rows[0], f)]) };
      else table = { sub: '', head: fields.map((f) => f.name), rows: rows.map((r) => fields.map((f) => val(r, f))) };
      (bySchool[s.id] ||= {})[it] = { title: sp.title, tables: [table] };
    }
  }
  for (const [id, v] of Object.entries(bySchool)) fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(v));
  console.log('저장한 학교', Object.keys(bySchool).length, '/', schools.length, ' 이름을 못 맞춘 학교', unmatched.size);
  if (unmatched.size) fs.writeFileSync(path.join(ROOT, 'work/api_unmatched.txt'), [...unmatched].join('\n'));
})();
