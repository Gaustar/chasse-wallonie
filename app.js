const COULEURS = { B: '#d7263d', A: '#f08c00', X: '#7b4bd1' };
const LIBELLES = { B: 'Battue', A: 'Affût', X: 'Autre' };
const GRAVITE = ['B', 'X', 'A']; // couleur retenue quand plusieurs modes tombent dans la période

const $ = (s) => document.querySelector(s);
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(d);
const decale = (jour, n) => {
  const d = new Date(jour + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lisible = (jour) =>
  new Date(jour + 'T12:00:00Z').toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const carte = L.map('carte', { zoomControl: false }).setView([50.25, 5.2], 9);
L.control.zoom({ position: 'bottomleft' }).addTo(carte);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(carte);
const CREDIT = 'Données chasse : SPW – DNF';
// Photo aérienne SPW : pas de tuiles Web Mercator, on demande chaque tuile à l'export ArcGIS (512 px).
const Ortho = L.TileLayer.extend({
  getTileUrl(c) {
    const t = 20037508.342789244;
    const pas = (2 * t) / 2 ** c.z;
    const bbox = [-t + c.x * pas, t - (c.y + 1) * pas, -t + (c.x + 1) * pas, t - c.y * pas].join(',');
    return `https://geoservices.wallonie.be/arcgis/rest/services/IMAGERIE/ORTHO_LAST/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&f=image`;
  },
});
const fonds = {
  'Carte IGN': L.tileLayer('https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png', {
    maxNativeZoom: 17,
    maxZoom: 20,
    attribution: `© IGN/NGI · ${CREDIT}`,
  }),
  'Photo aérienne': new Ortho('', { maxZoom: 20, attribution: `Orthophotos © SPW · ${CREDIT}` }),
  Relief: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 17,
    maxZoom: 20,
    attribution: `© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA) · ${CREDIT}`,
  }),
};
let fondChoisi = 'Carte IGN';
try { fondChoisi = localStorage.getItem('fond') in fonds ? localStorage.getItem('fond') : fondChoisi; } catch {}
fonds[fondChoisi].addTo(carte);
L.control.layers(fonds, null, { position: 'topright' }).addTo(carte);
carte.on('baselayerchange', (e) => { try { localStorage.setItem('fond', e.name); } catch {} });

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
    filter: (f) => dansPeriode(f, modes).length > 0,
    style: (f) => {
      const actives = dansPeriode(f, modes);
      chasses += actives.length;
      const mode = GRAVITE.find((m) => actives.some((a) => a[1] === m));
      const fermee = actives.some((a) => a[2]);
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
  verifiePosition();
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
      return `<li><strong>Territoire ${t.lot}</strong>${t.cant ? `<em>${t.cant} (d'après le numéro de lot)</em>` : ''}${dates}</li>`;
    })
    .join('');
}

function infobulle(f) {
  const p = f.properties;
  const lignes = p.d
    .map(([j, m, ferme]) => {
      const hors = j < periode.debut || j > periode.fin ? ' class="hors"' : '';
      return `<li${hors}><b style="background:${COULEURS[m]}"></b>${lisible(j)} · ${LIBELLES[m]}<small>${ferme ? 'chemins fermés' : 'sans fermeture'}</small></li>`;
    })
    .join('');
  return `<h3>Territoire ${p.lot}</h3><p>${[p.ugc, p.cant].filter(Boolean).join(' · ')}</p><ul>${lignes}</ul>`;
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
    a.textContent = `Vous êtes dans le territoire ${touche.properties.lot} : chasse déclarée ${lisible(j)} (${LIBELLES[m].toLowerCase()}${ferme ? ', chemins fermés' : ''})`;
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

async function charge() {
  const etat = $('#etat');
  try {
    const r = await fetch('data/chasses.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    donnees = await r.json();
  } catch (e) {
    etat.textContent = `Données indisponibles (${e.message})`;
    etat.className = 'perime';
    return;
  }
  const m = donnees.meta;
  const fmt = (d) => new Date(d).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
  const perime = m.debut < iso(new Date());
  etat.className = perime ? 'perime' : '';
  etat.textContent =
    `${perime ? '⚠ Données non rafraîchies · ' : ''}DNF au ${fmt(m.extractionDNF)}, récupéré le ${fmt(m.genere)} · chasses déclarées jusqu'au ${new Date(m.fin + 'T12:00:00Z').toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  for (const id of ['#du', '#au']) {
    $(id).min = m.debut;
    $(id).max = m.fin;
    $(id).value = periode.debut;
  }
  dessine();
}

charge();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
