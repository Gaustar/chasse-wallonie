// Jours chassés en forêt domaniale (France), d'après les calendriers publiés par l'ONF.
// Source : pages « Jours chassés en forêt domaniale de … » de onf.fr et leur service
// cartographique des lots de chasse. Actions collectives de chasse à tir au grand gibier,
// données indicatives selon l'ONF.
const ONF = 'https://www.onf.fr';
const RECHERCHE = `${ONF}/chasse/les-calendriers-de-chasse-en-foret-domaniale`;
const LOTS = `${ONF}/arcgis/rest/services/artemis_cal/artemis_ref_chasse/MapServer/0/query`; // périmètres des lots de chasse
// Communes de référence (code INSEE) : l'ONF renvoie les forêts domaniales à moins de 50 km.
export const COMMUNES = { Sedan: '08409', 'Charleville-Mézières': '08105' };
const UA = 'chasse-wallonie (+https://github.com/Gaustar/chasse-wallonie)';
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function lit(url, type = 'text') {
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
      await pause(250); // on ménage le serveur de l'ONF
      const contenu = await r[type]();
      // Le service cartographique de l'ONF répond par intermittence « Unable to complete operation ».
      if (contenu?.error) throw new Error(`${JSON.stringify(contenu.error)} sur ${url}`);
      return contenu;
    } catch (e) {
      if (essai >= 5) throw e;
      await pause(1500 * essai);
    }
  }
}

const decode = (t) => t.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const attribut = (html, nom) => {
  const m = html.match(new RegExp(`${nom}=(?:"([^"]*)"|'([^']*)')`));
  return m ? decode(m[1] ?? m[2]) : null;
};

// Arrondi à 5 décimales (~1 m), points consécutifs identiques retirés.
function arrondit(c) {
  if (typeof c[0][0] !== 'number') return c.map(arrondit);
  const points = c.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
}

function centre(geometrie) {
  let [o, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  (function parcourt(c) {
    if (typeof c[0] !== 'number') return c.forEach(parcourt);
    o = Math.min(o, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
  })(geometrie.coordinates);
  return [+((s + n) / 2).toFixed(5), +((o + e) / 2).toFixed(5)];
}

export async function chassesONF(debut) {
  // 1. Forêts avec calendrier autour des communes de référence.
  const forets = new Map();
  for (const insee of Object.values(COMMUNES)) {
    const html = await lit(`${RECHERCHE}?user_search=${insee}&start=0&length=100`);
    for (const m of JSON.parse(attribut(html, 'data-map-markers') ?? '{"markers":[]}').markers) {
      forets.set(m.id.replace('CC::', ''), { nom: m.label.replace(/^Jours chassés en /, ''), url: m.href });
    }
  }
  if (!forets.size) throw new Error('aucune forêt renvoyée par la recherche ONF');

  // 2. Calendrier de chaque forêt : [{ date, id_contrat, id_lots, has_perimetres }].
  const contours = new Map(); // lot → ses polygones
  const lot = async (id) => {
    if (!contours.has(id)) {
      const url = `${LOTS}?${new URLSearchParams({
        where: `id_nat_lot='${id}'`, // une égalité par requête : le pare-feu de l'ONF refuse IN, OR et AND
        outFields: 'id_nat_lot,code,actif',
        outSR: '4326', // sans geometryPrecision ni maxAllowableOffset : le serveur ONF échoue avec sur certains lots
        f: 'geojson',
      })}`;
      const reponse = await lit(url, 'json');
      const traces = (reponse.features ?? []).filter((f) => f.geometry);
      for (const f of traces) f.geometry.coordinates = arrondit(f.geometry.coordinates);
      const actifs = traces.filter((f) => f.properties.actif === 1);
      contours.set(id, actifs.length ? actifs : traces);
    }
    return contours.get(id);
  };

  const zones = new Map(); // un polygone par lot (ou par forêt entière), avec toutes ses dates
  const ajoute = (cle, date, mode, creation) => {
    if (!zones.has(cle)) zones.set(cle, { ...creation(), dates: new Map() });
    zones.get(cle).dates.set(date, mode);
  };
  let chasses = 0;
  let foretEntiere = 0;
  const saison = { debut: null, fin: null, n: 0 }; // toutes les dates publiées, passées comprises
  for (const [code, foret] of forets) {
    const html = await lit(foret.url);
    const publies = JSON.parse(attribut(html, 'data-ams-events') ?? '[]');
    for (const e of publies) {
      saison.n++;
      if (!saison.debut || e.date < saison.debut) saison.debut = e.date;
      if (!saison.fin || e.date > saison.fin) saison.fin = e.date;
    }
    const evenements = publies.filter((e) => e.date >= debut);
    let perimetre = null; // contour de la forêt, chargé seulement si un jour chassé n'a pas de lot tracé
    for (const e of evenements) {
      chasses++;
      // Comme sur onf.fr : les lots cités ce jour-là ; à défaut de tracé, la forêt entière.
      const polygones = [];
      if (e.has_perimetres) for (const id of new Set(e.id_lots)) polygones.push(...(await lot(id)));
      for (const f of polygones) {
        const p = f.properties;
        ajoute(`${code}|${p.id_nat_lot}`, e.date, 'B', () => ({ geometry: f.geometry, lot: p.code ?? p.id_nat_lot, code, foret }));
      }
      if (!polygones.length) {
        foretEntiere++;
        perimetre ??= (await lit(`${RECHERCHE}/++cc++${code}/get-location-forests.json`, 'json')).geometry ?? [];
        perimetre.forEach((geometry, i) => {
          geometry.coordinates = arrondit(geometry.coordinates);
          // Le libellé porte le nom de la forêt : ICS et la recherche regroupent les territoires par lot.
          ajoute(`${code}|foret${i}`, e.date, 'B', () => ({ geometry, lot: `forêt entière (${foret.nom})`, code, foret }));
        });
        if (!perimetre.length) throw new Error(`jour chassé sans aucun contour : ${foret.nom} le ${e.date}`);
      }
    }
  }

  const features = [...zones.values()].map((z) => ({
    type: 'Feature',
    geometry: z.geometry,
    properties: {
      fr: 1,
      lot: z.lot,
      cant: z.foret.nom,
      can: z.code,
      url: z.foret.url,
      c: centre(z.geometry),
      // Le calendrier ONF ne couvre que les actions collectives de chasse au grand gibier (mode « battue »)
      // et ne dit rien d'une fermeture de chemins.
      d: [...z.dates].sort(([a], [b]) => a.localeCompare(b)).map(([jour, mode]) => [jour, mode, null]),
    },
  }));
  return { genere: new Date().toISOString(), forets: forets.size, chasses, foretEntiere, saison, features };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await chassesONF(new Date().toISOString().slice(0, 10));
  console.log({ ...r, features: r.features.length, octets: JSON.stringify(r.features).length });
  console.log(r.features.slice(0, 3).map((f) => ({ ...f.properties, d: f.properties.d.length })));
}
