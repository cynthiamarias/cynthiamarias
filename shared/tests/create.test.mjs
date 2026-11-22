import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from '../../potterychallenges/create.js';

const err = (code, message) => Object.assign(new Error(message), { code });

test('the messages our own function writes are shown as they are', () => {
  assert.equal(friendlyError(err('functions/resource-exhausted', "You have used today's 5 challenges. It resets tomorrow.")), "You have used today's 5 challenges. It resets tomorrow.");
  assert.equal(friendlyError(err('functions/failed-precondition', "I couldn't make that one safely. Try describing it a little differently.")), "I couldn't make that one safely. Try describing it a little differently.");
  assert.equal(friendlyError(err('functions/permission-denied', "You're not on the list for this app.")), "You're not on the list for this app.");
  assert.equal(friendlyError(err('functions/unavailable', 'Claude is busy right now. Try again in a minute.')), 'Claude is busy right now. Try again in a minute.');
});

test('a function that has not been deployed yet is explained plainly', () => {
  assert.match(friendlyError(err('functions/not-found', 'not found')), /not switched on yet/);
  assert.match(friendlyError(err('functions/unimplemented', 'x')), /not switched on yet/);
});

test('sign-in, timeout and connection problems each get their own wording', () => {
  assert.match(friendlyError(err('functions/unauthenticated', 'x')), /sign in/i);
  assert.match(friendlyError(err('functions/deadline-exceeded', 'x')), /too long/);
  assert.match(friendlyError(err('functions/unavailable', '')), /connection/);
});

test('anything unknown or empty still produces a usable sentence, never "undefined"', () => {
  for (const e of [undefined, null, {}, new Error(''), err('functions/internal', 'internal'), err('weird', undefined)]) {
    const m = friendlyError(e);
    assert.equal(typeof m, 'string');
    assert.ok(m.length > 10, String(m));
    assert.ok(!m.includes('undefined'));
  }
  assert.equal(friendlyError(err('functions/internal', 'The server is not set up to reach Claude yet.')), 'The server is not set up to reach Claude yet.');
});
