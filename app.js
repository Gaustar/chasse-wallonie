const COULEURS = { B: '#d7263d', A: '#f08c00', X: '#7b4bd1' };
const LIBELLES = { B: 'Battue', A: 'Affût', X: 'Autre' };
const GRAVITE = ['B', 'X', 'A']; // couleur retenue quand plusieurs modes tombent dans la période

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(d);
const decale = (jour, n) => {
  const d = new Date(jour + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lisible = (jour) =>
  new Date(jour + 'T12:00:00Z').toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const memoire = (cle, defaut) => {
  try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; }
};
const retient = (cle, valeur) => {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch {}
};

// Canvas : des centaines de territoires détaillés restent fluides sur téléphone.
const vue = memoire('vue', { c: [49.82, 5.0], z: 11 }); // Corbion et la frontière
const carte = L.map('carte', { zoomControl: false, renderer: L.canvas({ padding: 0.3, tolerance: 6 }) }).setView(vue.c, vue.z);
carte.on('moveend', () => retient('vue', { c: [carte.getCenter().lat, carte.getCenter().lng], z: carte.getZoom() }));
L.control.zoom({ position: 'bottomleft' }).addTo(carte);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(carte);

const ControleLegende = L.Control.extend({
  onAdd: (carte) => {
    const div = L.DomUtil.create('div', 'legende');
    div.innerHTML =
      '<h4>Légende</h4>' +
      '<div class="ligne"><span class="badge B"></span> Battue</div>' +
      '<div class="ligne"><span class="badge A"></span> Affût</div>' +
      '<div class="ligne"><span class="badge X"></span> Autre</div>' +
      '<div class="ligne"><span class="trait plein"></span> Chemin fermé ce jour</div>' +
      '<div class="ligne"><span class="trait pointille"></span> Sans fermeture</div>' +
      '<div class="source">SPW – DNF (Wallonie) · ONF (France)</div>';
    return div;
  },
  onRemove() {}
});
carte.addControl(new ControleLegende({ position: 'bottomright' }));
const CREDIT = 'Données chasse : SPW – DNF, ONF';
// Photo aérienne SPW : pas de tuiles Web Mercator, on demande chaque tuile à l'export ArcGIS (512 px).
const Ortho = L.TileLayer.extend({
  getTileUrl(c) {
    const t = 20037508.342789244;
    const pas = (2 * t) / 2 ** c.z;
    const bbox = [-t + c.x * pas, t - (c.y + 1) * pas, -t + (c.x + 1) * pas, t - c.y * pas].join(',');
    return `https://geoservices.wallonie.be/arcgis/rest/services/IMAGERIE/ORTHO_LAST/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&f=image`;
  },
});
const geopf = (couche, format) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${couche}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;
// Les fonds belges sont transparents hors de Belgique : on les pose sur leur équivalent français
// pour couvrir les deux côtés de la frontière.
const fonds = {
  'Carte IGN': L.layerGroup([
    L.tileLayer(geopf('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxNativeZoom: 19, maxZoom: 20, attribution: `© IGN France` }),
    L.tileLayer('https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png', {
      maxNativeZoom: 17,
      maxZoom: 20,
      attribution: `© IGN/NGI Belgique · ${CREDIT}`,
    }),
  ]),
  'Photo aérienne': L.layerGroup([
    L.tileLayer(geopf('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxNativeZoom: 19, maxZoom: 20, attribution: `© IGN France` }),
    new Ortho('', { maxZoom: 20, attribution: `Orthophotos © SPW · ${CREDIT}` }),
  ]),
  Relief: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 17,
    maxZoom: 20,
    attribution: `© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA) · ${CREDIT}`,
  }),
};
const fondChoisi = memoire('fond', 'Carte IGN');
fonds[fondChoisi in fonds ? fondChoisi : 'Carte IGN'].addTo(carte);
L.control.layers(fonds, null, { position: 'topright' }).addTo(carte);
carte.on('baselayerchange', (e) => retient('fond', e.name));

let donnees = null;
let couche = null;
let periode = { debut: iso(new Date()), fin: iso(new Date()) };
let moi = null; // { latlng, marqueur, cercle }

function bornes(p) {
  const auj = iso(new Date());
  if (p === 'demain') return { debut: decale(auj, 1), fin: decale(auj, 1) };
  if (p === 'semaine') return { debut: auj, fin: decale(auj, 6) };
  if (p === 'mois') return { debut: auj, fin: decale(auj, 29) };
  if (p === 'saison') return { debut: auj, fin: donnees?.meta.fin ?? auj };
  if (p === 'weekend') {
    const j = new Date(auj + 'T12:00:00Z').getUTCDay(); // 0 = dimanche
    if (j === 0) return { debut: auj, fin: auj };
    return { debut: decale(auj, 6 - j), fin: decale(auj, 7 - j) };
  }
  return { debut: auj, fin: auj };
}

const modesActifs = () => [...document.querySelectorAll('#modes input:checked')].map((i) => i.value);
const dansPeriode = (f, modes) =>
  f.properties.d.filter(([j, m]) => j >= periode.debut && j <= periode.fin && modes.includes(m));

function dessine() {
  if (!donnees) return;
  const modes = modesActifs();
  if (couche) couche.remove();
  let chasses = 0;
  couche = L.geoJSON(donnees, {
    filter: (f) => {
      if (lotFiltre && f.properties.lot != lotFiltre) return false;
      return dansPeriode(f, modes).length > 0;
    },
    style: (f) => {
      const actives = dansPeriode(f, modes);
      chasses += actives.length;
      const mode = GRAVITE.find((m) => actives.some((a) => a[1] === m));
      const fermee = actives.some((a) => a[2]) || f.properties.fr; // l'ONF ne parle pas de fermeture : trait plein
      return {
        color: COULEURS[mode],
        weight: fermee ? 2.5 : 1.5,
        dashArray: fermee ? null : '5 5',
        fillOpacity: fermee ? 0.4 : 0.18,
      };
    },
    onEachFeature: (f, l) => l.bindPopup(() => infobulle(f), { maxWidth: 300 }),
  }).addTo(carte);
  const n = new Set(couche.getLayers().map((l) => l.feature.properties.lot)).size;
  $('#compte').textContent = `${n} territoire${n > 1 ? 's' : ''}`;
  listeSansTrace(modes);
  messageVide(modes);
  verifiePosition();
}

const longue = (jour) =>
  new Date(jour + 'T12:00:00Z').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const courte = (jour) =>
  new Date(jour + 'T12:00:00Z').toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Toutes les chasses à venir, tracées ou non : [date, mode, fermeture].
const toutes = () => [...donnees.features.map((f) => f.properties.d), ...(donnees.sansTrace ?? []).map((t) => t.d)].flat();
const prochaine = (modes, apres, dates = toutes()) =>
  dates.reduce((min, [j, m]) => (modes.includes(m) && j > apres && (!min || j < min) ? j : min), null);
// Dates d'une seule source : forêts ONF (France) ou territoires wallons.
const datesDe = (fr) => [
  ...donnees.features.filter((f) => !!f.properties.fr === fr).map((f) => f.properties.d),
  ...(fr ? [] : (donnees.sansTrace ?? []).map((t) => t.d)),
].flat();

// Rien sur la période affichée : on annonce la prochaine chasse déclarée.
function messageVide(modes) {
  const bloc = $('#vide');
  const rien = !toutes().some(([j, m]) => j >= periode.debut && j <= periode.fin && modes.includes(m));
  bloc.hidden = !rien;
  if (!rien) return;
  const suite = prochaine(modes, periode.fin);
  const bouton = $('#vide button');
  bouton.hidden = !suite;
  if (suite) {
    $('#vide span').textContent = `Aucune chasse déclarée sur cette période. Prochaine : ${longue(suite)}.`;
    bouton.textContent = 'Voir ce jour';
    bouton.onclick = () => choisit({ debut: suite, fin: suite });
  } else {
    $('#vide span').textContent =
      "Aucune chasse déclarée sur cette période ni après. Les dates de la prochaine saison s'afficheront dès leur déclaration au DNF.";
  }
}

// Période de chasse déclarée, par mode : début, fin, et prochaine date si rien aujourd'hui.
function affichePeriode() {
  const auj = iso(new Date());
  const toutesSaisons = donnees.periodes ?? [];
  if (!toutesSaisons.length) return;
  const enCours = toutesSaisons.filter((p) => p.fin >= auj);
  const derniere = Math.max(...toutesSaisons.filter((p) => !p.fr).map((p) => p.saison));
  const lignes = enCours.length ? enCours : toutesSaisons.filter((p) => p.saison === derniere);
  const debut = lignes.reduce((m, p) => (p.debut < m ? p.debut : m), lignes[0].debut);
  const fin = lignes.reduce((m, p) => (p.fin > m ? p.fin : m), lignes[0].fin);
  const suite = prochaine(['B', 'A', 'X'], decale(auj, -1));

  let titre;
  if (!suite) titre = `<strong>Hors période</strong> · dernière chasse déclarée le ${courte(fin)}, prochaine saison pas encore déclarée`;
  else if (auj < debut) titre = `<strong>Hors période</strong> · les chasses commencent le ${courte(debut)}`;
  else titre = `<strong>Période de chasse</strong> · du ${courte(debut)} au ${courte(fin)}`;
  $('#periode summary').innerHTML = titre;

  $('#periode ul').innerHTML = lignes
    .map((p) => {
      const pro = prochaine([p.mode], decale(auj, -1), datesDe(!!p.fr));
      let etat;
      if (auj > p.fin || !pro) etat = 'terminé pour cette saison';
      else if (pro === auj) etat = "en cours, chasses déclarées aujourd'hui";
      else if (auj < p.debut) etat = `pas commencé, première le ${longue(pro)}`;
      else etat = `en cours, prochaine le ${longue(pro)}`;
      const saison = !p.fr && lignes.some((l) => !l.fr && l.saison !== p.saison) ? ` (saison ${p.saison}-${p.saison + 1})` : '';
      const nom = p.fr ? 'Forêts domaniales ONF (France)' : LIBELLES[p.mode] + saison;
      return `<li><b style="background:${COULEURS[p.mode]}"></b>${nom} <span>du ${courte(p.debut)} au ${courte(p.fin)} · ${p.n} ${p.fr ? 'jours chassés publiés' : 'chasses déclarées'}</span><em>${etat}</em></li>`;
    })
    .join('') +
    (lignes.some((p) => p.fr)
      ? '<li class="limite">France : seules les forêts domaniales gérées par l’ONF autour de Sedan et Charleville sont couvertes. Les chasses en forêts privées ou communales n’y sont pas publiées.</li>'
      : '');
  $('#periode').hidden = false;
}

// Chasses déclarées dont le territoire n'a pas de tracé public : affichées en texte.
function listeSansTrace(modes) {
  const lots = (donnees.sansTrace ?? [])
    .map((t) => ({ ...t, actives: dansPeriode({ properties: t }, modes) }))
    .filter((t) => t.actives.length);
  const bloc = $('#sanstrace');
  bloc.hidden = lots.length === 0;
  const n = lots.reduce((s, t) => s + t.actives.length, 0);
  $('#sanstrace summary').textContent = `⚠ ${n} chasse${n > 1 ? 's' : ''} déclarée${n > 1 ? 's' : ''} sans tracé sur la carte (${lots.length} territoire${lots.length > 1 ? 's' : ''})`;
  $('#sanstrace ul').innerHTML = lots
    .map((t) => {
      const dates = t.actives
        .map(([j, m, ferme]) => `<span><b style="background:${COULEURS[m]}"></b>${lisible(j)} · ${LIBELLES[m]} · ${ferme ? 'chemins fermés' : 'sans fermeture'}</span>`)
        .join('');
      return `<li><strong>Territoire ${esc(t.lot)}</strong>${t.cant ? `<em>${esc(t.cant)} (d'après le numéro de lot)</em>` : ''}${dates}</li>`;
    })
    .join('');
}

// --- Recherche par lot / cantonnement ---
let lotFiltre = null;
const listeRecherche = [];

function preparerRecherche() {
  if (!donnees || listeRecherche.length) return;
  // nom du cantonnement → son code (612, 932, …)
  const canCode = new Map();
  for (const f of donnees.features) if (f.properties.cant && f.properties.can) canCode.set(f.properties.cant, f.properties.can);
  const canTons = [...canCode.keys()];
  for (const t of donnees.sansTrace ?? []) { if (t.cant && !canCode.has(t.cant)) canTons.push(t.cant); }
  for (const f of donnees.features) {
    const p = f.properties;
    if (!listeRecherche.find(x => x.lot === p.lot))
      listeRecherche.push({ lot: p.lot, can: p.can, cant: p.cant, fr: p.fr });
  }
  for (const t of donnees.sansTrace ?? []) {
    const p = t;
    if (!listeRecherche.find(x => x.lot === p.lot))
      listeRecherche.push({ lot: p.lot, can: p.can, cant: p.cant, fr: false });
  }
  for (const cant of canTons)
    listeRecherche.push({ cant: cant, lot: null, can: canCode.get(cant) });
}

function afficherResultats(term) {
  preparerRecherche();
  const t = term.toLowerCase();
  const res = listeRecherche.filter(it => {
    const matchLot = it.lot && it.lot.toLowerCase().includes(t);
    const matchCan = it.cant && it.cant.toLowerCase().includes(t);
    return matchLot || matchCan;
  });
  res.sort((a, b) => {
    const am = a.lot ? 0 : 1, bm = b.lot ? 0 : 1;
    if (am !== bm) return am - bm;
    return a.cant.localeCompare(b.cant);
  });
  const liste = $('#recherche-liste');
  liste.innerHTML = '';
  if (!res.length) {
    liste.innerHTML = '<div class="item" style="color:var(--discret)">Aucun résultat</div>';
    liste.hidden = false;
    return;
  }
  res.slice(0, 25).forEach((it, i) => {
    const div = document.createElement('div');
    div.className = 'item' + (i === 0 ? ' actif' : '');
    if (it.lot) {
      const pre = it.fr ? 'FR – ' : '';
      div.innerHTML = `<span class="pre">${pre}</span><strong>Territoire ${it.lot}</strong>${it.cant ? ` · <em>${esc(it.cant)}</em>` : ''}`;
      div.dataset.lot = it.lot;
      div.dataset.can = it.can;
    } else {
      const nom = it.fr ? it.cant.replace(/^forêt domaniale /i, '').trim() : ICS.nomCantonnement(it.cant);
      div.innerHTML = `<em class="canType">${it.fr ? 'Forêt' : 'Cantonnement'}</em> <strong>${esc(nom)}</strong>`;
      div.dataset.can = it.can;
    }
    liste.appendChild(div);
  });
  liste.hidden = false;
}

function selectionnerLot(lot) {
  lotFiltre = lot;
  const f = donnees.features.find(x => x.properties.lot == lot);
  if (f && f.properties.c) {
    carte.setView(f.properties.c, 15);
  }
  $('#recherche-clear').hidden = false;
  dessine();
}

function selectionnerCanton(can) {
  lotFiltre = null;
  const centres = [];
  for (const f of donnees.features) if (f.properties.can == can) centres.push(f.properties.c);
  if (centres.length) {
    const c = [0, 0];
    for (const [lng, lat] of centres) { c[0] += lng; c[1] += lat; }
    c[0] /= centres.length; c[1] /= centres.length;
    carte.setView(c, 13);
  }
  dessine();
}

function viderRecherche() {
  lotFiltre = null;
  $('#recherche-input').value = '';
  $('#recherche-liste').innerHTML = '';
  $('#recherche-liste').hidden = true;
  $('#recherche-clear').hidden = true;
  dessine();
}

function infobulle(f) {
  const p = f.properties;
  const lignes = p.d
    .map(([j, m, ferme]) => {
      const hors = j < periode.debut || j > periode.fin ? ' class="hors"' : '';
      const precision = p.fr ? '' : `<small>${ferme ? 'chemins fermés' : 'sans fermeture'}</small>`;
      return `<li${hors}><b style="background:${COULEURS[m]}"></b>${lisible(j)} · ${p.fr ? 'Chasse collective' : LIBELLES[m]}${precision}</li>`;
    })
    .join('');
  const titre = p.fr ? `Lot ONF ${esc(p.lot)}` : `Territoire ${esc(p.lot)}`;
  const sous = p.fr
    ? `${esc(p.cant[0].toUpperCase() + p.cant.slice(1))} · <a href="${esc(p.url)}" target="_blank" rel="noopener">calendrier ONF</a>`
    : esc([p.ugc, p.cant].filter(Boolean).join(' · '));
  return `<h3>${titre}</h3><p>${sous}</p><ul>${lignes}</ul><a href="#" class="vers-cal" data-lot="${esc(p.lot)}">📅 Ajouter au calendrier</a>`;
}

// Point dans un polygone GeoJSON (anneaux extérieurs et trous).
function dansAnneau([x, y], anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}
function contient(geom, pt) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((p) => dansAnneau(pt, p[0]) && !p.slice(1).some((trou) => dansAnneau(pt, trou)));
}

function verifiePosition() {
  const a = $('#alerte');
  if (!moi || !donnees) return (a.hidden = true);
  const pt = [moi.latlng.lng, moi.latlng.lat];
  const modes = modesActifs();
  const touche = donnees.features.find((f) => dansPeriode(f, modes).length && contient(f.geometry, pt));
  a.hidden = false;
  if (touche) {
    const [j, m, ferme] = dansPeriode(touche, modes)[0];
    a.className = 'danger';
    const ou = touche.properties.fr ? `le lot ONF ${touche.properties.lot}` : `le territoire ${touche.properties.lot}`;
    a.textContent = `Vous êtes dans ${ou} : chasse ${touche.properties.fr ? 'inscrite au calendrier' : 'déclarée'} ${lisible(j)} (${LIBELLES[m].toLowerCase()}${ferme ? ', chemins fermés' : ''})`;
  } else {
    a.className = 'ok';
    a.textContent = 'Aucune chasse déclarée à votre position sur la période affichée';
  }
}

function choisit(p) {
  periode = typeof p === 'string' ? bornes(p) : p;
  document.querySelectorAll('#periodes button').forEach((b) => b.classList.toggle('actif', b.dataset.p === p));
  const perso = typeof p !== 'string';
  document.querySelectorAll('.plage').forEach((l) => l.classList.toggle('actif', perso));
  $('#raz').hidden = !perso;
  $('#du').value = periode.debut;
  $('#au').value = periode.fin;
  dessine();
}

document.querySelectorAll('#periodes button').forEach((b) => b.addEventListener('click', () => choisit(b.dataset.p)));
// Plage libre : si une borne dépasse l'autre, on ramène l'autre sur la même date.
$('#du').addEventListener('change', (e) => {
  const debut = e.target.value;
  if (debut) choisit({ debut, fin: periode.fin < debut ? debut : periode.fin });
});
$('#au').addEventListener('change', (e) => {
  const fin = e.target.value;
  if (fin) choisit({ debut: periode.debut > fin ? fin : periode.debut, fin });
});
$('#raz').addEventListener('click', () => choisit('jour'));
$('#modes').addEventListener('change', dessine);

$('#position').addEventListener('click', () => {
  $('#position').classList.add('suivi');
  carte.locate({ watch: true, enableHighAccuracy: true });
  if (moi) carte.setView(moi.latlng, Math.max(carte.getZoom(), 14));
});
carte.on('locationfound', (e) => {
  if (!moi) {
    moi = {
      marqueur: L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#2b6cb0', fillOpacity: 1 }).addTo(carte),
      cercle: L.circle(e.latlng, { radius: e.accuracy, color: '#2b6cb0', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(carte),
    };
    carte.setView(e.latlng, 14);
  }
  moi.latlng = e.latlng;
  moi.marqueur.setLatLng(e.latlng);
  moi.cercle.setLatLng(e.latlng).setRadius(e.accuracy);
  verifiePosition();
});
carte.on('locationerror', (e) => {
  $('#position').classList.remove('suivi');
  const a = $('#alerte');
  a.hidden = false;
  a.className = 'danger';
  a.textContent = `Position indisponible : ${e.message}`;
});

// --- Recherche : écouteurs ---
const input = $('#recherche-input');
input.addEventListener('input', (e) => afficherResultats(e.target.value));
$('#recherche-clear').addEventListener('click', viderRecherche);
$('#recherche-liste').addEventListener('click', (e) => {
  e.stopPropagation();
  const item = e.target.closest('.item');
  if (!item) return;
  if (item.dataset.lot) selectionnerLot(item.dataset.lot);
  else selectionnerCanton(item.dataset.can);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { viderRecherche(); input.blur(); }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#recherche')) viderRecherche();
});

async function charge() {
  const etat = $('#etat');
  try {
    const r = await fetch('data/chasses.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    donnees = await r.json();
  } catch (e) {
    etat.textContent = `Données indisponibles (${e.message})`;
    etat.className = 'perime';
    return;
  }
  const m = donnees.meta;
  const fmt = (d) => new Date(d).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
  const perime = Date.now() - new Date(m.genere) > 36 * 3600 * 1000; // deux mises à jour manquées
  etat.className = perime || !m.onf?.genere || m.onf.erreur ? 'perime' : '';
  etat.textContent =
    `${perime ? '⚠ Données non rafraîchies · ' : ''}${!m.onf?.genere ? '⚠ Forêts ONF (France) indisponibles · ' : m.onf.erreur ? `⚠ ONF en panne, données du ${fmt(m.onf.genere)} · ` : ''}DNF au ${fmt(m.extractionDNF)}, récupéré le ${fmt(m.genere)}${m.onf?.genere && !m.onf.erreur ? `, ONF le ${fmt(m.onf.genere)}` : ''} · chasses déclarées jusqu'au ${new Date(m.fin + 'T12:00:00Z').toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  for (const id of ['#du', '#au']) {
    $(id).min = m.debut;
    $(id).max = m.fin;
    $(id).value = periode.debut;
  }
  affichePeriode();
  prepareCalendrier();
  if (!lienProfond()) dessine();
}

// ---- Liens profonds : #du=2026-10-11&au=2026-10-11&lot=9223075022 (ou &can=922), utilisés par les événements de calendrier.
function lienProfond() {
  const p = new URLSearchParams(location.hash.slice(1));
  const jour = /^\d{4}-\d{2}-\d{2}$/;
  const du = p.get('du');
  const au = p.get('au') ?? du;
  if (!jour.test(du ?? '') || !jour.test(au ?? '') || au < du) return false;
  choisit({ debut: du, fin: au });
  const cible = couche.getLayers().filter((l) => {
    const pr = l.feature.properties;
    return p.has('lot') ? pr.lot === p.get('lot') : p.has('can') ? pr.can === p.get('can') : false;
  });
  if (cible.length) {
    carte.fitBounds(L.featureGroup(cible).getBounds(), { maxZoom: 15, padding: [20, 20] });
    if (p.has('lot')) cible[0].openPopup();
  }
  return true;
}
window.addEventListener('hashchange', () => donnees && lienProfond());

// ---- Export calendrier
const SITE = location.origin + location.pathname.replace(/[^/]*$/, '');
let lotChoisi = null;
const champ = (nom) => document.querySelector(`#cal input[name=${nom}]:checked`).value;

const zonesCal = new Map(); // code → { nom, court, fichier, cle, fr }
function prepareCalendrier() {
  for (const t of ICS.territoires(donnees)) if (t.can && t.cant) zonesCal.set(t.can, ICS.zone(t));
  const groupe = (titre, fr) => {
    const options = [...zonesCal]
      .filter(([, z]) => z.fr === fr)
      .sort((a, b) => a[1].court.localeCompare(b[1].court, 'fr'))
      .map(([can, z]) => `<option value="${esc(can)}">${esc(z.court)}</option>`)
      .join('');
    return options ? `<optgroup label="${titre}">${options}</optgroup>` : '';
  };
  $('#cal-can').innerHTML = groupe('Wallonie – cantonnements', false) + groupe('France – forêts domaniales', true);
  const prefere = memoire('canton', null);
  if (zonesCal.has(prefere)) $('#cal-can').value = prefere;
}

// Emprise de chaque polygone, calculée une fois, pour savoir ce qui est à l'écran.
const emprises = new WeakMap();
function emprise(f) {
  if (!emprises.has(f)) emprises.set(f, L.geoJSON(f).getBounds());
  return emprises.get(f);
}

// Ce que l'utilisateur a choisi dans la fenêtre : territoires, événements, abonnement possible.
function selection() {
  const zone = champ('zone');
  const detail = champ('detail');
  const toute = champ('quand') === 'saison';
  let liste = ICS.territoires(donnees);
  const opt = { base: SITE, source: new Date(donnees.meta.extractionDNF ?? donnees.meta.genere).toLocaleDateString('fr-BE') };
  let abo = null;
  let nom = 'Wallonie';
  let pourquoi = '';

  if (zone === 'lot') {
    liste = liste.filter((t) => t.lot === lotChoisi);
    nom = liste[0] ? ICS.libelle(liste[0]) : `territoire ${lotChoisi}`;
    Object.assign(opt, { portee: nom, cle: `lot${ICS.fichierLot(lotChoisi)}` });
    abo = `cal/t/${ICS.fichierLot(lotChoisi)}.ics`;
  } else if (zone === 'can') {
    const can = $('#cal-can').value;
    const z = zonesCal.get(can);
    liste = liste.filter((t) => t.can === can);
    nom = z?.nom ?? can;
    Object.assign(opt, { portee: nom, cle: z?.cle ?? can, can });
    abo = z ? `cal/${z.fichier}${detail === 'territoire' ? '-detail' : ''}.ics` : null;
  } else if (zone === 'vue') {
    const ecran = carte.getBounds();
    const visibles = new Set(donnees.features.filter((f) => emprise(f).intersects(ecran)).map((f) => f.properties.lot));
    liste = liste.filter((t) => visibles.has(t.lot));
    nom = 'zone affichée';
    Object.assign(opt, { portee: 'zone choisie sur la carte', cle: 'zone' });
    pourquoi = "Pas d'abonnement pour une zone dessinée à l'écran : choisissez un cantonnement ou un territoire pour un calendrier qui se met à jour.";
  } else {
    liste = liste.filter((t) => !t.fr);
    Object.assign(opt, { portee: 'Wallonie', cle: 'wallonie' });
    if (detail === 'jour') abo = 'cal/wallonie.ics';
    else pourquoi = "Pas d'abonnement détaillé pour toute la Wallonie (plusieurs milliers d'événements) : prenez le résumé par jour ou un cantonnement.";
  }

  liste = ICS.filtre(liste, toute ? { modes: modesActifs() } : { debut: periode.debut, fin: periode.fin, modes: modesActifs() });
  const evts = detail === 'territoire' ? ICS.parTerritoire(liste, opt) : ICS.parJour(liste, opt);
  const du = toute ? donnees.meta.debut : periode.debut;
  const au = toute ? donnees.meta.fin : periode.fin;
  return { evts, nom, abo, pourquoi, zone, territoires: liste.length, du, au };
}

function majCalendrier() {
  $('#cal-filtre').textContent = periode.debut === periode.fin ? `Le ${courte(periode.debut)} (période affichée)` : `Du ${courte(periode.debut)} au ${courte(periode.fin)} (période affichée)`;
  const s = selection();
  const n = s.evts.length;
  $('#cal-bilan').textContent = n
    ? `${n} événement${n > 1 ? 's' : ''} · ${s.territoires} territoire${s.territoires > 1 ? 's' : ''} · ${s.nom}` + (n > 1500 ? ' — beaucoup pour un agenda, préférez le résumé par jour.' : '')
    : `Aucune chasse déclarée pour ce choix (${s.nom}).`;
  $('#cal-dl').disabled = !n;
  $('#cal .boutons').hidden = !s.abo;
  if (s.abo) {
    const adresse = SITE + s.abo;
    $('#cal-webcal').href = adresse.replace(/^https?:/, 'webcal:');
    $('#cal-google').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(adresse.replace(/^https:/, 'http:'))}`;
    $('#cal-copie').dataset.adresse = adresse;
    $('#cal-abo-note').textContent = `Calendrier « ${s.nom} », toute la saison et tous les modes, régénéré trois fois par jour. Votre agenda le relit à son propre rythme (souvent une fois par jour). Sans rappel.`;
  } else {
    $('#cal-abo-note').textContent = s.pourquoi;
  }
}

function ouvreCalendrier(lot) {
  lotChoisi = lot ?? null;
  $('#cal-lot').hidden = !lotChoisi;
  $('#cal-lot span').textContent = lotChoisi ? (/^\d+$/.test(lotChoisi) ? `Territoire ${lotChoisi}` : `Lot ONF ${lotChoisi}`) : '';
  if (lotChoisi) {
    document.querySelector('#cal input[value=lot]').checked = true;
    document.querySelector('#cal input[value=territoire]').checked = true;
    document.querySelector('#cal input[value=saison]').checked = true;
  } else if (champ('zone') === 'lot') {
    document.querySelector('#cal input[value=vue]').checked = true;
  }
  majCalendrier();
  $('#cal').showModal();
}

$('#ouvre-cal').addEventListener('click', () => donnees && ouvreCalendrier());
document.addEventListener('click', (e) => {
  const lien = e.target.closest('.vers-cal');
  if (!lien) return;
  e.preventDefault();
  ouvreCalendrier(lien.dataset.lot);
});
$('#cal').addEventListener('change', (e) => {
  if (e.target.id === 'cal-can') {
    document.querySelector('#cal input[value=can]').checked = true;
    retient('canton', e.target.value);
  }
  majCalendrier();
});
$('#cal-dl').addEventListener('click', async () => {
  const s = selection();
  const titre = `Chasses · ${s.nom}`;
  const contenu = ICS.fichier(titre, 'Chasses déclarées au DNF (Wallonie) et jours chassés publiés par l’ONF (France). Les panneaux sur le terrain priment toujours.', s.evts, { rappel: $('#cal-rappel').value });
  const nomFichier = `chasses-${s.nom.replace(/[^a-z0-9à-ÿ]+/gi, '-').toLowerCase()}-${s.du}_${s.au}.ics`;
  const fichier = new File([contenu], nomFichier, { type: 'text/calendar' });
  // Sur téléphone, le partage propose directement l'application d'agenda.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], title: titre });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(fichier), download: nomFichier });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$('#cal-copie').addEventListener('click', async (e) => {
  try {
    await navigator.clipboard.writeText(e.target.dataset.adresse);
    e.target.textContent = 'Adresse copiée';
  } catch {
    e.target.textContent = e.target.dataset.adresse;
  }
  setTimeout(() => (e.target.textContent = "Copier l'adresse"), 4000);
});

// Une erreur de script ne doit jamais laisser une carte vide sans explication.
function signale(e) {
  const etat = $('#etat');
  etat.className = 'perime';
  etat.textContent = `⚠ Erreur d'affichage : ${e?.message ?? e}. Rechargez la page.`;
}
window.addEventListener('error', (e) => signale(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => signale(e.reason));

charge();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
