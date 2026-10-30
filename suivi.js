// Suivi de fréquentation maison : ouvertures, durée active, actions nommées, erreurs.
// Ni IP, ni position, ni territoire : voir stats/worker.js. Rien n'est écrit ni envoyé avant
// « J'accepte » ; muet hors github.io (développement local) et sous automate.
(() => {
  const URL_STATS = 'https://chasse-stats.gaustar.workers.dev/e';
  const SESSION_MS = 30 * 60 * 1000;
  const actif = /\.github\.io$/.test(location.hostname) && !navigator.webdriver;

  const lit = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrit = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  let pret = false, uid, sid, neuve, debut = 0, ouvreEnAttente, donneesVues;

  const envoie = (e) => {
    if (!pret) return;
    ecrit('sid-t', Date.now());
    // keepalive : l'envoi survit à la fermeture de l'onglet ; text/plain : pas de requête préalable CORS.
    fetch(URL_STATS, { method: 'POST', body: JSON.stringify({ uid, sid, ...e }), keepalive: true, credentials: 'omit' }).catch(() => {});
  };

  const ouvre = (donnees) => {
    donneesVues = donnees;
    if (!neuve || document.visibilityState !== 'visible') return;
    neuve = false;
    envoie({ type: 'ouvre', ecran: `${screen.width}x${screen.height}`, inst: matchMedia('(display-mode: standalone)').matches ? 1 : 0, donnees });
  };

  const session = () => {
    sid = lit('sid');
    neuve = !sid || Date.now() - Number(lit('sid-t')) > SESSION_MS;
    if (neuve) ecrit('sid', (sid = crypto.randomUUID().slice(0, 8)));
  };

  const demarre = () => {
    if (!actif) return;
    pret = true;
    uid = lit('uid');
    if (!uid) ecrit('uid', (uid = crypto.randomUUID().slice(0, 8)));
    session();
    debut = document.visibilityState === 'visible' ? Date.now() : 0;
    if (ouvreEnAttente !== undefined) ouvre(ouvreEnAttente);
  };

  document.addEventListener('visibilitychange', () => {
    if (!pret) return;
    if (document.visibilityState === 'hidden' && debut) {
      envoie({ type: 'fin', ms: Date.now() - debut });
      debut = 0;
    } else if (document.visibilityState === 'visible') {
      // Appli restée en mémoire (PWA Android) : un retour après 30 min est une nouvelle visite.
      session();
      if (neuve) ouvre(donneesVues);
      debut = Date.now();
    }
  });

  window.suivi = (nom, extra = {}) => envoie({ type: 'action', nom, ...extra });
  window.suiviOuvre = (donnees) => (pret ? ouvre(donnees) : (ouvreEnAttente = donnees));
  window.addEventListener('error', (e) => envoie({ type: 'erreur', nom: String(e.message).slice(0, 120) }));

  // Fenêtre d'accueil obligatoire : Échap et le bouton retour Android la ferment, on la rouvre.
  // « accepte » en mémoire : si le stockage est bloqué (navigation privée), pas de boucle infinie.
  let accepte = lit('stats-ok') === '1';
  if (accepte) return demarre();
  const fenetre = document.getElementById('accueil');
  fenetre.addEventListener('cancel', (e) => e.preventDefault());
  fenetre.addEventListener('close', () => accepte || fenetre.showModal());
  fenetre.querySelector('form').addEventListener('submit', () => {
    accepte = true;
    ecrit('stats-ok', '1');
    demarre();
  });
  fenetre.showModal();
})();
