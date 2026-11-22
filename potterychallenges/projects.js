// Projects: marking a challenge done, the up-next queue, stages, and per-project details.
// One project is one attempt at one challenge. Everything from the data goes in with
// textContent, never as HTML.
import { el, renderCard } from './card.js?v=0.9';
import { STAGES, STAGE_LABEL, OCCASIONS, dateFromInput, inputFromDate, toMs } from './logic.js?v=0.9';
import { Timestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { prepareImage } from './image.js?v=0.9';

export function createProjects({ data, taxonomy }) {
  const catLabel = Object.fromEntries((taxonomy.categories ?? []).map((c) => [c.id, c.label]));
  const fmt = (t) => (t ? new Date(toMs(t)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  // ---------- bottom sheet + toast ----------
  const dlg = el('dialog', { className: 'sheet' });
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const closeSheet = () => { if (dlg.open) dlg.close(); };
  const openSheet = (...kids) => { dlg.replaceChildren(...kids); if (!dlg.open) dlg.showModal(); };
  const cancelBtn = (text = 'Cancel') => { const b = el('button', { type: 'button', className: 'btn ghost', textContent: text }); b.addEventListener('click', closeSheet); return b; };

  const toastEl = el('div', { className: 'toast', role: 'status', hidden: true });
  document.body.append(toastEl);
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }
  const fail = (e) => toast(`That didn't save (${e.code || e.message}).`);
  const dbg = (m) => window.dispatchEvent(new CustomEvent('pc-log', { detail: m })); // shows in the #debug log

  // ---------- mark done ----------
  function doneSheet(c, after) {
    const now = new Date();
    const noon = (offsetDays) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays, 12, 0, 0);
    let choice = 'today';
    const picker = el('input', { type: 'date', value: inputFromDate(now), max: inputFromDate(now), ariaLabel: 'Date finished' });
    picker.hidden = true;
    const segs = el('div', { className: 'segs' });
    const paint = () => { for (const b of segs.children) b.setAttribute('aria-pressed', String(b.dataset.key === choice)); picker.hidden = choice !== 'pick'; };
    for (const [key, text] of [['today', 'Today'], ['yesterday', 'Yesterday'], ['pick', 'Pick a date']]) {
      const b = el('button', { type: 'button', className: 'seg', textContent: text });
      b.dataset.key = key;
      b.addEventListener('click', () => { choice = key; paint(); });
      segs.append(b);
    }
    paint();
    const notes = el('textarea', { rows: 3, ariaLabel: 'Notes', placeholder: 'Notes, optional: what worked, what you would change' });
    const save = el('button', { type: 'button', className: 'btn primary', textContent: 'Save' });
    save.addEventListener('click', async () => {
      const date = choice === 'today' ? noon(0) : choice === 'yesterday' ? noon(1) : dateFromInput(picker.value);
      if (!date) return toast('Pick a valid date first.');
      save.disabled = true;
      try { await data.markDone(c, { date, notes: notes.value.trim() }); closeSheet(); toast('Marked done.'); after?.(); }
      catch (e) { fail(e); save.disabled = false; }
    });
    openSheet(el('h3', { textContent: `Done: ${c.content.title}` }), el('p', { className: 'muted', textContent: 'When did you finish it?' }), segs, picker, notes, save, cancelBtn());
  }

  // ---------- stage picker ----------
  function stageSheet(p, after) {
    const grid = el('div', { className: 'stage-grid' });
    for (const s of STAGES) {
      const b = el('button', { type: 'button', className: `btn${s === p.stage ? ' primary' : ''}`, textContent: STAGE_LABEL[s] });
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await data.setStage(data.projectById(p.id) ?? p, s); closeSheet(); after?.(); }
        catch (e) { fail(e); b.disabled = false; }
      });
      grid.append(b);
    }
    openSheet(el('h3', { textContent: 'Where is it now?' }), grid, cancelBtn());
  }

  // ---------- the two buttons that go under every challenge card ----------
  function challengeButtons(c) {
    const queue = el('button', { type: 'button', className: 'btn' });
    const paint = () => { const open = data.openFor(c.id); queue.textContent = open ? '✓ In up next' : '+ Up next'; queue.setAttribute('aria-pressed', String(Boolean(open))); queue.classList.toggle('on', Boolean(open)); };
    paint();
    queue.addEventListener('click', async () => {
      if (data.openFor(c.id)) return toast('Already in your up-next list.');
      queue.disabled = true;
      try { await data.addToQueue(c); toast('Added to up next.'); paint(); } catch (e) { fail(e); } finally { queue.disabled = false; }
    });
    const done = el('button', { type: 'button', className: 'btn', textContent: '✓ Done' });
    done.addEventListener('click', () => doneSheet(c, paint));
    return el('div', { className: 'rv-actions' }, queue, done);
  }

  // ---------- project detail (used from Up next and from the Done history) ----------
  function renderDetail(root, id, onBack) {
    const p = data.projectById(id);
    if (!p) return onBack();
    const again = () => renderDetail(root, id, onBack);
    const c = data.byId(p.challengeId);
    root.replaceChildren();

    const back = el('button', { type: 'button', className: 'btn', textContent: '← Back' });
    back.addEventListener('click', () => { onBack(); scrollTo(0, 0); });
    root.append(back);

    const card = el('div', { className: 'card pj' });
    card.append(el('h2', { textContent: p.title }), el('p', { className: 'muted', textContent: `${p.challengeNumber != null ? `#${p.challengeNumber} · ` : ''}${catLabel[p.category] ?? p.category ?? ''}` }));

    const stageBtn = el('button', { type: 'button', className: 'btn primary', textContent: `${STAGE_LABEL[p.stage]} ▾` });
    stageBtn.addEventListener('click', () => stageSheet(p, again));
    card.append(el('label', { className: 'field' }, el('span', { textContent: 'Stage' }), stageBtn));

    const dateField = (label, current, onSet, max) => {
      const input = el('input', { type: 'date', value: current ? inputFromDate(new Date(toMs(current))) : '', ariaLabel: label });
      if (max) input.max = max;
      input.addEventListener('change', async () => {
        const d = input.value ? dateFromInput(input.value) : null;
        try { await onSet(d ? Timestamp.fromDate(d) : null); toast('Saved.'); } catch (e) { fail(e); }
      });
      return el('label', { className: 'field' }, el('span', { textContent: label }), input);
    };
    if (p.stage === 'done') card.append(dateField('Finished on', p.completedAt, (v) => data.updateFields(p, { completedAt: v ?? p.completedAt }), inputFromDate(new Date())));
    else card.append(dateField('Target date', p.targetDate, (v) => data.updateFields(p, { targetDate: v })));

    const occ = el('select', { ariaLabel: 'Occasion' }, [el('option', { value: '', textContent: 'No occasion' }), ...OCCASIONS.map((o) => el('option', { value: o, textContent: o, selected: p.occasion === o }))]);
    occ.addEventListener('change', async () => { try { await data.updateFields(p, { occasion: occ.value || null }); toast('Saved.'); } catch (e) { fail(e); } });
    card.append(el('label', { className: 'field' }, el('span', { textContent: 'Occasion' }), occ));

    const notes = el('textarea', { rows: 5, value: p.notes ?? '', ariaLabel: 'Notes', placeholder: 'Notes: clay, glaze, what happened…' });
    notes.addEventListener('change', async () => { try { await data.updateFields(p, { notes: notes.value.trim() }); toast('Notes saved.'); } catch (e) { fail(e); } });
    card.append(el('label', { className: 'field' }, el('span', { textContent: 'Notes' }), notes));

    card.append(photosSection(p, again));

    const hist = (p.stageHistory ?? []).map((h) => `${STAGE_LABEL[h.stage] ?? h.stage}: ${fmt(h.at)}`);
    if (hist.length) card.append(el('div', { className: 'rv-sec' }, el('h3', { textContent: 'History' }), el('ul', {}, hist.map((t) => el('li', { textContent: t })))));
    root.append(card);

    if (c) {
      const view = el('button', { type: 'button', className: 'btn', textContent: 'View the challenge' });
      const holder = el('div');
      view.addEventListener('click', () => { if (holder.firstChild) { holder.replaceChildren(); view.textContent = 'View the challenge'; } else { holder.append(renderCard(c, catLabel)); view.textContent = 'Hide the challenge'; } });
      root.append(el('div', { className: 'pj-gap' }, view), holder);
    }

    const remove = el('button', { type: 'button', className: 'btn danger', textContent: 'Remove this project' });
    remove.addEventListener('click', () => {
      const yes = el('button', { type: 'button', className: 'btn danger', textContent: 'Remove it' });
      yes.addEventListener('click', async () => {
        yes.disabled = true;
        try { await data.remove(p); closeSheet(); toast('Removed.'); onBack(); } catch (e) { fail(e); yes.disabled = false; }
      });
      openSheet(el('h3', { textContent: 'Remove this project?' }), el('p', { textContent: 'Its notes and stage history go with it. The challenge itself stays in your library.' }), yes, cancelBtn('Keep it'));
    });
    root.append(el('div', { className: 'pj-gap' }, remove));
  }

  // ---------- photos on a project ----------
  function photosSection(p, again) {
    const grid = el('div', { className: 'photo-grid' });
    const status = el('p', { className: 'muted photo-status' });
    const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const add = el('button', { type: 'button', className: 'btn', textContent: '+ Add photo' });
    add.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      if (!files.length) return;
      add.disabled = true;
      status.textContent = '';
      let done = 0, failed = 0, lastError = '';
      for (const f of files) {
        status.textContent = `Preparing photo ${done + failed + 1} of ${files.length}…`;
        try {
          const prepared = await prepareImage(f, dbg);
          status.textContent = `Uploading photo ${done + failed + 1} of ${files.length}…`;
          await data.addPhoto(data.projectById(p.id) ?? p, prepared);
          done++;
        } catch (e) {
          failed++;
          lastError = e.code ? `${e.code}: ${e.message}` : (e.message || String(e));
          dbg(`photo failed (${f.type || 'unknown type'}, ${Math.round(f.size / 1024)} KB): ${lastError}`);
        }
      }
      add.disabled = false;
      if (failed) {
        // Leave the error on screen so it can be read (and screenshotted) instead of flashing by.
        status.setAttribute('role', 'alert');
        status.textContent = `${done ? `${done} added, ` : ''}${failed} failed. ${lastError}`;
        toast(`${failed} photo${failed === 1 ? '' : 's'} failed. See the message under Photos.`);
        if (done) again();
        return;
      }
      toast(`${done} photo${done === 1 ? '' : 's'} added.`);
      again();
    });

    (async () => {
      try {
        const photos = await data.photosFor(p.id);
        if (!photos.length) { status.textContent = 'No photos yet.'; return; }
        for (const ph of photos) {
          const b = el('button', { type: 'button', className: 'photo', ariaLabel: 'Open photo' });
          const img = el('img', { alt: '', loading: 'lazy', width: 120, height: 120 });
          b.append(img);
          b.addEventListener('click', () => viewPhoto(ph, again));
          grid.append(b);
          data.thumbUrl(ph).then((u) => { img.src = u; }).catch(() => { b.textContent = '⚠'; });
        }
      } catch (e) { status.textContent = `Couldn't load photos (${e.code || e.message}).`; }
    })();

    return el('div', { className: 'rv-sec' }, el('h3', { textContent: 'Photos' }), grid, status, add, input,
      el('p', { className: 'muted photo-note', textContent: 'Private to you. Location data is removed before upload.' }));
  }

  function viewPhoto(ph, again) {
    const img = el('img', { className: 'photo-full', alt: 'Your photo' });
    data.fullUrl(ph).then((u) => { img.src = u; }).catch(() => { img.replaceWith(el('p', { textContent: "Couldn't load this photo." })); });
    const del = el('button', { type: 'button', className: 'btn danger', textContent: 'Delete this photo' });
    del.addEventListener('click', async () => {
      del.disabled = true;
      try { await data.deletePhoto(ph); closeSheet(); toast('Photo deleted.'); again(); } catch (e) { fail(e); del.disabled = false; }
    });
    openSheet(img, del, cancelBtn('Close'));
  }

  // ---------- Up next ----------
  let detailId = null;
  function renderUpNext(root) {
    if (detailId) return renderDetail(root, detailId, () => { detailId = null; renderUpNext(root); });
    root.replaceChildren();
    const q = data.queue();
    if (!q.length) {
      root.append(el('div', { className: 'card empty' }, el('p', {}, el('b', { textContent: 'Nothing queued.' })),
        el('p', { className: 'muted', textContent: 'Tap + Up next on any challenge to line it up here.' })));
      return;
    }
    root.append(el('p', { className: 'muted rv-count', textContent: `${q.length} lined up` }));
    const list = el('div', { className: 'q-list' });
    q.forEach((p, i) => {
      const again = () => renderUpNext(root);
      const sub = [p.challengeNumber != null ? `#${p.challengeNumber}` : '', p.targetDate ? `by ${fmt(p.targetDate)}` : '', p.occasion ?? ''].filter(Boolean).join(' · ');
      const main = el('button', { type: 'button', className: 'q-main' }, el('span', { className: 'lib-title', textContent: p.title }), el('span', { className: 'lib-meta', textContent: sub || 'No date set' }));
      main.addEventListener('click', () => { detailId = p.id; again(); scrollTo(0, 0); });
      const pill = el('button', { type: 'button', className: 'pill', textContent: `${STAGE_LABEL[p.stage]} ▾` });
      pill.addEventListener('click', () => stageSheet(p, again));
      const mv = (dir, glyph, label, off) => {
        const b = el('button', { type: 'button', className: 'mv', textContent: glyph, ariaLabel: label, disabled: off });
        b.addEventListener('click', async () => { b.disabled = true; try { await data.move(p, dir); } catch (e) { fail(e); } again(); });
        return b;
      };
      list.append(el('div', { className: 'q-row' }, el('div', { className: 'q-left' }, main, pill), el('div', { className: 'q-move' }, mv(-1, '▲', 'Move up', i === 0), mv(1, '▼', 'Move down', i === q.length - 1))));
    });
    root.append(list);
  }

  // ---------- Done history (inside the Library) ----------
  let doneDetailId = null;
  function renderDone(root) {
    if (doneDetailId) return renderDetail(root, doneDetailId, () => { doneDetailId = null; renderDone(root); });
    root.replaceChildren();
    const h = data.history();
    if (!h.length) {
      root.append(el('div', { className: 'card empty' }, el('p', {}, el('b', { textContent: 'Nothing finished yet.' })),
        el('p', { className: 'muted', textContent: 'Tap ✓ Done on a challenge when you finish one.' })));
      return;
    }
    root.append(el('p', { className: 'muted rv-count', textContent: `${h.length} finished` }));
    const list = el('div', { className: 'lib-list' });
    for (const p of h) {
      const row = el('button', { type: 'button', className: 'lib-row' },
        el('span', { className: 'num', textContent: p.challengeNumber != null ? `#${p.challengeNumber}` : '' }),
        el('span', { className: 'lib-main' }, el('span', { className: 'lib-title', textContent: p.title }),
          el('span', { className: 'lib-meta', textContent: [fmt(p.completedAt), (p.notes ?? '').split('\n')[0].slice(0, 70)].filter(Boolean).join(' · ') })),
        el('span', { className: 'lib-tags', textContent: '' }));
      row.addEventListener('click', () => { doneDetailId = p.id; renderDone(root); scrollTo(0, 0); });
      list.append(row);
    }
    root.append(list);
  }

  return {
    challengeButtons,
    upNextTab(root) { detailId = null; renderUpNext(root); },
    renderDone(root) { doneDetailId = null; renderDone(root); },
  };
}
