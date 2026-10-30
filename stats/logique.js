// Validation des événements reçus : séparée du Worker pour être testée sous Node.

export const TYPES = ['ouvre', 'action', 'fin', 'erreur'];

export const court = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

// OS + navigateur en gros : de quoi distinguer deux appareils, rien de plus.
export function appareilDe(ua = '') {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '?';
  const nav = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '?';
  return `${os}/${nav}`;
}

// Valide et tronque ce que le navigateur envoie ; null = rejeté.
export function valide(e, ua) {
  if (!e || !TYPES.includes(e.type) || typeof e.sid !== 'string' || typeof e.uid !== 'string' || !e.sid || !e.uid) return null;
  return {
    appareil: court(e.appareil, 24) || 'inconnu',
    uid: court(e.uid, 8),
    sid: court(e.sid, 8),
    type: e.type,
    nom: court(e.nom, 120),
    ms: Number.isFinite(e.ms) ? Math.min(Math.max(0, Math.round(e.ms)), 4 * 3600 * 1000) : null,
    ecran: court(e.ecran, 12),
    inst: e.inst === 1 ? 1 : e.inst === 0 ? 0 : null,
    donnees: /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.donnees ?? '') ? e.donnees : null,
    ua: appareilDe(ua),
  };
}

// Liste d'identifiants de lignes à supprimer : entiers positifs, 50 000 au plus ; null = rejeté.
export function idsValides(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50000) return null;
  return ids.every((i) => Number.isInteger(i) && i > 0) ? ids : null;
}
