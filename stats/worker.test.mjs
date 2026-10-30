import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valide, agrege, appareilDe } from './worker.js';

test('valide rejette un type inconnu et tronque', () => {
  assert.equal(valide({ type: 'pirate', sid: 'a', uid: 'b' }, ''), null);
  assert.equal(valide({ type: 'fin', sid: 'a', uid: 'b', ms: 9e9 }, '').ms, 4 * 3600 * 1000);
  assert.equal(valide({ type: 'action', sid: 'a', uid: 'b', nom: 'x'.repeat(500) }, '').nom.length, 120);
});

test('appareilDe reconnaît Android/Chrome', () => {
  assert.equal(appareilDe('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36'), 'Android/Chrome');
});

test('agrege coupe les jours en heure de Bruxelles', () => {
  // 23:30 UTC le 29/10/2026 = 00:30 le 30/10 à Bruxelles (UTC+1)
  const t = Date.UTC(2026, 9, 29, 23, 30);
  const r = agrege([
    { t, appareil: 'ami', uid: 'u', sid: 's1', type: 'ouvre', ua: 'Android/Chrome', ecran: '360x800', inst: 0, donnees: null, nom: null, ms: null },
    { t: t + 1000, appareil: 'ami', uid: 'u', sid: 's1', type: 'fin', ms: 60000 },
    { t: t + 2000, appareil: 'ami', uid: 'u', sid: 's1', type: 'action', nom: 'gps' },
  ]);
  assert.equal(r.jours[0].jour, '2026-10-30');
  assert.deepEqual([r.appareils[0].sessions, r.appareils[0].jours, r.appareils[0].ms], [1, 1, 60000]);
  assert.deepEqual(r.actions, [{ appareil: 'ami', nom: 'gps', n: 1 }]);
});
