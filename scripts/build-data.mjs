// Génère data/chasses.json à partir du service officiel SPW/DNF
// (territoires de chasse anonymisés + table des dates de chasse déclarées).
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://geoservices.wallonie.be/arcgis/rest/services/FAUNE_FLORE/CHASSE_TERRIT_ANONYM/MapServer';
const JOURS = Number(process.env.JOURS ?? 21);
const LOT = 100; // territoires par requête de géométrie

const isoBruxelles = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(d);
const plusJours = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function requete(couche, params) {
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(`${BASE}/${couche}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      if (j.exceededTransferLimit || j.properties?.exceededTransferLimit) throw new Error('réponse tronquée par le serveur');
      return j;
    } catch (e) {
      if (essai >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * essai));
    }
  }
}

const MODES = { Battue: 'B', Affut: 'A', Autre: 'X' };

const debut = isoBruxelles(new Date());
const fin = plusJours(debut, JOURS);

// 1. Dates de chasse, jour par jour (reste sous la limite de 2000 enregistrements).
const parTerritoire = new Map();
let extraction = 0;
for (let jour = debut; jour < fin; jour = plusJours(jour, 1)) {
  const j = await requete(1, {
    where: `DATE_CHASSE >= DATE '${jour}' AND DATE_CHASSE < DATE '${plusJours(jour, 1)}'`,
    outFields: 'KEYG,DATE_CHASSE,MODE_CHASSE_TXT,FERMETURE,DATE_EXTRACT',
    f: 'json',
  });
  for (const { attributes: a } of j.features) {
    const mode = MODES[a.MODE_CHASSE_TXT.split('/')[0].trim()];
    if (!mode) throw new Error(`mode de chasse inconnu : ${a.MODE_CHASSE_TXT}`);
    const date = new Date(a.DATE_CHASSE).toISOString().slice(0, 10);
    if (!parTerritoire.has(a.KEYG)) parTerritoire.set(a.KEYG, []);
    parTerritoire.get(a.KEYG).push([date, mode, a.FERMETURE === 'Oui' ? 1 : 0]);
    extraction = Math.max(extraction, a.DATE_EXTRACT ?? 0);
  }
}

// 2. Géométries des territoires concernés.
const cles = [...parTerritoire.keys()];
const features = [];
for (let i = 0; i < cles.length; i += LOT) {
  const j = await requete(0, {
    where: `KEYG IN (${cles.slice(i, i + LOT).map((k) => `'${k.replace(/'/g, "''")}'`).join(',')})`,
    outFields: 'KEYG,N_LOT,UGC_NOM,SERVICE',
    outSR: '4326',
    geometryPrecision: '5', // ~1 m
    maxAllowableOffset: '0.00001', // ~1 m : retire seulement les points redondants
    f: 'geojson',
  });
  for (const f of j.features) {
    if (!f.geometry) continue;
    const p = f.properties;
    features.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        lot: p.N_LOT,
        ugc: p.UGC_NOM,
        cant: p.SERVICE,
        d: parTerritoire.get(p.KEYG).sort((a, b) => a[0].localeCompare(b[0])),
      },
    });
  }
}

// 3. Territoires déclarés mais absents de la couche publique : listés en texte.
// Le cantonnement est déduit du préfixe du numéro de lot (indicatif : la règle
// souffre de rares exceptions dans la couche officielle).
const trouves = new Set(features.map((f) => f.properties.lot));
const cantons = new Map(
  (await requete(0, { where: '1=1', outFields: 'CAN,SERVICE', returnDistinctValues: 'true', returnGeometry: 'false', f: 'json' }))
    .features.map(({ attributes: a }) => [a.CAN, a.SERVICE])
);
const sansTrace = cles
  .map((k) => ({ lot: k.split('/')[1], d: parTerritoire.get(k).sort((a, b) => a[0].localeCompare(b[0])) }))
  .filter((t) => !trouves.has(t.lot))
  .map((t) => ({ ...t, cant: cantons.get(t.lot.slice(0, 3)) ?? null }))
  .sort((a, b) => a.lot.localeCompare(b.lot));
const sortie = {
  type: 'FeatureCollection',
  meta: {
    genere: new Date().toISOString(),
    extractionDNF: extraction ? new Date(extraction).toISOString() : null,
    debut,
    fin: plusJours(fin, -1),
    chasses: [...parTerritoire.values()].reduce((n, d) => n + d.length, 0),
    territoiresDeclares: cles.length,
    territoiresSansGeometrie: sansTrace.length,
  },
  sansTrace,
  features,
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/chasses.json', import.meta.url), JSON.stringify(sortie));
console.log(sortie.meta);
