// Suivi de fréquentation de Chasses du jour : reçoit les événements de suivi.js, les range dans D1,
// et sert une page de consultation protégée par un jeton (secret JETON).
// Rien de personnel : pas d'IP, pas de position, pas de territoire consulté. Purge à 12 mois.

const ORIGINE = 'https://gaustar.github.io';
const TYPES = ['ouvre', 'action', 'fin', 'erreur'];
const CORS = { 'Access-Control-Allow-Origin': ORIGINE };

const court = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

// OS + navigateur en gros : de quoi distinguer deux appareils, rien de plus.
export function appareilDe(ua = '') {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '?';
  const nav = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '?';
  return `${os}/${nav}`;
}

// Valide et tronque ce que le navigateur envoie ; null = rejeté.
export function valide(e, ua) {
  if (!e || !TYPES.includes(e.type) || typeof e.sid !== 'string' || typeof e.uid !== 'string') return null;
  return {
    appareil: court(e.appareil, 24) || 'inconnu',
    uid: court(e.uid, 8),
    sid: court(e.sid, 8),
    type: e.type,
    nom: court(e.nom, 120),
    ms: Number.isFinite(e.ms) ? Math.min(Math.max(0, Math.round(e.ms)), 4 * 3600 * 1000) : null,
    ecran: court(e.ecran, 12),
    inst: e.inst === 1 ? 1 : e.inst === 0 ? 0 : null,
    donnees: court(e.donnees, 40),
    ua: appareilDe(ua),
  };
}

const json = (corps, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const jourBxl = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' });

// Agrège les événements bruts ; le découpage par jour se fait en heure de Bruxelles (changement d'heure compris).
export function agrege(lignes) {
  const app = new Map();
  const jours = new Map();
  const actions = new Map();
  const erreurs = [];
  for (const e of lignes) {
    const cle = `${e.appareil}|${e.uid}`;
    const a = app.get(cle) ?? { appareil: e.appareil, uid: e.uid, sids: new Set(), jours: new Set(), derniere: 0, ms: 0, ua: null, ecran: null, inst: null, donnees: null };
    const jour = jourBxl.format(e.t);
    a.sids.add(e.sid);
    a.jours.add(jour);
    a.derniere = Math.max(a.derniere, e.t);
    if (e.type === 'fin') a.ms += e.ms ?? 0;
    a.ua = e.ua ?? a.ua;
    a.ecran = e.ecran ?? a.ecran;
    a.inst = e.inst ?? a.inst;
    a.donnees = e.donnees ?? a.donnees;
    app.set(cle, a);
    const cj = `${jour}|${e.appareil}`;
    jours.set(cj, { jour, appareil: e.appareil, sids: (jours.get(cj)?.sids ?? new Set()).add(e.sid) });
    if (e.type === 'action') {
      const ca = `${e.appareil}|${e.nom}`;
      actions.set(ca, { appareil: e.appareil, nom: e.nom, n: (actions.get(ca)?.n ?? 0) + 1 });
    }
    if (e.type === 'erreur') erreurs.push({ t: e.t, appareil: e.appareil, nom: e.nom });
  }
  return {
    appareils: [...app.values()].map(({ sids, jours: j, ...a }) => ({ ...a, sessions: sids.size, jours: j.size })).sort((x, y) => y.derniere - x.derniere),
    jours: [...jours.values()].map(({ sids, ...j }) => ({ ...j, sessions: sids.size })).sort((x, y) => (x.jour < y.jour ? 1 : -1)).slice(0, 120),
    actions: [...actions.values()].sort((x, y) => y.n - x.n),
    erreurs: erreurs.sort((x, y) => y.t - x.t).slice(0, 20),
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST' } });

    if (req.method === 'POST' && url.pathname === '/e') {
      if (req.headers.get('Origin') !== ORIGINE) return new Response(null, { status: 403 });
      const texte = await req.text();
      if (texte.length > 1024) return new Response(null, { status: 413 });
      let e;
      try { e = valide(JSON.parse(texte), req.headers.get('User-Agent') ?? ''); } catch { e = null; }
      if (!e) return new Response(null, { status: 400, headers: CORS });
      await env.DB.prepare('INSERT INTO evt (t, appareil, uid, sid, type, nom, ms, ecran, inst, donnees, ua) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(Date.now(), e.appareil, e.uid, e.sid, e.type, e.nom, e.ms, e.ecran, e.inst, e.donnees, e.ua).run();
      return new Response(null, { status: 204, headers: CORS });
    }

    if (req.method === 'GET' && url.pathname === '/resume') {
      // Sans secret défini, « Bearer undefined » ne doit pas ouvrir la porte.
      if (!env.JETON || req.headers.get('Authorization') !== `Bearer ${env.JETON}`) return json({ erreur: 'jeton' }, 401);
      return json(agrege((await env.DB.prepare('SELECT * FROM evt ORDER BY t').all()).results));
    }

    if (req.method === 'GET' && url.pathname === '/') return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return json({ erreur: 'introuvable' }, 404);
  },

  async scheduled(_evt, env) {
    await env.DB.prepare('DELETE FROM evt WHERE t < ?').bind(Date.now() - 365 * 864e5).run();
  },
};

// Les heures sont stockées en UTC (ms) ; la conversion se fait ici, jamais de tête.
const PAGE = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Fréquentation · Chasses du jour</title>
<style>body{font:15px system-ui;margin:1rem;max-width:60rem}table{border-collapse:collapse;margin:.5rem 0 1.5rem;width:100%}
td,th{border-bottom:1px solid #8884;padding:.35rem .5rem;text-align:left}h2{margin:1.5rem 0 0}small{opacity:.7}.scroll{overflow-x:auto}</style>
<h1>Fréquentation</h1><div id="o">Jeton : <input id="k" type="password"> <button id="b">Voir</button></div>
<script>
const fmt = (t) => new Date(t).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' });
const duree = (ms) => (ms < 60000 ? Math.round(ms / 1000) + ' s' : Math.round(ms / 60000) + ' min');
const tab = (tete, lignes) => '<div class=scroll><table><tr>' + tete.map((h) => '<th>' + h + '</th>').join('') + '</tr>' +
  lignes.map((l) => '<tr>' + l.map((c) => '<td>' + String(c ?? '').replace(/[<&]/g, '·') + '</td>').join('') + '</tr>').join('') + '</table></div>';
async function voir() {
  const k = document.getElementById('k').value || sessionStorage.k;
  const r = await fetch('/resume', { headers: { Authorization: 'Bearer ' + k } });
  if (!r.ok) return (document.getElementById('o').textContent = 'Jeton refusé, rechargez la page.');
  sessionStorage.k = k;
  const d = await r.json();
  const parApp = (a) => d.actions.filter((x) => x.appareil === a.appareil).slice(0, 4).map((x) => x.nom + ' ×' + x.n).join(', ');
  document.getElementById('o').innerHTML =
    '<h2>Appareils</h2>' + tab(['Appareil','Dernière visite','Sessions','Jours actifs','Durée active','Système','Écran','Installée','Actions','Données vues'],
      d.appareils.map((a) => [a.appareil, fmt(a.derniere), a.sessions, a.jours, duree(a.ms), a.ua, a.ecran, a.inst ? 'oui' : 'non', parApp(a), a.donnees ? fmt(a.donnees) : ''])) +
    '<h2>Sessions par jour <small>(30 jours)</small></h2>' + tab(['Jour','Appareil','Sessions'], d.jours.map((j) => [j.jour, j.appareil, j.sessions])) +
    '<h2>Erreurs récentes</h2>' + (d.erreurs.length ? tab(['Quand','Appareil','Message'], d.erreurs.map((e) => [fmt(e.t), e.appareil, e.nom])) : '<p>Aucune.</p>');
}
document.getElementById('b').onclick = voir;
if (sessionStorage.k) voir();
</script></html>`;
