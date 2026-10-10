// Génération iCalendar (RFC 5545), partagée entre le site et le script de build.
// Le DNF ne publie aucune heure : tous les événements sont des journées entières.
(() => {
  const MODES = { B: ['battue', 'battues'], A: ['affût', 'affûts'], X: ['autre chasse', 'autres chasses'] };
  const ORDRE = ['B', 'A', 'X'];
  const MAX_LOTS = 60; // au-delà, la description d'un résumé quotidien renvoie vers la carte

  const maj = (t) => t[0].toUpperCase() + t.slice(1);
  const plus = (jour, n) => {
    const d = new Date(jour + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const lisible = (jour) =>
    new Date(jour + 'T12:00:00Z').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  // « CANTONNEMENT DE LA ROCHE-EN-ARDENNE » → « La Roche-en-Ardenne »
  const PETITS = new Set(['en', 'sur', 'de', 'du', 'le', 'les', 'lez', 'la']);
  function nomCantonnement(brut) {
    if (!brut) return '';
    const nom = brut.replace(/^CANTONNEMENT\s+(DE\s+|D[’'])/i, '').toLowerCase();
    return nom.replace(/[a-zà-ÿ]+/g, (mot, i) => (i > 0 && PETITS.has(mot) ? mot : maj(mot)));
  }

  // Liste unique de territoires (un lot peut avoir plusieurs polygones), tracés ou non.
  function territoires(donnees) {
    const vus = new Map();
    for (const { properties: p } of donnees.features) {
      if (!vus.has(p.lot)) vus.set(p.lot, { lot: p.lot, ugc: p.ugc, cant: p.cant, can: p.can, centre: p.c, d: p.d, fr: p.fr, url: p.url });
    }
    for (const t of donnees.sansTrace ?? []) vus.set(t.lot, { ...t, sansTrace: true });
    return [...vus.values()];
  }

  // Restreint chaque territoire aux dates et modes voulus ; retire ceux qui n'ont plus rien.
  function filtre(liste, { debut, fin, modes }) {
    return liste
      .map((t) => ({ ...t, d: t.d.filter(([j, m]) => (!debut || j >= debut) && (!fin || j <= fin) && (!modes || modes.includes(m))) }))
      .filter((t) => t.d.length);
  }

  // Nom d'affichage d'un territoire wallon ou d'un lot ONF, et de sa zone (cantonnement ou forêt domaniale).
  const libelle = (t) => (t.fr ? `lot ONF ${t.lot}` : `territoire ${t.lot}`);
  const fichierLot = (lot) => String(lot).replace(/[^\w-]+/g, '_');
  function zone(t) {
    if (t.fr) return { cle: `foret${t.can}`, fichier: `foret-${t.can}`, nom: t.cant, court: maj(t.cant.replace(/^forêt domaniale (de |du |des |d['’])/i, '')) + ' (ONF)', fr: true };
    const nom = nomCantonnement(t.cant);
    return { cle: `can${t.can}`, fichier: `cantonnement-${t.can}`, nom: `cantonnement de ${nom}`, court: nom, fr: false };
  }

  const pied = (o, fr) =>
    (fr ? 'Source : calendrier de chasse de l’ONF, données indicatives.' : `Source : SPW – DNF${o.source ? `, données du ${o.source}` : ''}.`) + ' Les panneaux sur le terrain priment toujours.';

  // Un événement par territoire ; les jours consécutifs de même nature deviennent une seule période.
  function parTerritoire(liste, o) {
    const evts = [];
    for (const t of liste) {
      const groupes = new Map();
      for (const [jour, mode, ferme] of t.d) {
        const cle = mode + (ferme ?? 'x');
        if (!groupes.has(cle)) groupes.set(cle, []);
        groupes.get(cle).push(jour);
      }
      for (const [cle, jours] of groupes) {
        const mode = cle[0];
        const ferme = cle[1] === '1';
        jours.sort();
        for (let i = 0; i < jours.length; ) {
          let k = i;
          while (k + 1 < jours.length && jours[k + 1] === plus(jours[k], 1)) k++;
          const debut = jours[i];
          const fin = jours[k];
          const lieu = t.cant ? (t.fr ? t.cant : nomCantonnement(t.cant)) : '';
          const quand = debut === fin ? `le ${lisible(debut)}` : `du ${lisible(debut)} au ${lisible(fin)}`;
          const lien = `${o.base}#du=${debut}&au=${fin}&lot=${encodeURIComponent(t.lot)}`;
          evts.push({
            uid: `${debut}-${fichierLot(t.lot)}-${cle}@chasse-wallonie`,
            debut,
            fin,
            resume: `${maj(MODES[mode][0])}${ferme ? ', chemins fermés' : ''} · ${libelle(t)}${lieu ? ` · ${lieu}` : ''}`,
            description: [
              t.fr ? `Action collective de chasse inscrite au calendrier de l’ONF ${quand}.` : `${maj(MODES[mode][0])} déclarée au DNF ${quand}.`,
              t.fr ? null : `Fermeture des chemins : ${ferme ? 'oui' : 'non'}.`,
              t.fr ? `${maj(libelle(t))}, ${t.cant}.` : `Territoire de chasse ${t.lot}${t.ugc ? ` – ${t.ugc}` : ''}.`,
              !t.fr && lieu ? `Cantonnement : ${lieu}${t.sansTrace ? ' (d’après le numéro de lot, tracé non publié)' : ''}.` : null,
              `Carte : ${lien}`,
              t.fr && t.url ? `Calendrier ONF : ${t.url}` : null,
              pied(o, t.fr),
            ].filter(Boolean).join('\n'),
            lieu: t.fr ? `${maj(libelle(t))}, ${t.cant}, France` : `Territoire de chasse ${t.lot}${lieu ? `, cantonnement de ${lieu}` : ''}, Wallonie`,
            geo: t.centre,
            url: lien,
            categorie: maj(MODES[mode][0]),
          });
          i = k + 1;
        }
      }
    }
    return evts.sort((a, b) => a.debut.localeCompare(b.debut) || a.uid.localeCompare(b.uid));
  }

  // Un événement résumé par jour pour toute la zone (o.portee = son nom, o.cle = identifiant stable).
  function parJour(liste, o) {
    const jours = new Map();
    for (const t of liste) {
      for (const [jour, mode, ferme] of t.d) {
        if (!jours.has(jour)) jours.set(jour, { B: [], A: [], X: [], fermes: new Set(), wallons: 0, francais: 0 });
        jours.get(jour)[t.fr ? 'francais' : 'wallons']++;
        jours.get(jour)[mode].push(t.lot);
        if (ferme) jours.get(jour).fermes.add(t.lot);
      }
    }
    const lien = (jour) => `${o.base}#du=${jour}&au=${jour}${o.can ? `&can=${o.can}` : ''}`;
    return [...jours.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([jour, j]) => {
        const presents = ORDRE.filter((m) => j[m].length);
        const compte = (m) => `${j[m].length} ${MODES[m][j[m].length > 1 ? 1 : 0]}`;
        return {
          uid: `${jour}-${o.cle}@chasse-wallonie`,
          debut: jour,
          fin: jour,
          resume: `Chasse · ${o.portee} : ${presents.map(compte).join(', ')}`,
          description: [
            `Chasses ${j.wallons ? 'déclarées au DNF' : 'inscrites au calendrier de l’ONF'}${j.wallons && j.francais ? ' et inscrites au calendrier de l’ONF' : ''} le ${lisible(jour)} – ${o.portee}.`,
            ...presents.map((m) => {
              const lots = [...new Set(j[m])].sort();
              const reste = lots.length - MAX_LOTS;
              return `${maj(MODES[m][1])} (${lots.length}) : territoire${lots.length > 1 ? 's' : ''} ${lots.slice(0, MAX_LOTS).join(', ')}${reste > 0 ? `… et ${reste} autres, voir la carte` : ''}.`;
            }),
            j.wallons ? `Chemins fermés sur ${j.fermes.size} territoire${j.fermes.size > 1 ? 's' : ''} wallon${j.fermes.size > 1 ? 's' : ''}.` : null,
            `Carte : ${lien(jour)}`,
            pied(o, !j.wallons),
          ].filter(Boolean).join('\n'),
          lieu: maj(o.portee),
          url: lien(jour),
          categorie: 'Chasse',
        };
      });
  }

  const echappe = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const encodeur = new TextEncoder();
  // Lignes de 75 octets maximum, sans couper un caractère accentué.
  function plie(ligne) {
    const morceaux = [];
    let courant = '';
    let octets = 0;
    for (const c of ligne) {
      const n = encodeur.encode(c).length;
      if (octets + n > 75) {
        morceaux.push(courant);
        courant = ' ' + c;
        octets = 1 + n;
      } else {
        courant += c;
        octets += n;
      }
    }
    morceaux.push(courant);
    return morceaux.join('\r\n');
  }
  const date = (jour) => jour.replaceAll('-', '');
  const horodatage = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

  const RAPPELS = { veille: '-PT6H', matin: 'PT7H' }; // la veille à 18 h, le jour même à 7 h

  function fichier(nom, description, evts, o = {}) {
    const genere = horodatage(o.genere ?? new Date());
    const lignes = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Chasses du jour Wallonie//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `NAME:${echappe(nom)}`,
      `X-WR-CALNAME:${echappe(nom)}`,
      `DESCRIPTION:${echappe(description)}`,
      `X-WR-CALDESC:${echappe(description)}`,
      'REFRESH-INTERVAL;VALUE=DURATION:PT8H',
      'X-PUBLISHED-TTL:PT8H',
    ];
    for (const e of evts) {
      lignes.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `DTSTAMP:${genere}`,
        `DTSTART;VALUE=DATE:${date(e.debut)}`,
        `DTEND;VALUE=DATE:${date(plus(e.fin, 1))}`, // borne de fin exclue
        `SUMMARY:${echappe(e.resume)}`,
        `DESCRIPTION:${echappe(e.description)}`,
        `LOCATION:${echappe(e.lieu)}`,
        ...(e.geo ? [`GEO:${e.geo[0]};${e.geo[1]}`] : []),
        `URL:${e.url}`,
        `CATEGORIES:${echappe(e.categorie)}`,
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT' // n'occupe pas l'agenda
      );
      if (RAPPELS[o.rappel]) {
        lignes.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${echappe(e.resume)}`, `TRIGGER:${RAPPELS[o.rappel]}`, 'END:VALARM');
      }
      lignes.push('END:VEVENT');
    }
    lignes.push('END:VCALENDAR');
    return lignes.map(plie).join('\r\n') + '\r\n';
  }

  globalThis.ICS = { territoires, filtre, parTerritoire, parJour, fichier, nomCantonnement, zone, libelle, fichierLot };
})();
