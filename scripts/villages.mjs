// Contours approchés des villages wallons, à partir des points d'adresses ICAR du SPW (champ ZONE_ADRES).
// Chaque village = enveloppe convexe de ses adresses (ou son rectangle englobant s'il en compte beaucoup).
// Usage : node scripts/villages.mjs   → écrit data/villages.json (à refaire rarement : les adresses bougent peu).
import { writeFile } from 'node:fs/promises';

const URL_ADR = 'https://geoservices.wallonie.be/arcgis/rest/services/DONNEES_BASE/ICAR_ADR_PT/MapServer/1/query';
const PAGE = 2000;
const PAGES_MAX = 3; // au-delà : rectangle englobant (requête d'emprise) au lieu de l'enveloppe
const PARALLELE = 6;

const dort = (ms) => new Promise((r) => setTimeout(r, ms));
const guil = (s) => s.replaceAll("'", "''");

async function requete(params) {
  const qs = new URLSearchParams({ f: 'json', ...params });
  for (let essai = 1; essai <= 5; essai++) {
    try {
      const r = await fetch(`${URL_ADR}?${qs}`);
      const j = await r.json();
      if (!j.error) return j;
    } catch {}
    await dort(500 * essai);
  }
  throw new Error(`Échec de la requête ${params.where}`);
}

const distinct = async (champs, where) =>
  (await requete({ where, outFields: champs, returnDistinctValues: 'true', returnGeometry: 'false' })).features.map((f) => f.attributes);

function enveloppe(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const croix = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas = [];
  for (const q of p) {
    while (bas.length >= 2 && croix(bas.at(-2), bas.at(-1), q) <= 0) bas.pop();
    bas.push(q);
  }
  const haut = [];
  for (const q of p.reverse()) {
    while (haut.length >= 2 && croix(haut.at(-2), haut.at(-1), q) <= 0) haut.pop();
    haut.push(q);
  }
  return bas.slice(0, -1).concat(haut.slice(0, -1));
}

const arrondi = (n) => Math.round(n * 1e4) / 1e4;

// Quelques adresses sont mal classées (parfois à des dizaines de km) : on écarte celles qui sont
// bien plus loin du centre que la plupart des autres, sans toucher aux villages en plusieurs hameaux.
function sansAberrants(pts) {
  if (pts.length < 6) return pts;
  const mediane = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const mx = mediane(pts.map((p) => p[0]));
  const my = mediane(pts.map((p) => p[1]));
  const dist = pts.map((p) => Math.hypot((p[0] - mx) * 71, (p[1] - my) * 111)); // km, vers 50° N
  const limite = Math.max(2, 4 * mediane(dist));
  return pts.filter((_, i) => dist[i] <= limite);
}

async function village(commune, nom) {
  const where = `COM_NM='${guil(commune)}' AND ZONE_ADRES='${guil(nom)}'`;
  const pts = [];
  let trop = false;
  for (let page = 0; ; page++) {
    const j = await requete({ where, outFields: 'OBJECTID', returnGeometry: 'true', outSR: '4326', geometryPrecision: '5', resultOffset: String(page * PAGE), resultRecordCount: String(PAGE) });
    for (const f of j.features) if (f.geometry) pts.push([f.geometry.x, f.geometry.y]);
    if (!j.exceededTransferLimit) break;
    if (page + 1 >= PAGES_MAX) { trop = true; break; }
  }
  if (trop) {
    const { extent: e } = await requete({ where, returnExtentOnly: 'true', outSR: '4326' });
    return { n: nom, c: commune, h: [[e.xmin, e.ymin], [e.xmax, e.ymin], [e.xmax, e.ymax], [e.xmin, e.ymax]].map((q) => q.map(arrondi)), r: 1 };
  }
  if (!pts.length) return null;
  const h = enveloppe(sansAberrants(pts)).map((q) => q.map(arrondi));
  return { n: nom, c: commune, h };
}

const communes = (await distinct('COM_NM', '1=1')).map((a) => a.COM_NM).filter(Boolean).sort();
console.error(`${communes.length} communes`);

const paires = [];
for (let i = 0; i < communes.length; i += PARALLELE) {
  const lot = await Promise.all(
    communes.slice(i, i + PARALLELE).map(async (c) => (await distinct('ZONE_ADRES', `COM_NM='${guil(c)}'`)).map((a) => [c, a.ZONE_ADRES]).filter(([, z]) => z && !z.includes('_')))
  );
  paires.push(...lot.flat());
}
console.error(`${paires.length} villages à tracer`);

const villages = [];
let fait = 0;
const file = [...paires];
await Promise.all(
  Array.from({ length: PARALLELE }, async () => {
    while (file.length) {
      const [c, z] = file.shift();
      const v = await village(c, z);
      if (v) villages.push(v);
      if (++fait % 100 === 0) console.error(`${fait}/${paires.length}`);
    }
  })
);

villages.sort((a, b) => a.n.localeCompare(b.n, 'fr') || a.c.localeCompare(b.c, 'fr'));
const sortie = { genere: new Date().toISOString(), source: "SPW – ICAR, points d'adresses (ZONE_ADRES)", villages };
await writeFile(new URL('../data/villages.json', import.meta.url), JSON.stringify(sortie));
console.error(`écrit : ${villages.length} villages`);
