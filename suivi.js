// Suivi de fréquentation maison : ouvertures, durée active, actions nommées, erreurs.
// Ni IP, ni position, ni territoire : voir stats/worker.js. Muet en local et sans réseau.
(() => {
  const URL_STATS = 'https://chasse-stats.gaustar.workers.dev/e';
  const SESSION_MS = 30 * 60 * 1000;
  if (!/\.github\.io$/.test(location.hostname) || navigator.webdriver) {
    window.suivi = window.suiviOuvre = () => {};
    return;
  }

  const lit = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrit = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // Le lien « …/?appareil=ami » étiquette l'appareil une fois pour toutes, puis le paramètre disparaît de l'adresse.
  const p = new URLSearchParams(location.search);
  if (p.has('appareil')) {
    ecrit('appareil', p.get('appareil').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24));
    p.delete('appareil');
    history.replaceState(null, '', location.pathname + (p.size ? `?${p}` : '') + location.hash);
  }
  const appareil = lit('appareil') || 'inconnu';
  let uid = lit('uid');
  if (!uid) ecrit('uid', (uid = crypto.randomUUID().slice(0, 8)));

  let sid = lit('sid');
  const neuve = !sid || Date.now() - Number(lit('sid-t')) > SESSION_MS;
  if (neuve) ecrit('sid', (sid = crypto.randomUUID().slice(0, 8)));

  const envoie = (e) => {
    ecrit('sid-t', Date.now());
    // keepalive : l'envoi survit à la fermeture de l'onglet ; text/plain : pas de requête préalable CORS.
    fetch(URL_STATS, { method: 'POST', body: JSON.stringify({ appareil, uid, sid, ...e }), keepalive: true, credentials: 'omit' }).catch(() => {});
  };

  let debut = document.visibilityState === 'visible' ? Date.now() : 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && debut) {
      envoie({ type: 'fin', ms: Date.now() - debut });
      debut = 0;
    } else if (document.visibilityState === 'visible') debut = Date.now();
  });

  window.suivi = (nom, extra = {}) => envoie({ type: 'action', nom, ...extra });
  window.suiviOuvre = (donnees) => {
    if (neuve && document.visibilityState === 'visible') {
      envoie({
        type: 'ouvre',
        ecran: `${screen.width}x${screen.height}`,
        inst: matchMedia('(display-mode: standalone)').matches ? 1 : 0,
        donnees,
      });
    }
  };
  window.addEventListener('error', (e) => envoie({ type: 'erreur', nom: String(e.message).slice(0, 120) }));
})();
