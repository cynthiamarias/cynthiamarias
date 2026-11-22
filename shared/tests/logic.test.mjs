import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVisible, matches, pool, pick, pushRecent, dots, NO_FILTERS } from '../../potterychallenges/logic.js';

const mk = (id, over = {}) => ({ id, category: 'functional-forms', difficulty: 3, timeBand: 'weekend', firing: 'electric-cone5', seasons: ['any'], ...over });

test('everything normal is visible by default; raku is on, other outside firings are hidden', () => {
  assert.equal(isVisible(mk('a')), true);
  assert.equal(isVisible(mk('a', { firing: 'bisque-only' })), true);
  assert.equal(isVisible(mk('a', { firing: 'none' })), true);
  assert.equal(isVisible(mk('a', { firing: 'raku' })), true);
  for (const f of ['pit', 'obvara', 'smoke']) assert.equal(isVisible(mk('a', { firing: f })), false, f);
});

test('turning an outside firing on in the profile reveals it', () => {
  const profile = { firingsAvailable: ['raku', 'obvara'] };
  assert.equal(isVisible(mk('a', { firing: 'obvara' }), profile), true);
  assert.equal(isVisible(mk('a', { firing: 'pit' }), profile), false);
});

test('an explicit empty list hides even raku (it is a real choice, not a default)', () => {
  assert.equal(isVisible(mk('a', { firing: 'raku' }), { firingsAvailable: [] }), false);
});

test('from-scratch glaze chemistry stays hidden until the profile allows it', () => {
  const c = mk('a', { category: 'glaze-chemistry' });
  assert.equal(isVisible(c), false);
  assert.equal(isVisible(c, { mixesOwnGlazes: true }), true);
});

test('filters combine, and "any" means no restriction', () => {
  const c = mk('a', { category: 'seasonal', difficulty: 2, timeBand: 'one-session', seasons: ['christmas', 'winter'] });
  assert.equal(matches(c, NO_FILTERS), true);
  assert.equal(matches(c, { ...NO_FILTERS, category: 'seasonal' }), true);
  assert.equal(matches(c, { ...NO_FILTERS, category: 'slab-work' }), false);
  assert.equal(matches(c, { ...NO_FILTERS, difficulty: '2' }), true);
  assert.equal(matches(c, { ...NO_FILTERS, difficulty: '3' }), false);
  assert.equal(matches(c, { ...NO_FILTERS, timeBand: 'weekend' }), false);
  assert.equal(matches(c, { ...NO_FILTERS, season: 'christmas' }), true);
  assert.equal(matches(c, { category: 'seasonal', difficulty: '2', timeBand: 'one-session', season: 'winter' }), true);
});

test('a season filter excludes all-year challenges and ones with no seasons field', () => {
  assert.equal(matches(mk('a', { seasons: ['any'] }), { ...NO_FILTERS, season: 'winter' }), false);
  assert.equal(matches(mk('a', { seasons: undefined }), { ...NO_FILTERS, season: 'winter' }), false);
  assert.equal(matches(mk('a', { seasons: undefined }), NO_FILTERS), true);
});

test('pool applies visibility and filters together', () => {
  const all = [mk('1'), mk('2', { firing: 'pit' }), mk('3', { difficulty: 5 }), mk('4', { firing: 'raku', difficulty: 5 })];
  assert.deepEqual(pool(all, {}, NO_FILTERS).map((c) => c.id), ['1', '3', '4']);
  assert.deepEqual(pool(all, {}, { ...NO_FILTERS, difficulty: '5' }).map((c) => c.id), ['3', '4']);
  assert.deepEqual(pool(all, { firingsAvailable: ['raku', 'pit'] }, NO_FILTERS).map((c) => c.id), ['1', '2', '3', '4']);
});

test('pick: nothing to pick gives null', () => {
  assert.equal(pick([]), null);
});

test('pick: avoids recent ones while there are others', () => {
  const c = [mk('1'), mk('2'), mk('3')];
  for (let i = 0; i < 50; i++) assert.notEqual(pick(c, ['1', '2'], Math.random).id, '1');
  for (let i = 0; i < 50; i++) assert.equal(pick(c, ['1', '2'], Math.random).id, '3');
});

test('pick: when everything is recent it still returns something', () => {
  const c = [mk('1'), mk('2')];
  assert.ok(['1', '2'].includes(pick(c, ['1', '2']).id));
  assert.equal(pick([mk('only')], ['only']).id, 'only');
});

test('pick: handles the extreme random values without running off the end', () => {
  const c = [mk('1'), mk('2'), mk('3')];
  assert.equal(pick(c, [], () => 0).id, '1');
  assert.equal(pick(c, [], () => 0.999999).id, '3');
  assert.equal(pick(c, [], () => 1).id, '3');
});

test('pick is roughly uniform', () => {
  const c = [mk('1'), mk('2'), mk('3'), mk('4')];
  const seen = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < 4000; i++) seen[pick(c).id]++;
  for (const n of Object.values(seen)) assert.ok(n > 800 && n < 1200, JSON.stringify(seen));
});

test('pushRecent keeps the last five, moves repeats to the end, never duplicates', () => {
  let r = [];
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) r = pushRecent(r, id);
  assert.deepEqual(r, ['c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
});

test('dots', () => {
  assert.equal(dots(1), '●○○○○');
  assert.equal(dots(5), '●●●●●');
});
