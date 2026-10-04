// 학구도안내시스템(schoolgis.emac.kr, 키 없음)에서 광주·전남 초·중 학구 경계를 받아 raw/zones_{e,m}.geojson 으로 저장
const fs = require('fs'), path = require('path'), https = require('https');
const ROOT = path.join(__dirname, '..');
const B = 'https://schoolgis.emac.kr/arcgis/rest/services/SCHZONE/EDU_LAYER_SCHOOLZONE_QUERY/MapServer';
const get = (u) => new Promise((ok, no) => https.get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { no(new Error(b.slice(0, 200))); } }); }).on('error', no));
(async () => {
  for (const [lv, id] of [['e', 0], ['m', 1]]) {
    const feats = [];
    for (let off = 0; ; off += 100) {
      const q = `${B}/${id}/query?where=${encodeURIComponent("(EDU_NM like '%광주%' OR EDU_NM like '%전라남도%' OR EDU_NM like '%전남%')")}&outFields=HAKGUDO_NAME,EDU_NM,HAKGUDO_ID&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0005&resultOffset=${off}&resultRecordCount=100&f=json`;
      const j = await get(q);
      for (const f of j.features || []) feats.push({ type: 'Feature', properties: { name: f.attributes.HAKGUDO_NAME, office: f.attributes.EDU_NM, id: f.attributes.HAKGUDO_ID }, geometry: { type: 'Polygon', coordinates: f.geometry.rings } });
      if (!j.features || j.features.length < 100) break;
    }
    fs.writeFileSync(path.join(ROOT, `raw/zones_${lv}.geojson`), JSON.stringify({ type: 'FeatureCollection', features: feats }));
    console.log(lv, feats.length);
  }
})();
