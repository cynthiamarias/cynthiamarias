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
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, runTransaction, addDoc, serverTimestamp, increment, writeBatch, Timestamp,
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

// ---------- the exact operations potterychallenges/data.js performs ----------
test('data layer: a member can load the library and their own state', async () => {
  const d = db(ME);
  await assertSucceeds(getDocs(query(collection(d, 'challenges'), where('status', '==', 'approved'))));
  await assertSucceeds(getDocs(collection(d, 'users/uid-me/challengeState')));
  await assertSucceeds(getDoc(doc(d, 'users/uid-me'))); // may not exist yet: still allowed
});

test('data layer: favorite, draw count, activity log and firing settings all save', async () => {
  const d = db(ME);
  await assertSucceeds(setDoc(doc(d, 'users/uid-me/challengeState/c1'), { favorite: true, favoritedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(d, 'users/uid-me/challengeState/c1'), { favorite: false, favoritedAt: null }, { merge: true }));
  await assertSucceeds(setDoc(doc(d, 'users/uid-me/challengeState/c1'), { timesDrawn: increment(1), lastDrawnAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(addDoc(collection(d, 'users/uid-me/events'), { type: 'drawn', at: serverTimestamp(), challengeId: 'c1', number: 1 }));
  await assertSucceeds(setDoc(doc(d, 'users/uid-me'), { firingsAvailable: ['raku', 'pit'] }, { merge: true }));
});

test('data layer: nobody can write favorites, events or settings into someone else\'s space', async () => {
  const d = db(OTHER);
  await assertFails(setDoc(doc(d, 'users/uid-me/challengeState/c1'), { favorite: true }, { merge: true }));
  await assertFails(addDoc(collection(d, 'users/uid-me/events'), { type: 'drawn' }));
  await assertFails(setDoc(doc(d, 'users/uid-me'), { firingsAvailable: [] }, { merge: true }));
  await assertFails(getDocs(collection(d, 'users/uid-me/challengeState')));
});

// ---------- "Approve all" (same logic as approveAll in potterychallenges/review.js) ----------
const approveAll = (d, ids) => runTransaction(d, async (tx) => {
  const counterRef = doc(d, 'meta', 'counters');
  const counter = await tx.get(counterRef);
  const snaps = await Promise.all(ids.map((id) => tx.get(doc(d, 'challenges', id))));
  let n = counter.exists() ? counter.data().nextChallengeNumber : 1;
  const start = n;
  for (const s of snaps) {
    if (s.exists() && s.data().status === 'pending') tx.update(s.ref, { status: 'approved', number: n++ });
  }
  tx.set(counterRef, { nextChallengeNumber: n });
  return { start, end: n - 1 };
});

test('approve all: numbers a whole batch in order, skips already-approved ones, and members can then read them', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    // Seed data: c1 is approved as #1 and the counter says the next number is 3, so c2 and the
    // four new ones should become 3 to 7.
    for (const id of ['p1', 'p2', 'p3', 'p4']) await setDoc(doc(d, `challenges/${id}`), { status: 'pending', content: {} });
  });
  // c1 is already approved in the seed data and c2 is pending, so five are pending and one is approved.
  const r = await assertSucceeds(approveAll(db(ADMIN), ['c1', 'c2', 'p1', 'p2', 'p3', 'p4']));
  assert.deepEqual(r, { start: 3, end: 7 });
  const numbers = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const id of ['c1', 'c2', 'p1', 'p2', 'p3', 'p4']) numbers[id] = (await getDoc(doc(ctx.firestore(), `challenges/${id}`))).data().number;
  });
  assert.equal(numbers.c1, 1, 'already-approved c1 keeps its number');
  assert.deepEqual([numbers.c2, numbers.p1, numbers.p2, numbers.p3, numbers.p4], [3, 4, 5, 6, 7]);
  const all = Object.values(numbers);
  assert.equal(new Set(all).size, all.length, 'no two challenges share a number');
  const seen = await assertSucceeds(getDocs(query(collection(db(ME), 'challenges'), where('status', '==', 'approved'))));
  assert.equal(seen.size, 6);
});

test('approve all: running it again with nothing pending changes no numbers', async () => {
  await assertSucceeds(approveAll(db(ADMIN), ['c2']));
  const again = await assertSucceeds(approveAll(db(ADMIN), ['c2']));
  assert.ok(again.end < again.start, 'nothing should be numbered the second time');
});

test('approve all: a member cannot do it', async () => {
  await assertFails(approveAll(db(ME), ['c2']));
});

// ---------- projects: the exact operations potterychallenges/data.js performs ----------
const newProj = (over = {}) => ({
  challengeId: 'c1', challengeNumber: 1, title: 'One', category: 'functional-forms',
  stage: 'planned', stageHistory: [{ stage: 'planned', at: Timestamp.now() }],
  queueOrder: 1, targetDate: null, occasion: null, notes: '', completedAt: null,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
});

test('projects: add to the queue, stage it through every stage, finish it, then remove it', async () => {
  const d = db(ME);
  const ref = doc(collection(d, 'users/uid-me/projects'));
  await assertSucceeds(setDoc(ref, newProj()));
  let history = [{ stage: 'planned', at: Timestamp.now() }];
  for (const stage of ['made', 'drying', 'bisque-ready', 'bisque-fired', 'glazed', 'glaze-fired', 'done']) {
    history = [...history, { stage, at: Timestamp.now() }];
    await assertSucceeds(updateDoc(ref, { stage, stageHistory: history, completedAt: stage === 'done' ? Timestamp.now() : null, updatedAt: serverTimestamp() }));
  }
  await assertSucceeds(updateDoc(ref, { notes: 'Glaze ran a little', occasion: 'Gift', targetDate: Timestamp.fromDate(new Date(2026, 11, 20, 12)), updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(ref));
});

test('projects: marking done without planning creates a finished project directly', async () => {
  await assertSucceeds(setDoc(doc(collection(db(ME), 'users/uid-me/projects')), newProj({ stage: 'done', stageHistory: [{ stage: 'done', at: Timestamp.now() }], completedAt: Timestamp.fromDate(new Date(2026, 10, 21, 12)), notes: 'First try' })));
});

test('projects: bad stages and over-long notes are refused on create and on update', async () => {
  const d = db(ME);
  await assertFails(setDoc(doc(collection(d, 'users/uid-me/projects')), newProj({ stage: 'cooling' })));
  await assertFails(setDoc(doc(collection(d, 'users/uid-me/projects')), newProj({ notes: 'x'.repeat(4001) })));
  await assertFails(updateDoc(doc(d, 'users/uid-me/projects/p1'), { stage: 'abandoned' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/projects/p1'), { notes: 'y'.repeat(4001) }));
});

test('projects: moving swaps two order values in one batch', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/uid-me/projects/p2'), { stage: 'planned', queueOrder: 2 });
  });
  const d = db(ME);
  const batch = writeBatch(d);
  batch.update(doc(d, 'users/uid-me/projects/p1'), { queueOrder: 2, updatedAt: serverTimestamp() });
  batch.update(doc(d, 'users/uid-me/projects/p2'), { queueOrder: 1, updatedAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
});

test('projects: the activity log accepts the new event types with their extra fields', async () => {
  const d = db(ME);
  for (const type of ['queued', 'stage', 'completed', 'removed']) {
    await assertSucceeds(addDoc(collection(d, 'users/uid-me/events'), { type, at: serverTimestamp(), challengeId: 'c1', number: 1, projectId: 'p1', from: 'planned', to: 'made' }));
  }
});

test('projects: nobody can read or touch someone else\'s projects, not even an admin', async () => {
  for (const u of [OTHER, ADMIN, STRANGER]) {
    const d = db(u);
    await assertFails(getDocs(collection(d, 'users/uid-me/projects')));
    await assertFails(getDoc(doc(d, 'users/uid-me/projects/p1')));
    await assertFails(setDoc(doc(collection(d, 'users/uid-me/projects')), newProj()));
    await assertFails(updateDoc(doc(d, 'users/uid-me/projects/p1'), { notes: 'x' }));
    await assertFails(deleteDoc(doc(d, 'users/uid-me/projects/p1')));
  }
  await assertSucceeds(getDocs(collection(db(ME), 'users/uid-me/projects')));
});

// ---------- photos: the exact Firestore operations potterychallenges/data.js performs ----------
const photoDoc = (over = {}) => ({
  projectId: 'p1', challengeId: 'c1', challengeNumber: 1, stage: 'made',
  storagePath: 'users/uid-me/photos/ph9/full.jpg', thumbPath: 'users/uid-me/photos/ph9/thumb.jpg',
  width: 2048, height: 1536, bytes: 800000, caption: '', visibility: 'private', createdAt: serverTimestamp(), ...over,
});

test('photos: a member saves a private photo record, lists a project\'s photos, bumps the count, and deletes it', async () => {
  const d = db(ME);
  const ref = doc(collection(d, 'users/uid-me/photos'));
  await assertSucceeds(setDoc(ref, photoDoc()));
  const mine = await assertSucceeds(getDocs(query(collection(d, 'users/uid-me/photos'), where('projectId', '==', 'p1'))));
  assert.ok(mine.size >= 1);
  await assertSucceeds(updateDoc(doc(d, 'users/uid-me/projects/p1'), { photoCount: 1, updatedAt: serverTimestamp() }));
  await assertSucceeds(addDoc(collection(d, 'users/uid-me/events'), { type: 'photo_added', at: serverTimestamp(), challengeId: 'c1', number: 1, projectId: 'p1', photoId: ref.id }));
  await assertSucceeds(deleteDoc(ref));
});

test('photos: a record that is not private is refused', async () => {
  const d = db(ME);
  await assertFails(setDoc(doc(collection(d, 'users/uid-me/photos')), photoDoc({ visibility: 'public' })));
  const noVisibility = photoDoc();
  delete noVisibility.visibility;
  await assertFails(setDoc(doc(collection(d, 'users/uid-me/photos')), noVisibility));
});

test('photos: nobody else can list, read, add or delete a member\'s photo records', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/uid-me/photos/ph1'), photoDoc()));
  for (const u of [OTHER, ADMIN, STRANGER]) {
    const d = db(u);
    await assertFails(getDocs(query(collection(d, 'users/uid-me/photos'), where('projectId', '==', 'p1'))));
    await assertFails(getDoc(doc(d, 'users/uid-me/photos/ph1')));
    await assertFails(setDoc(doc(collection(d, 'users/uid-me/photos')), photoDoc()));
    await assertFails(deleteDoc(doc(d, 'users/uid-me/photos/ph1')));
  }
});

test('photos: the full upload-and-delete path in Storage works for the owner and nobody else', async () => {
  const bytes = new Uint8Array(500);
  const path = (f) => `users/uid-me/photos/ph9/${f}`;
  for (const f of ['full.jpg', 'thumb.jpg']) await assertSucceeds(put(ME, path(f), bytes));
  await assertSucceeds(getBytes(ref(as(ME).storage(), path('thumb.jpg'))));
  await assertFails(getBytes(ref(as(OTHER).storage(), path('thumb.jpg'))));
  await assertFails(deleteObject(ref(as(ADMIN).storage(), path('full.jpg'))));
  for (const f of ['full.jpg', 'thumb.jpg']) await assertSucceeds(deleteObject(ref(as(ME).storage(), path(f))));
});

// ---------- drafts from Create and Remix ----------
const seedDraft = (id = 'd1', over = {}) => env.withSecurityRulesDisabled((ctx) =>
  setDoc(doc(ctx.firestore(), `users/uid-me/remixes/${id}`), { status: 'draft', source: 'created', content: { title: 'Made by function' }, category: 'functional-forms', ...over }));

test('drafts: the owner can keep a draft by changing only its status', async () => {
  await seedDraft();
  await assertSucceeds(updateDoc(doc(db(ME), 'users/uid-me/remixes/d1'), { status: 'saved', savedAt: serverTimestamp() }));
});

test('drafts: the content and every other field are locked, even while changing the status', async () => {
  await seedDraft();
  const d = db(ME);
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/d1'), { status: 'saved', content: { title: 'I rewrote it' } }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/d1'), { status: 'saved', category: 'sculpture-figurative' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/d1'), { status: 'saved', usage: { costUsd: 0 } }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/d1'), { content: { title: 'edit without status' } }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/d1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/d1'), { status: 'draft' }));
});

test('drafts: once saved, it cannot be edited at all, and cannot go back to a draft', async () => {
  await seedDraft('s1', { status: 'saved' });
  const d = db(ME);
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/s1'), { status: 'draft' }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/s1'), { content: { title: 'x' } }));
  await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/s1'), { status: 'saved', savedAt: serverTimestamp() }));
});

test('drafts: the app can never create one, and can delete its own (discard)', async () => {
  const d = db(ME);
  await assertFails(setDoc(doc(d, 'users/uid-me/remixes/forged'), { status: 'saved', content: { title: 'Forged, no safety checks' } }));
  await assertFails(setDoc(doc(d, 'users/uid-me/remixes/forged2'), { status: 'draft', content: { title: 'Forged' } }));
  await seedDraft('d2');
  await assertSucceeds(deleteDoc(doc(d, 'users/uid-me/remixes/d2')));
});

test('drafts: nobody else can read, keep, change or delete someone\'s drafts', async () => {
  await seedDraft('d3');
  for (const u of [OTHER, ADMIN, STRANGER]) {
    const d = db(u);
    await assertFails(getDoc(doc(d, 'users/uid-me/remixes/d3')));
    await assertFails(getDocs(query(collection(d, 'users/uid-me/remixes'), where('status', '==', 'saved'))));
    await assertFails(updateDoc(doc(d, 'users/uid-me/remixes/d3'), { status: 'saved' }));
    await assertFails(deleteDoc(doc(d, 'users/uid-me/remixes/d3')));
  }
  await assertSucceeds(getDocs(query(collection(db(ME), 'users/uid-me/remixes'), where('status', '==', 'saved'))));
});
