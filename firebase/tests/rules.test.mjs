// Security rules tests. They run against the local emulator, never the real project.
// Run: firebase emulators:exec --only firestore,storage --project demo-potterychallenges \
//        "node --test firebase/tests/rules.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, runTransaction,
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const rules = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
let env;

const ME = { uid: 'uid-me', email: 'me@example.com' };
const ADMIN = { uid: 'uid-admin', email: 'admin@example.com' };
const OTHER = { uid: 'uid-other', email: 'other@example.com' };
const STRANGER = { uid: 'uid-stranger', email: 'stranger@example.com' }; // signed in, not on the list

const as = (u, extra = {}) => env.authenticatedContext(u.uid, { email: u.email, email_verified: true, ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-potterychallenges',
    firestore: { rules: rules('firestore.rules') },
    storage: { rules: rules('storage.rules') },
  });
});
after(async () => { await env.cleanup(); });

// Fresh seed data before every test, written with rules disabled.
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'allowlist/me@example.com'), { role: 'member' });
    await setDoc(doc(db, 'allowlist/other@example.com'), { role: 'member' });
    await setDoc(doc(db, 'allowlist/admin@example.com'), { role: 'admin' });
    await setDoc(doc(db, 'config/app'), { remixEnabled: true });
    await setDoc(doc(db, 'meta/counters'), { nextChallengeNumber: 3 });
    await setDoc(doc(db, 'challenges/c1'), { status: 'approved', number: 1, content: { title: 'One' } });
    await setDoc(doc(db, 'challenges/c2'), { status: 'pending', content: { title: 'Two' } });
    await setDoc(doc(db, 'users/uid-me'), { displayName: 'Me' });
    await setDoc(doc(db, 'users/uid-other'), { displayName: 'Other' });
    await setDoc(doc(db, 'users/uid-me/remixes/r1'), { title: 'A remix' });
    await setDoc(doc(db, 'users/uid-me/events/e1'), { type: 'drawn' });
    await setDoc(doc(db, 'users/uid-me/projects/p1'), { stage: 'planned' });
    await setDoc(doc(db, 'usage/uid-me/days/2026-11-22'), { calls: 1 });
    await setDoc(doc(db, 'usageGlobal/2026-11'), { costUsd: 0.1 });
    await setDoc(doc(db, 'publicChallenges/1'), { title: 'One' });
    await setDoc(doc(db, 'publicPhotos/ph1'), { challengeNumber: 1 });
  });
});

const db = (u) => as(u).firestore();

// ---------- who gets in at all ----------
test('a signed-out visitor can read nothing private', async () => {
  const anon = env.unauthenticatedContext().firestore();
  for (const p of ['challenges/c1', 'allowlist/me@example.com', 'users/uid-me', 'config/app', 'meta/counters', 'usage/uid-me/days/2026-11-22']) {
    await assertFails(getDoc(doc(anon, p)));
  }
  await assertFails(getDocs(query(collection(anon, 'challenges'), where('status', '==', 'approved'))));
});

test('a Google user who is NOT on the allowlist is locked out of everything', async () => {
  const d = db(STRANGER);
  for (const p of ['challenges/c1', 'config/app', 'users/uid-stranger', 'allowlist/me@example.com']) {
    await assertFails(getDoc(doc(d, p)));
  }
  await assertFails(setDoc(doc(d, 'users/uid-stranger'), { displayName: 'x' }));
  await assertFails(setDoc(doc(d, 'allowlist/stranger@example.com'), { role: 'admin' }));
});

test('an allowlisted email that Google has not verified is locked out', async () => {
  const d = as(ME, { email_verified: false }).firestore();
  await assertFails(getDoc(doc(d, 'challenges/c1')));
  await assertFails(getDoc(doc(d, 'users/uid-me')));
});

test('allowlist lookup ignores email capitalization', async () => {
  const d = as({ uid: 'uid-me', email: 'Me@Example.COM' }).firestore();
  await assertSucceeds(getDoc(doc(d, 'challenges/c1')));
});

test('removing someone from the allowlist locks them out immediately', async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'allowlist/me@example.com')));
  await assertFails(getDoc(doc(db(ME), 'challenges/c1')));
  await assertFails(getDoc(doc(db(ME), 'users/uid-me')));
});

// ---------- allowlist and config ----------
test('a member can read only their own allowlist entry and cannot change it', async () => {
  const d = db(ME);
  await assertSucceeds(getDoc(doc(d, 'allowlist/me@example.com')));
  await assertFails(getDoc(doc(d, 'allowlist/other@example.com')));
  await assertFails(updateDoc(doc(d, 'allowlist/me@example.com'), { role: 'admin' }));
  await assertFails(setDoc(doc(d, 'allowlist/new@example.com'), { role: 'member' }));
});

test('an admin can add and remove people', async () => {
  const d = db(ADMIN);
  await assertSucceeds(setDoc(doc(d, 'allowlist/new@example.com'), { role: 'member' }));
  await assertSucceeds(deleteDoc(doc(d, 'allowlist/new@example.com')));
});

test('config is readable by members and writable only by admins', async () => {
  await assertSucceeds(getDoc(doc(db(ME), 'config/app')));
  await assertFails(updateDoc(doc(db(ME), 'config/app'), { remixEnabled: false }));
  await assertSucceeds(updateDoc(doc(db(ADMIN), 'config/app'), { remixEnabled: false }));
});

test('the challenge number counter is admin only', async () => {
  await assertFails(getDoc(doc(db(ME), 'meta/counters')));
  await assertSucceeds(updateDoc(doc(db(ADMIN), 'meta/counters'), { nextChallengeNumber: 4 }));
});

// ---------- challenge library ----------
test('members read approved challenges only, never pending ones', async () => {
  const d = db(ME);
  await assertSucceeds(getDoc(doc(d, 'challenges/c1')));
  await assertFails(getDoc(doc(d, 'challenges/c2')));
  await assertSucceeds(getDocs(query(collection(d, 'challenges'), where('status', '==', 'approved'))));
  await assertFails(getDocs(collection(d, 'challenges'))); // an unfiltered list would expose pending ones
});

test('members cannot create, edit or delete challenges', async () => {
  const d = db(ME);
  await assertFails(setDoc(doc(d, 'challenges/new'), { status: 'approved' }));
  await assertFails(updateDoc(doc(d, 'challenges/c1'), { status: 'retired' }));
  await assertFails(deleteDoc(doc(d, 'challenges/c1')));
});

test('an admin reads pending challenges and approves them, but cannot create or delete from the app', async () => {
  const d = db(ADMIN);
  await assertSucceeds(getDoc(doc(d, 'challenges/c2')));
  await assertSucceeds(updateDoc(doc(d, 'challenges/c2'), { status: 'approved', number: 2 }));
  await assertFails(setDoc(doc(d, 'challenges/new'), { status: 'pending' }));
  await assertFails(deleteDoc(doc(d, 'challenges/c1')));
});

// ---------- personal data ----------
test('a member reads and writes their own data and nobody else\'s', async () => {
  const d = db(ME);
  await assertSucceeds(getDoc(doc(d, 'users/uid-me')));
  await assertSucceeds(setDoc(doc(d, 'users/uid-me/challengeState/c1'), { favorite: true }));
  await assertSucceeds(setDoc(doc(d, 'users/uid-me/kilnBatches/k1'), { name: 'Bisque 1' }));
  await assertFails(getDoc(doc(d, 'users/uid-other')));
  await assertFails(setDoc(doc(d, 'users/uid-other/challengeState/c1'), { favorite: true }));
  await assertFails(getDoc(doc(d, 'users/uid-other/projects/p1')));
});

test('even an admin cannot read another person\'s personal data', async () => {
  await assertFails(getDoc(doc(db(ADMIN), 'users/uid-me')));
  await assertFails(getDoc(doc(db(ADMIN), 'users/uid-me/projects/p1')));
});

test('projects accept the eight real stages and reject anything else', async () => {
  const d = db(ME);
  for (const stage of ['planned', 'made', 'drying', 'bisque-ready', 'bisque-fired', 'glazed', 'glaze-fired', 'done']) {
    await assertSucceeds(setDoc(doc(d, `users/uid-me/projects/s-${stage}`), { stage }));
  }
  await assertFails(setDoc(doc(d, 'users/uid-me/projects/bad'), { stage: 'abandoned' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/projects/p1'), { stage: 'whatever' }));
  await assertFails(setDoc(doc(d, 'users/uid-me/projects/long'), { stage: 'planned', notes: 'x'.repeat(4001) }));
  await assertSucceeds(deleteDoc(doc(d, 'users/uid-me/projects/p1')));
});

test('the activity log is add-only', async () => {
  const d = db(ME);
  await assertSucceeds(getDoc(doc(d, 'users/uid-me/events/e1')));
  await assertSucceeds(setDoc(doc(d, 'users/uid-me/events/e2'), { type: 'completed' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/events/e1'), { type: 'edited' }));
  await assertFails(deleteDoc(doc(d, 'users/uid-me/events/e1')));
  await assertFails(setDoc(doc(db(OTHER), 'users/uid-me/events/e3'), { type: 'forged' }));
});

test('saved remixes can be read and deleted by their owner but never written by the app', async () => {
  const d = db(ME);
  await assertSucceeds(getDoc(doc(d, 'users/uid-me/remixes/r1')));
  await assertFails(setDoc(doc(d, 'users/uid-me/remixes/r2'), { title: 'forged' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/r1'), { title: 'edited' }));
  await assertSucceeds(deleteDoc(doc(d, 'users/uid-me/remixes/r1')));
});

test('photo records must be private in the MVP', async () => {
  const d = db(ME);
  await assertSucceeds(setDoc(doc(d, 'users/uid-me/photos/ph1'), { visibility: 'private' }));
  await assertFails(setDoc(doc(d, 'users/uid-me/photos/ph2'), { visibility: 'public' }));
  await assertFails(setDoc(doc(d, 'users/uid-me/photos/ph3'), { caption: 'no visibility field' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/photos/ph1'), { visibility: 'public' }));
});

// ---------- usage counters ----------
test('usage counters are read-only for their owner and invisible to everyone else', async () => {
  await assertSucceeds(getDoc(doc(db(ME), 'usage/uid-me/days/2026-11-22')));
  await assertFails(setDoc(doc(db(ME), 'usage/uid-me/days/2026-11-22'), { calls: 0 }));
  await assertFails(getDoc(doc(db(OTHER), 'usage/uid-me/days/2026-11-22')));
  await assertFails(getDoc(doc(db(ME), 'usageGlobal/2026-11')));
  await assertSucceeds(getDoc(doc(db(ADMIN), 'usageGlobal/2026-11')));
  await assertFails(setDoc(doc(db(ADMIN), 'usageGlobal/2026-11'), { costUsd: 0 }));
});

// ---------- public sharing projections ----------
test('public share projections are readable by anyone and writable by no one', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, 'publicChallenges/1')));
  await assertSucceeds(getDoc(doc(anon, 'publicPhotos/ph1')));
  await assertFails(setDoc(doc(anon, 'publicChallenges/2'), { title: 'x' }));
  await assertFails(setDoc(doc(db(ADMIN), 'publicPhotos/ph2'), { challengeNumber: 1 }));
});

test('any collection not listed in the rules is closed, even to admins', async () => {
  await assertFails(setDoc(doc(db(ADMIN), 'surprise/doc'), { a: 1 }));
  await assertFails(getDoc(doc(db(ADMIN), 'surprise/doc')));
});

// ---------- Storage ----------
const jpeg = (bytes = 100) => new Uint8Array(bytes);
const photoPath = (uid, file = 'full.jpg') => `users/${uid}/photos/ph1/${file}`;
const put = (u, path, data, contentType = 'image/jpeg') =>
  uploadBytes(ref(as(u).storage(), path), data, { contentType });

test('storage: a member uploads, reads and deletes their own jpeg photos', async () => {
  await assertSucceeds(put(ME, photoPath('uid-me'), jpeg()));
  await assertSucceeds(put(ME, photoPath('uid-me', 'thumb.jpg'), jpeg()));
  await assertSucceeds(getBytes(ref(as(ME).storage(), photoPath('uid-me'))));
  await assertSucceeds(deleteObject(ref(as(ME).storage(), photoPath('uid-me'))));
});

test('storage: wrong type, oversized file or odd filename is rejected', async () => {
  await assertFails(put(ME, photoPath('uid-me'), jpeg(), 'image/png'));
  await assertFails(put(ME, photoPath('uid-me'), jpeg(4 * 1024 * 1024 + 1)));
  await assertFails(put(ME, photoPath('uid-me', 'exploit.html'), jpeg()));
});

test('storage: nobody can read or write another person\'s photos', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    uploadBytes(ref(ctx.storage(), photoPath('uid-me')), jpeg(), { contentType: 'image/jpeg' }));
  await assertFails(getBytes(ref(as(OTHER).storage(), photoPath('uid-me'))));
  await assertFails(put(OTHER, photoPath('uid-me', 'thumb.jpg'), jpeg()));
  await assertFails(deleteObject(ref(as(ADMIN).storage(), photoPath('uid-me'))));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), photoPath('uid-me'))));
});

test('storage: someone not on the allowlist cannot upload even to their own path', async () => {
  await assertFails(put(STRANGER, photoPath('uid-stranger'), jpeg()));
  await assertFails(uploadBytes(ref(as(ME, { email_verified: false }).storage(), photoPath('uid-me')), jpeg(), { contentType: 'image/jpeg' }));
});

test('storage: public/ is readable by anyone and writable by no one', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    uploadBytes(ref(ctx.storage(), 'public/photos/ph1/full.jpg'), jpeg(), { contentType: 'image/jpeg' }));
  await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(), 'public/photos/ph1/full.jpg')));
  await assertFails(put(ADMIN, 'public/photos/ph2/full.jpg', jpeg()));
  await assertFails(put(ME, 'elsewhere/file.jpg', jpeg()));
});

// ---------- the review screen's approve transaction (same logic as potterychallenges/review.js) ----------
const approve = (d, id) => runTransaction(d, async (tx) => {
  const ref = doc(d, 'challenges', id);
  const cur = await tx.get(ref);
  if (!cur.exists() || cur.data().status !== 'pending') throw new Error('not pending');
  const counterRef = doc(d, 'meta', 'counters');
  const counter = await tx.get(counterRef);
  const n = counter.exists() ? counter.data().nextChallengeNumber : 1;
  tx.set(counterRef, { nextChallengeNumber: n + 1 });
  tx.update(ref, { status: 'approved', number: n });
  return n;
});

test('review: an admin approving challenges gets sequential numbers from the counter', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'challenges/c3'), { status: 'pending', content: {} }));
  const d = db(ADMIN);
  const a = await assertSucceeds(approve(d, 'c2'));
  const b = await assertSucceeds(approve(d, 'c3'));
  if (a !== 3 || b !== 4) throw new Error(`expected 3 then 4, got ${a} then ${b}`);
  let next;
  await env.withSecurityRulesDisabled(async (ctx) => { next = (await getDoc(doc(ctx.firestore(), 'meta/counters'))).data().nextChallengeNumber; });
  if (next !== 5) throw new Error(`counter should be 5, got ${next}`);
});

test('review: the first approval starts numbering at 1 when no counter exists yet', async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'meta/counters')));
  const n = await assertSucceeds(approve(db(ADMIN), 'c2'));
  if (n !== 1) throw new Error(`expected 1, got ${n}`);
});

test('review: an already-approved challenge cannot be approved again', async () => {
  // c1 is approved in the seed data: the transaction itself must refuse, before changing anything.
  await assert.rejects(approve(db(ADMIN), 'c1'), /not pending/);
  let next;
  await env.withSecurityRulesDisabled(async (ctx) => { next = (await getDoc(doc(ctx.firestore(), 'meta/counters'))).data().nextChallengeNumber; });
  if (next !== 3) throw new Error(`counter must not move, got ${next}`);
});

test('review: a member cannot approve or reject', async () => {
  await assertFails(approve(db(ME), 'c2'));
  await assertFails(updateDoc(doc(db(ME), 'challenges/c2'), { status: 'rejected' }));
});

test('review: an admin can list pending challenges; a member cannot', async () => {
  await assertSucceeds(getDocs(query(collection(db(ADMIN), 'challenges'), where('status', '==', 'pending'))));
  await assertFails(getDocs(query(collection(db(ME), 'challenges'), where('status', '==', 'pending'))));
});
