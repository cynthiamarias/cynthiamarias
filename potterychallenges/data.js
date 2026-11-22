// Loads the approved library and this person's own state, and saves favorites, draws,
// projects and settings. Everything is scoped to users/{uid}; the Firestore rules enforce
// that, not this file.
import { collection, query, where, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
  serverTimestamp, increment, Timestamp }
  from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject }
  from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import { pool as buildPool, queueOf, historyOf, findOpenFor, nextOrder, swapTarget, mineItem, docIdOfMine } from './logic.js?v=0.10';

export function createData(db, uid, storage) {
  let challenges = [];
  let states = new Map();   // challengeId -> { favorite, timesDrawn, lastDrawnAt }
  let projects = new Map(); // projectId -> project (see newProject below)
  let mine = [];            // challenges this person made with Create or Remix and kept (shaped like library ones)
  let profile = {};         // users/{uid}: { firingsAvailable, mixesOwnGlazes, ... }

  const stateRef = (id) => doc(db, 'users', uid, 'challengeState', id);
  const projectsCol = () => collection(db, 'users', uid, 'projects');
  const projectRef = (id) => doc(db, 'users', uid, 'projects', id);
  const log = (type, c, extra = {}) =>
    addDoc(collection(db, 'users', uid, 'events'), { type, at: serverTimestamp(), challengeId: c.id, number: c.number ?? null, ...extra });
  const logProject = (type, p, extra = {}) =>
    log(type, { id: p.challengeId, number: p.challengeNumber }, { projectId: p.id, ...extra }).catch(() => {}); // the log must never block a tap
  const allProjects = () => [...projects.values()];
  const remixesCol = () => collection(db, 'users', uid, 'remixes');

  async function load() {
    // Members can only read approved challenges, so the query has to say so.
    const [cs, ss, ps, pj, ms, ds] = await Promise.all([
      getDocs(query(collection(db, 'challenges'), where('status', '==', 'approved'))),
      getDocs(collection(db, 'users', uid, 'challengeState')),
      getDoc(doc(db, 'users', uid)),
      getDocs(projectsCol()),
      getDocs(query(remixesCol(), where('status', '==', 'saved'))),
      getDocs(query(remixesCol(), where('status', '==', 'draft'))),
    ]);
    // Previews that were never saved or discarded are tidied away on the next visit.
    ds.docs.forEach((d) => deleteDoc(d.ref).catch(() => {}));
    mine = ms.docs.map((d) => mineItem(d.id, d.data())).sort((a, b) => (b.savedAt?.toMillis?.() ?? 0) - (a.savedAt?.toMillis?.() ?? 0));
    challenges = cs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
    states = new Map(ss.docs.map((d) => [d.id, d.data()]));
    profile = ps.exists() ? ps.data() : {};
    projects = new Map(pj.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  }

  // A brand-new project, as stored. Snapshots of the title and category keep history readable
  // even if the challenge is ever retired.
  const newProject = (c, stage, fields = {}) => ({
    challengeId: c.id, challengeNumber: c.number ?? null, title: c.content.title, category: c.category,
    stage, stageHistory: [{ stage, at: Timestamp.now() }],
    queueOrder: nextOrder(allProjects()), targetDate: null, occasion: null, notes: '', completedAt: null,
    ...fields,
  });

  async function save(id, patch) {
    await updateDoc(projectRef(id), { ...patch, updatedAt: serverTimestamp() });
    projects.set(id, { ...projects.get(id), ...patch });
    return projects.get(id);
  }

  return {
    load,
    all: () => challenges,
    byId: (id) => challenges.find((c) => c.id === id) ?? mine.find((c) => c.id === id) ?? null,
    profile: () => profile,
    // Draw and the Library list draw from the shared library, plus your own if you have chosen to include them.
    visiblePool: (filters) => buildPool(profile.includeMine ? [...challenges, ...mine] : challenges, profile, filters),
    mine: () => mine,
    visibleMine: (filters) => buildPool(mine, profile, filters),
    isFavorite: (id) => Boolean(states.get(id)?.favorite),

    async toggleFavorite(c) {
      const next = !states.get(c.id)?.favorite;
      await setDoc(stateRef(c.id), { favorite: next, favoritedAt: next ? serverTimestamp() : null }, { merge: true });
      states.set(c.id, { ...(states.get(c.id) ?? {}), favorite: next });
      log(next ? 'favorited' : 'unfavorited', c).catch(() => {});
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

    // ---------- challenges made with Create and Remix ----------
    // The Cloud Function writes a draft; these keep it (status saved), throw it away, or delete a kept one.
    async keepDraft(draftId) {
      await updateDoc(doc(db, 'users', uid, 'remixes', draftId), { status: 'saved', savedAt: serverTimestamp() });
      const snap = await getDoc(doc(db, 'users', uid, 'remixes', draftId));
      const item = mineItem(draftId, snap.data());
      mine = [item, ...mine.filter((m) => m.docId !== draftId)];
      return item;
    },
    discardDraft: (draftId) => deleteDoc(doc(db, 'users', uid, 'remixes', draftId)),
    async deleteMine(item) {
      await deleteDoc(doc(db, 'users', uid, 'remixes', docIdOfMine(item.id)));
      mine = mine.filter((m) => m.id !== item.id);
    },
    async setIncludeMine(on) {
      await setDoc(doc(db, 'users', uid), { includeMine: on }, { merge: true });
      profile = { ...profile, includeMine: on };
    },

    // ---------- projects ----------
    projects: allProjects,
    projectById: (id) => projects.get(id) ?? null,
    queue: () => queueOf(allProjects()),
    history: () => historyOf(allProjects()),
    openFor: (challengeId) => findOpenFor(allProjects(), challengeId),

    // Put a challenge in the up-next queue. If it is already queued, return that one.
    async addToQueue(c) {
      const existing = findOpenFor(allProjects(), c.id);
      if (existing) return { project: existing, created: false };
      const ref = doc(projectsCol());
      const p = newProject(c, 'planned');
      await setDoc(ref, { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      const project = { id: ref.id, ...p };
      projects.set(ref.id, project);
      logProject('queued', project);
      return { project, created: true };
    },

    // Record a finished piece. If one is already in progress it is finished, otherwise a new
    // finished project is created, so "mark done" works with or without planning ahead.
    async markDone(c, { date, notes }) {
      const when = Timestamp.fromDate(date);
      const open = findOpenFor(allProjects(), c.id);
      if (open) {
        const merged = notes ? (open.notes ? `${open.notes}\n${notes}` : notes) : open.notes;
        const p = await save(open.id, { stage: 'done', stageHistory: [...open.stageHistory, { stage: 'done', at: Timestamp.now() }], completedAt: when, notes: merged });
        logProject('completed', p);
        return p;
      }
      const ref = doc(projectsCol());
      const p = newProject(c, 'done', { notes: notes ?? '', completedAt: when });
      await setDoc(ref, { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      const project = { id: ref.id, ...p };
      projects.set(ref.id, project);
      logProject('completed', project);
      return project;
    },

    async setStage(p, stage) {
      if (p.stage === stage) return p;
      const history = [...(p.stageHistory ?? []), { stage, at: Timestamp.now() }];
      const updated = await save(p.id, { stage, stageHistory: history, completedAt: stage === 'done' ? (p.completedAt ?? Timestamp.now()) : null });
      logProject('stage', updated, { from: p.stage, to: stage });
      if (stage === 'done') logProject('completed', updated);
      return updated;
    },

    updateFields: (p, fields) => save(p.id, fields),

    // Move one place up (-1) or down (+1) in the queue by swapping order values with the neighbour.
    async move(p, dir) {
      const other = swapTarget(queueOf(allProjects()), p.id, dir);
      if (!other) return false;
      const batch = writeBatch(db);
      batch.update(projectRef(p.id), { queueOrder: other.queueOrder, updatedAt: serverTimestamp() });
      batch.update(projectRef(other.id), { queueOrder: p.queueOrder, updatedAt: serverTimestamp() });
      await batch.commit();
      projects.set(p.id, { ...p, queueOrder: other.queueOrder });
      projects.set(other.id, { ...other, queueOrder: p.queueOrder });
      return true;
    },

    async remove(p) {
      // Take the photos with it, so no orphaned files are left behind in Storage.
      for (const ph of await this.photosFor(p.id)) await this.deletePhoto(ph, { keepCount: true }).catch(() => {});
      await deleteDoc(projectRef(p.id));
      projects.delete(p.id);
      logProject('removed', p);
    },

    // ---------- photos (private; files live in Storage under users/{uid}/photos/{photoId}/) ----------
    async photosFor(projectId) {
      const snap = await getDocs(query(collection(db, 'users', uid, 'photos'), where('projectId', '==', projectId)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
    },

    thumbUrl: (ph) => getDownloadURL(storageRef(storage, ph.thumbPath)),
    fullUrl: (ph) => getDownloadURL(storageRef(storage, ph.storagePath)),

    async addPhoto(p, { full, thumb }) {
      const photoRef = doc(collection(db, 'users', uid, 'photos'));
      const base = `users/${uid}/photos/${photoRef.id}`;
      const fullRef = storageRef(storage, `${base}/full.jpg`);
      const thumbRef = storageRef(storage, `${base}/thumb.jpg`);
      try {
        await uploadBytes(fullRef, full.blob, { contentType: 'image/jpeg' });
        await uploadBytes(thumbRef, thumb.blob, { contentType: 'image/jpeg' });
        await setDoc(photoRef, {
          projectId: p.id, challengeId: p.challengeId, challengeNumber: p.challengeNumber ?? null, stage: p.stage,
          storagePath: `${base}/full.jpg`, thumbPath: `${base}/thumb.jpg`, width: full.width, height: full.height,
          bytes: full.blob.size, caption: '', visibility: 'private', createdAt: serverTimestamp(),
        });
      } catch (e) {
        // Don't leave half an upload behind.
        await Promise.allSettled([deleteObject(fullRef), deleteObject(thumbRef)]);
        throw e;
      }
      const count = (projects.get(p.id)?.photoCount ?? 0) + 1;
      await save(p.id, { photoCount: count });
      logProject('photo_added', projects.get(p.id) ?? p, { photoId: photoRef.id });
      return { id: photoRef.id };
    },

    async deletePhoto(ph, { keepCount = false } = {}) {
      await Promise.allSettled([deleteObject(storageRef(storage, ph.storagePath)), deleteObject(storageRef(storage, ph.thumbPath))]);
      await deleteDoc(doc(db, 'users', uid, 'photos', ph.id));
      const p = projects.get(ph.projectId);
      if (p && !keepCount) await save(p.id, { photoCount: Math.max(0, (p.photoCount ?? 1) - 1) });
    },
  };
}
