// Génère data/chasses.json à partir du service officiel SPW/DNF
// (territoires de chasse anonymisés + table des dates de chasse déclarées).
import { writeFile, mkdir, rm } from 'node:fs/promises';
import '../ics.js'; // définit globalThis.ICS
import { chassesONF } from './onf.mjs';

const BASE = 'https://geoservices.wallonie.be/arcgis/rest/services/FAUNE_FLORE/CHASSE_TERRIT_ANONYM/MapServer';
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
// Jusqu'à la fin de la saison de chasse (30 juin).
const fin = `${Number(debut.slice(0, 4)) + (debut.slice(5) >= '07-01' ? 1 : 0)}-07-01`;

// Garde-fou : une table vide signale une panne ou une bascule côté SPW. On échoue pour
// conserver la dernière version publiée plutôt que d'afficher une carte faussement vide.
const { count } = await requete(1, { where: '1=1', returnCountOnly: 'true', f: 'json' });
if (!count) throw new Error('table des dates de chasse vide côté SPW');

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
    outFields: 'KEYG,N_LOT,UGC_NOM,SERVICE,CAN',
    outSR: '4326',
    geometryPrecision: '5', // ~1 m
    maxAllowableOffset: '0.00001', // ~1 m : retire seulement les points redondants
    f: 'geojson',
  });
  for (const f of j.features) {
    if (!f.geometry) continue;
    const p = f.properties;
    // Centre de l'emprise : sert de repère (GEO) aux événements de calendrier.
    let [o, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    (function parcourt(c) {
      if (typeof c[0] !== 'number') return c.forEach(parcourt);
      o = Math.min(o, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
    })(f.geometry.coordinates);
    features.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        lot: p.N_LOT,
        ugc: p.UGC_NOM,
        cant: p.SERVICE,
        can: p.CAN,
        c: [+((s + n) / 2).toFixed(5), +((o + e) / 2).toFixed(5)],
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
  .map((t) => ({ ...t, can: cantons.has(t.lot.slice(0, 3)) ? t.lot.slice(0, 3) : null, cant: cantons.get(t.lot.slice(0, 3)) ?? null }))
  .sort((a, b) => a.lot.localeCompare(b.lot));
// 4. Période déclarée par saison et par mode (première et dernière date, chasses passées comprises).
const jourUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const periodes = (
  await requete(1, {
    where: '1=1',
    groupByFieldsForStatistics: 'SAISON,SAISON_TXT,MODE_CHASSE_TXT',
    outStatistics: JSON.stringify([
      { statisticType: 'min', onStatisticField: 'DATE_CHASSE', outStatisticFieldName: 'DEBUT' },
      { statisticType: 'max', onStatisticField: 'DATE_CHASSE', outStatisticFieldName: 'FIN' },
      { statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'N' },
    ]),
    f: 'json',
  })
).features
  .map(({ attributes: a }) => ({
    saison: a.SAISON,
    libelle: a.SAISON_TXT,
    mode: MODES[a.MODE_CHASSE_TXT.split('/')[0].trim()],
    debut: jourUTC(a.DEBUT),
    fin: jourUTC(a.FIN),
    n: a.N,
  }))
  .sort((a, b) => a.saison - b.saison || 'BAX'.indexOf(a.mode) - 'BAX'.indexOf(b.mode));

const sortie = {
  type: 'FeatureCollection',
  meta: {
    genere: new Date().toISOString(),
    extractionDNF: extraction ? new Date(extraction).toISOString() : null,
    debut,
    fin: [...parTerritoire.values()].flat().reduce((m, d) => (d[0] > m ? d[0] : m), debut), // dernière chasse déclarée
    chasses: [...parTerritoire.values()].reduce((n, d) => n + d.length, 0),
    territoiresDeclares: cles.length,
    territoiresSansGeometrie: sansTrace.length,
  },
  periodes,
  sansTrace,
  features,
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });

// 5. France : jours chassés des forêts domaniales proches (ONF). Une panne de l'ONF ne doit pas
// bloquer la Wallonie : on reprend alors la dernière récupération publiée, et le site l'annonce.
const SITE = process.env.SITE ?? (process.env.GITHUB_REPOSITORY
  ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0].toLowerCase()}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
  : 'https://gaustar.github.io/chasse-wallonie/');
const publie = await fetch(`${SITE}data/onf.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const age = publie ? (Date.now() - new Date(publie.genere)) / 3600000 : Infinity;
let onf = publie;
let erreurONF = null;
if (age > 20 || process.env.ONF === 'force') { // une récupération par jour suffit et ménage l'ONF
  try {
    onf = await chassesONF(debut);
  } catch (e) {
    erreurONF = e.message;
    console.error('ONF indisponible :', e.message);
  }
}
if (onf) {
  for (const f of onf.features) {
    const d = f.properties.d.filter(([jour]) => jour >= debut);
    if (d.length) sortie.features.push({ ...f, properties: { ...f.properties, d } });
  }
  if (onf.saison?.n) sortie.periodes.push({ fr: 1, mode: 'B', debut: onf.saison.debut, fin: onf.saison.fin, n: onf.saison.n });
  await writeFile(new URL('../data/onf.json', import.meta.url), JSON.stringify(onf));
}
sortie.meta.onf = onf ? { genere: onf.genere, forets: onf.forets, chasses: onf.chasses, erreur: erreurONF } : { erreur: erreurONF ?? 'aucune donnée' };
await writeFile(new URL('../data/chasses.json', import.meta.url), JSON.stringify(sortie));

// 6. Calendriers d'abonnement (.ics) : Wallonie, par cantonnement ou forêt, par territoire.
const { ICS } = globalThis;
const liste = ICS.territoires(sortie);
const opt = { base: SITE, source: new Date(sortie.meta.extractionDNF ?? Date.now()).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) };
const cal = new URL('../cal/', import.meta.url);
await rm(cal, { recursive: true, force: true });
await mkdir(new URL('t/', cal), { recursive: true });
const ecrit = (nom, titre, description, evts) => writeFile(new URL(nom, cal), ICS.fichier(titre, description, evts));
const NOTE = 'Chasses déclarées au DNF (Wallonie) et jours chassés publiés par l’ONF (France), mis à jour automatiquement. Les panneaux sur le terrain priment toujours.';

await ecrit('wallonie.ics', 'Chasses · Wallonie', NOTE, ICS.parJour(liste.filter((t) => !t.fr), { ...opt, portee: 'Wallonie', cle: 'wallonie' }));
const zones = new Map(liste.filter((t) => t.can).map((t) => [t.can, ICS.zone(t)]));
for (const [can, zone] of zones) {
  const dedans = liste.filter((t) => t.can === can);
  await ecrit(`${zone.fichier}.ics`, `Chasses · ${zone.court}`, NOTE, ICS.parJour(dedans, { ...opt, portee: zone.nom, cle: zone.cle, can }));
  await ecrit(`${zone.fichier}-detail.ics`, `Chasses · ${zone.court} (par territoire)`, NOTE, ICS.parTerritoire(dedans, opt));
}
for (const t of liste) await ecrit(`t/${ICS.fichierLot(t.lot)}.ics`, `Chasses · ${ICS.libelle(t)}`, NOTE, ICS.parTerritoire([t], opt));
console.log(sortie.meta, { calendriers: 1 + 2 * zones.size + liste.length });
