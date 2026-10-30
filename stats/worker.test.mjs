import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valide, appareilDe, idsValides } from './logique.js';

test('valide rejette un type inconnu et tronque', () => {
  assert.equal(valide({ type: 'pirate', sid: 'a', uid: 'b' }, ''), null);
  assert.equal(valide({ type: 'fin', sid: 'a', uid: 'b', ms: 9e9 }, '').ms, 4 * 3600 * 1000);
  assert.equal(valide({ type: 'action', sid: 'a', uid: 'b', nom: 'x'.repeat(500) }, '').nom.length, 120);
});

test('valide ne garde que des dates ISO dans donnees', () => {
  assert.equal(valide({ type: 'ouvre', sid: 'a', uid: 'b', donnees: 'x' }, '').donnees, null);
  assert.equal(valide({ type: 'ouvre', sid: 'a', uid: 'b', donnees: '2026-10-30T22:26:54.876Z' }, '').donnees, '2026-10-30T22:26:54.876Z');
});

test('appareilDe reconnaît Android/Chrome', () => {
  assert.equal(appareilDe('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36'), 'Android/Chrome');
});

test('idsValides : entiers positifs uniquement, ni vide ni injection', () => {
  assert.deepEqual(idsValides([1, 2, 3]), [1, 2, 3]);
  assert.equal(idsValides([]), null);
  assert.equal(idsValides([1, '2) OR 1=1 --']), null);
  assert.equal(idsValides([0]), null);
  assert.equal(idsValides('1,2'), null);
});

test('valide refuse un uid ou un sid vide', () => {
  assert.equal(valide({ type: 'ouvre', sid: '', uid: 'b' }, ''), null);
  assert.equal(valide({ type: 'ouvre', sid: 'a', uid: '' }, ''), null);
});
