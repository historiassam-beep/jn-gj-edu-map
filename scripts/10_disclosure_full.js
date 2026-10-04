// 학교알리미 공시 21개 항목을 학교마다 받아 docs/data/disc/{학교id}.json 으로 저장
// 형님 unified-school-mcp 서버(get_disclosure)를 부른다. 서버가 (항목·시군·학교급) 단위로 원서버 응답을 캐시하므로
// 학교알리미 원서버에는 시군×학교급×항목 한 번씩만 간다.
// 다시 돌리면 이미 받은 학교는 건너뛴다(중간에 끊겨도 이어서).
const fs = require('fs'), path = require('path'), https = require('https');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs/data/disc');
fs.mkdirSync(OUT, { recursive: true });
const schools = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/schools.json'), 'utf8'));
const ITEMS = ['08', '10', '16', '17', '18', '21', '22', '34', '35', '38', '51', '56', '58', '59', '61', '64', '68', '73', '90', '94', '43'];
const URL_ = new URL('https://unified-school-mcp.onrender.com/mcp');
let rpc = 0;
function call(args) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name: 'get_disclosure', arguments: args } });
  return new Promise((ok, no) => {
    const r = https.request(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(body) }, timeout: 60000 }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (d) => (b += d));
      res.on('end', () => { const m = b.match(/data: (.*)/); try { const j = JSON.parse(m ? m[1] : b); ok(j.result); } catch (e) { no(new Error('응답 해석 실패 ' + b.slice(0, 120))); } });
    });
    r.on('timeout', () => r.destroy(new Error('시간 초과'))); r.on('error', no); r.write(body); r.end();
  });
}
// "# 제목\n### 소제목\n| 항목 | 값 |\n|..|..|\n| k | v |" → { title, tables:[{sub, rows:[[k,v]]}] }
function parse(text) {
  const out = { title: '', tables: [] }; let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('# ')) out.title = line.slice(2).replace(/^.*? — /, '').trim();
    else if (line.startsWith('### ')) { cur = { sub: line.slice(4).trim(), head: null, rows: [] }; out.tables.push(cur); }
    else if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      if (!cur) { cur = { sub: '', head: null, rows: [] }; out.tables.push(cur); }
      if (!cur.head) cur.head = cells; else cur.rows.push(cells);
    }
  }
  return out;
}
const KIND = { 초등학교: '초등학교', 중학교: '중학교', 고등학교: '고등학교', 특수학교: '특수학교' };
async function one(s) {
  const f = path.join(OUT, `${s.id}.json`);
  if (fs.existsSync(f)) return 'skip';
  const res = {};
  for (const item of ITEMS) {
    let r, tries = 0;
    while (tries++ < 3) { try { r = await call({ sido: /^광주 /.test(s.sigun) ? '광주광역시' : '전라남도', sgg: s.sigun.replace(/^광주 /, ''), kind: KIND[s.kind], name: s.name, item }); break; } catch (e) { await new Promise((z) => setTimeout(z, 1500 * tries)); } }
    const t = r && r.content && r.content[0] && r.content[0].text;
    if (!t || r.isError || !/\|/.test(t)) continue;
    res[item] = parse(t);
  }
  fs.writeFileSync(f, JSON.stringify(res));
  return Object.keys(res).length;
}
(async () => {
  if (process.argv[2]) { // 한 학교만 시험: node 10_disclosure_full.js 석포초등학교
    const s = schools.find((x) => x.name === process.argv[2]); const f = path.join(OUT, `${s.id}.json`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    const t = Date.now(); console.log('항목', await one(s), Date.now() - t, 'ms', fs.statSync(f).size, 'B');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [k, v] of Object.entries(j)) console.log(k, v.title, v.tables.map((x) => x.head.join('/') + ' ' + x.rows.length + '줄').join(' | '));
    return;
  }
  const list = schools.filter((s) => s.id);
  let i = 0, done = 0, empty = 0; const t0 = Date.now();
  const worker = async () => { while (i < list.length) { const s = list[i++]; const n = await one(s); done++; if (n === 0) empty++; if (done % 25 === 0) console.log(done, '/', list.length, Math.round((Date.now() - t0) / 1000) + '초', '빈 학교', empty); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log('끝', done, '빈 학교', empty);
})();
