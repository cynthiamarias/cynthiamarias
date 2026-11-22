// Loads the approved library and this person's own state, and saves favorites, draws and settings.
// Everything is scoped to users/{uid}; the Firestore rules enforce that, not this file.
import { collection, query, where, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp, increment }
  from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { pool as buildPool } from './logic.js';

export function createData(db, uid) {
  let challenges = [];
  let states = new Map();   // challengeId -> { favorite, timesDrawn, lastDrawnAt }
  let profile = {};         // users/{uid}: { firingsAvailable, mixesOwnGlazes, ... }

  const stateRef = (id) => doc(db, 'users', uid, 'challengeState', id);
  const log = (type, c, extra = {}) =>
    addDoc(collection(db, 'users', uid, 'events'), { type, at: serverTimestamp(), challengeId: c.id, number: c.number ?? null, ...extra });

  async function load() {
    // Members can only read approved challenges, so the query has to say so.
    const [cs, ss, ps] = await Promise.all([
      getDocs(query(collection(db, 'challenges'), where('status', '==', 'approved'))),
      getDocs(collection(db, 'users', uid, 'challengeState')),
      getDoc(doc(db, 'users', uid)),
    ]);
    challenges = cs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
    states = new Map(ss.docs.map((d) => [d.id, d.data()]));
    profile = ps.exists() ? ps.data() : {};
  }

  return {
    load,
    all: () => challenges,
    byId: (id) => challenges.find((c) => c.id === id) ?? null,
    profile: () => profile,
    visiblePool: (filters) => buildPool(challenges, profile, filters),
    isFavorite: (id) => Boolean(states.get(id)?.favorite),

    async toggleFavorite(c) {
      const next = !states.get(c.id)?.favorite;
      await setDoc(stateRef(c.id), { favorite: next, favoritedAt: next ? serverTimestamp() : null }, { merge: true });
      states.set(c.id, { ...(states.get(c.id) ?? {}), favorite: next });
      log(next ? 'favorited' : 'unfavorited', c).catch(() => {}); // the log must never block the tap
      return next;
    },

    async recordDraw(c) {
      await setDoc(stateRef(c.id), { timesDrawn: increment(1), lastDrawnAt: serverTimestamp() }, { merge: true });
      const prev = states.get(c.id) ?? {};
      states.set(c.id, { ...prev, timesDrawn: (prev.timesDrawn ?? 0) + 1 });
      log('drawn', c).catch(() => {});
    },

    async setFirings(list) {
      await setDoc(doc(db, 'users', uid), { firingsAvailable: list }, { merge: true });
      profile = { ...profile, firingsAvailable: list };
    },
  };
}
