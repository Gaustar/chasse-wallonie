// Suivi de fréquentation de Chasses du jour : reçoit les événements de suivi.js, les range dans D1,
// et sert la page de gestion (page.html) protégée par un jeton (secret JETON).
// Rien de personnel : pas d'IP, pas de position, pas de territoire consulté. Purge à 12 mois.

import { valide, court, idsValides } from './logique.js';
import PAGE from './page.html';

const ORIGINE = 'https://gaustar.github.io';
const CORS = { 'Access-Control-Allow-Origin': ORIGINE };
const LIMITE = 20000; // lignes renvoyées à la page, les plus récentes

const json = (corps, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// Sans secret défini, « Bearer undefined » ne doit pas ouvrir la porte.
const autorise = (req, env) => env.JETON && req.headers.get('Authorization') === `Bearer ${env.JETON}`;

async function corpsJson(req) {
  try { return JSON.parse(await req.text()); } catch { return null; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST' } });

    // shortcut: aucun plafond d'envois (Origin falsifiable hors navigateur) ; la page ne lit que les 20 000 derniers. Ajouter un rate limit Cloudflare si un abus apparaît.
    if (route === 'POST /e') {
      if (req.headers.get('Origin') !== ORIGINE) return new Response(null, { status: 403 });
      const texte = await req.text();
      if (texte.length > 1024) return new Response(null, { status: 413 });
      let e;
      try { e = valide(JSON.parse(texte), req.headers.get('User-Agent') ?? ''); } catch { e = null; }
      if (!e) return new Response(null, { status: 400, headers: CORS });
      await env.DB.prepare('INSERT INTO evt (t, appareil, uid, sid, type, nom, detail, ms, ecran, inst, donnees, ua) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(Date.now(), e.appareil, e.uid, e.sid, e.type, e.nom, e.detail, e.ms, e.ecran, e.inst, e.donnees, e.ua).run();
      return new Response(null, { status: 204, headers: CORS });
    }

    if (route === 'GET /') return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
    if (!['GET /donnees', 'POST /nommer', 'POST /supprimer'].includes(route)) return json({ erreur: 'introuvable' }, 404);
    if (!autorise(req, env)) return json({ erreur: 'jeton' }, 401);

    if (route === 'GET /donnees') {
      const [evts, noms, comptes] = await env.DB.batch([
        env.DB.prepare(`SELECT rowid AS id, t, uid, sid, type, nom, detail, ms, ecran, inst, donnees, ua FROM evt ORDER BY t DESC LIMIT ${LIMITE}`),
        env.DB.prepare('SELECT uid, nom FROM nom_appareil'),
        env.DB.prepare('SELECT uid, count(*) AS n FROM evt GROUP BY uid'),
      ]);
      // Totaux réels par appareil : les confirmations de suppression annoncent ce qui sera vraiment effacé, au-delà des lignes chargées.
      const parUid = Object.fromEntries(comptes.results.map((c) => [c.uid, c.n]));
      return json({ evenements: evts.results, noms: Object.fromEntries(noms.results.map((n) => [n.uid, n.nom])), comptes: parUid, total: comptes.results.reduce((s, c) => s + c.n, 0), limite: LIMITE });
    }

    if (route === 'POST /nommer') {
      const n = await corpsJson(req);
      const uid = court(n?.uid, 8), nom = court(n?.nom, 24)?.trim();
      if (!uid) return json({ erreur: 'uid' }, 400);
      await (nom
        ? env.DB.prepare('INSERT INTO nom_appareil (uid, nom) VALUES (?, ?) ON CONFLICT (uid) DO UPDATE SET nom = excluded.nom').bind(uid, nom)
        : env.DB.prepare('DELETE FROM nom_appareil WHERE uid = ?').bind(uid)
      ).run();
      return json({ ok: true });
    }

    // POST /supprimer : { ids: [...] } ligne par ligne, { uid } un appareil entier (avec son nom), ou { tout: true }.
    const s = await corpsJson(req);
    if (s?.tout === true) {
      const [r] = await env.DB.batch([env.DB.prepare('DELETE FROM evt'), env.DB.prepare('DELETE FROM nom_appareil')]);
      return json({ supprimes: r.meta.changes });
    }
    const uid = court(s?.uid, 8);
    if (uid) {
      const [r] = await env.DB.batch([env.DB.prepare('DELETE FROM evt WHERE uid = ?').bind(uid), env.DB.prepare('DELETE FROM nom_appareil WHERE uid = ?').bind(uid)]);
      return json({ supprimes: r.meta.changes });
    }
    const ids = idsValides(s?.ids);
    if (!ids) return json({ erreur: 'ids' }, 400);
    // Un seul paramètre JSON : pas de limite de 100 paramètres ni de lots multiples.
    const r = await env.DB.prepare('DELETE FROM evt WHERE rowid IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).run();
    return json({ supprimes: r.meta.changes });
  },

  async scheduled(_evt, env) {
    await env.DB.prepare('DELETE FROM evt WHERE t < ?').bind(Date.now() - 365 * 864e5).run();
  },
};
