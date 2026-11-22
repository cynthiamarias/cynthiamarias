// Admin review screen: one pending challenge at a time. Approve gives it its permanent number.
// Everything from the data is shown with textContent, never as HTML.
import { collection, query, where, getDocs, limit, doc, runTransaction, updateDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
};
const list = (items) => el('ul', {}, items.map((t) => el('li', { textContent: t })));
const section = (title, ...kids) => el('div', { className: 'rv-sec' }, el('h3', { textContent: title }), ...kids);

export function mountReview(root, { db, email }) {
  let queue = [];
  let skipped = 0;
  let busy = false;

  async function load() {
    root.replaceChildren(el('p', { className: 'muted', textContent: 'Loading…' }));
    try {
      const snap = await getDocs(query(collection(db, 'challenges'), where('status', '==', 'pending'), limit(200)));
      queue = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Keep batch order so a batch reads in the order it was written.
      queue.sort((a, b) => String(a.batchId).localeCompare(String(b.batchId)) || (a.order ?? 0) - (b.order ?? 0));
      skipped = 0;
      draw();
    } catch (e) {
      root.replaceChildren(el('div', { className: 'card empty' },
        el('p', {}, el('b', { textContent: "Couldn't load the review queue." })),
        el('p', { className: 'muted', textContent: e.code || e.message })));
    }
  }

  function draw(note) {
    root.replaceChildren();
    if (note) root.append(el('div', { className: 'rv-note', role: 'status', textContent: note }));
    if (!queue.length) {
      root.append(el('div', { className: 'card empty' },
        el('p', {}, el('b', { textContent: 'Nothing waiting for review.' })),
        el('p', { className: 'muted', textContent: 'New batches show up here once they are imported as pending.' })));
      return;
    }
    const item = queue[0];
    const c = item.content;
    const total = queue.length;

    // One tap to publish everything waiting. The first tap arms it, the second confirms.
    if (total > 1) {
      const all = el('button', { type: 'button', className: 'btn primary', textContent: `Approve all ${total}` });
      let armed = null;
      all.addEventListener('click', () => {
        if (!armed) {
          all.textContent = `Tap again to approve all ${total}`;
          armed = setTimeout(() => { armed = null; all.textContent = `Approve all ${total}`; }, 5000);
          return;
        }
        clearTimeout(armed);
        approveAll();
      });
      root.append(el('div', { className: 'rv-all' }, all,
        el('p', { className: 'muted', textContent: 'Publishes every challenge below with its permanent number. Or review them one at a time.' })));
    }
    root.append(el('p', { className: 'muted rv-count', textContent: `${total} waiting${skipped ? ` · ${skipped} skipped this round` : ''} · ${item.batchId || 'unbatched'}` }));

    const card = el('article', { className: 'card rv-card' });
    card.append(
      el('h2', { textContent: c.title }),
      el('p', { className: 'rv-meta', textContent: [c.category, `difficulty ${c.difficulty}/5`, c.timeBand, c.challengeType, `firing: ${c.firing?.type ?? 'none'}`, ...(c.seasons ?? [])].join(' · ') }),
      el('p', { className: 'rv-summary', textContent: c.summary }),
      el('p', { textContent: c.brief }),
      section('Constraints', list(c.constraints)),
      section('Materials', list(c.materials)),
    );
    if (c.maxSizeIn) card.append(el('p', { className: 'muted', textContent: `Max size: ${c.maxSizeIn.width} in wide × ${c.maxSizeIn.height} in tall` }));
    if (c.glaze) card.append(el('p', { className: 'muted', textContent: `Glaze: cone ${c.glaze.cone}, ${c.glaze.atmosphere}, ${c.glaze.status}${c.glaze.cone10Optional ? ' (cone 10 optional)' : ''}` }));
    if (c.firing?.schedule) {
      card.append(section('Firing schedule (starting point only)', list(c.firing.schedule.map((s) => `${s.rateFPerHr} °F/hr to ${s.targetF} °F, hold ${s.holdMin} min`))));
    }
    if (c.tradition) card.append(el('p', { className: 'muted', textContent: `Tradition: ${c.tradition.name} (${c.tradition.region}). ${c.tradition.credit}` }));

    const s = c.safety;
    const safe = [`Lead-free: ${s.leadFree ? 'yes' : 'NO'} · food safety: ${s.foodSafety}`, s.general];
    for (const h of s.hazards ?? []) safe.push(`Hazard, ${h.material}: ${h.risk} ${h.handling}`);
    if (s.firingNotes) safe.push(`Fumes: ${s.firingNotes.fumes}`, `Fire: ${s.firingNotes.fire}`, `Burn ban: ${s.firingNotes.burnBan}`, `Gear: ${s.firingNotes.ppe}`);
    if (s.hangingNotes) safe.push(`Holes: ${s.hangingNotes.holes}`, `Weight: ${s.hangingNotes.weight}`, `Wiring: ${s.hangingNotes.wiring}`);
    card.append(el('div', { className: 'rv-safety' }, el('h3', { textContent: 'Safety' }), list(safe)));
    root.append(card);

    const reject = el('button', { type: 'button', className: 'btn danger', textContent: 'Reject' });
    const approve = el('button', { type: 'button', className: 'btn primary', textContent: 'Approve' });
    const skip = el('button', { type: 'button', className: 'btn small ghost', textContent: 'Skip for now' });
    reject.addEventListener('click', () => act(item, 'reject'));
    approve.addEventListener('click', () => act(item, 'approve'));
    skip.addEventListener('click', () => { queue.push(queue.shift()); skipped++; draw(); scrollTo(0, 0); });
    root.append(el('div', { className: 'rv-actions' }, reject, approve), el('div', { className: 'rv-skip' }, skip));
  }

  // Approve everything waiting, in batch order, numbering them one after another.
  // Done in chunks of 100 so a big batch stays well inside Firestore's transaction limits.
  async function approveAll() {
    if (busy) return;
    busy = true;
    for (const b of root.querySelectorAll('button')) b.disabled = true;
    const ids = queue.map((q) => q.id);
    const counterRef = doc(db, 'meta', 'counters');
    let first = null, last = null, count = 0;
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const done = await runTransaction(db, async (tx) => {
          const counter = await tx.get(counterRef);
          const snaps = await Promise.all(chunk.map((id) => tx.get(doc(db, 'challenges', id))));
          let n = counter.exists() ? counter.data().nextChallengeNumber : 1;
          const start = n;
          for (const s of snaps) {
            if (s.exists() && s.data().status === 'pending') {
              tx.update(s.ref, { status: 'approved', number: n++, approvedAt: serverTimestamp(), reviewedBy: email });
            }
          }
          tx.set(counterRef, { nextChallengeNumber: n });
          return { start, end: n - 1 };
        });
        if (done.end >= done.start) { first ??= done.start; last = done.end; count += done.end - done.start + 1; }
      }
      queue = [];
      draw(count ? `Approved ${count} challenges, numbered #${first} to #${last}. They are now in Draw and the Library.` : 'Nothing was left to approve.');
    } catch (e) {
      draw(`That didn't finish (${e.code || e.message}). Some may have been approved; reload this tab to see what is left.`);
    } finally {
      busy = false;
    }
  }

  async function act(item, kind) {
    if (busy) return;
    busy = true;
    for (const b of root.querySelectorAll('button')) b.disabled = true;
    const ref = doc(db, 'challenges', item.id);
    try {
      let note;
      if (kind === 'approve') {
        const counterRef = doc(db, 'meta', 'counters');
        const number = await runTransaction(db, async (tx) => {
          const cur = await tx.get(ref);
          if (!cur.exists() || cur.data().status !== 'pending') throw new Error('This challenge is no longer pending.');
          const counter = await tx.get(counterRef);
          const n = counter.exists() ? counter.data().nextChallengeNumber : 1;
          tx.set(counterRef, { nextChallengeNumber: n + 1 });
          tx.update(ref, { status: 'approved', number: n, approvedAt: serverTimestamp(), reviewedBy: email });
          return n;
        });
        note = `Approved as #${number}.`;
      } else {
        await updateDoc(ref, { status: 'rejected', rejectedAt: serverTimestamp(), reviewedBy: email });
        note = 'Rejected.';
      }
      queue.shift();
      draw(note);
      scrollTo(0, 0);
    } catch (e) {
      draw(`That didn't save (${e.code || e.message}).`);
    } finally {
      busy = false;
    }
  }

  load();
}
