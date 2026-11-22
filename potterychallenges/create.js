// Create (a new challenge from a short prompt) and Remix (change an existing one).
// The server function does the writing and the safety checking; this file is only the screens:
// ask, wait, preview, then Save / Try again / Discard. Nothing is kept until Save is tapped.
import { el, renderCard, TIME_LABEL } from './card.js?v=0.11';

const REMIX_CHOICES = [
  ['easier', 'Easier'], ['harder', 'Harder'], ['quicker', 'Quicker and smaller'], ['set', 'Giftable set of 3–4'],
  ['seasonal', 'Seasonal twist'], ['cone10', 'Cone 10 version'], ['alt-firing', 'Raku version'],
];

// Turn a function error into words a person can use. HttpsError messages from our own function
// are already friendly; the rest are the generic cases.
export function friendlyError(e) {
  const code = String(e?.code ?? '').replace('functions/', '');
  // A message is only worth showing if it is a real sentence, not a bare word like "internal".
  const usable = typeof e?.message === 'string' && e.message.length > 12 && e.message.toLowerCase() !== code;
  if (code === 'not-found' || code === 'unimplemented') return 'Create and Remix are not switched on yet.';
  if (code === 'unauthenticated') return 'Please sign in again.';
  if (code === 'deadline-exceeded') return 'That took too long. Try again in a moment.';
  if (code === 'unavailable' && !usable) return "Couldn't reach the server. Check your connection and try again.";
  if (usable) return e.message;
  return 'Something went wrong. Try again.';
}

export function createCreator({ data, ui, call, labels = {}, refresh }) {
  const { openSheet, closeSheet, cancelBtn, toast } = ui;

  const asItem = (id, content) => ({
    id, content, isMine: true, number: null, category: content.category,
    firing: content.firing?.type ?? 'none', cone10Optional: Boolean(content.glaze?.cone10Optional || content.firing?.cone10Optional),
  });

  // ---------- waiting, errors, preview ----------
  function run(kind, input, title) {
    openSheet(el('h3', { textContent: title }), el('p', { className: 'muted', role: 'status', textContent: 'Writing it and checking it is safe. This can take up to a minute…' }));
    call[kind](input).then(
      (result) => { if (dlgStillOpen()) preview(kind, input, result, title); else data.discardDraft(result.id).catch(() => {}); },
      (e) => { if (dlgStillOpen()) problem(kind, input, title, e); },
    );
  }
  const dlgStillOpen = () => document.querySelector('dialog.sheet')?.open === true;

  function problem(kind, input, title, e) {
    const again = el('button', { type: 'button', className: 'btn primary', textContent: 'Try again' });
    again.addEventListener('click', () => run(kind, input, title));
    const out = ['resource-exhausted', 'permission-denied'].includes(String(e?.code).replace('functions/', ''));
    openSheet(el('h3', { textContent: "That didn't work" }), el('p', { role: 'alert', textContent: friendlyError(e) }), ...(out ? [] : [again]), cancelBtn('Close'));
  }

  function preview(kind, input, result, title) {
    const item = asItem(result.id, result.content);
    const save = el('button', { type: 'button', className: 'btn primary', textContent: 'Save' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await data.keepDraft(result.id); closeSheet(); toast('Saved. Find it under Library, then Mine.'); refresh?.(); }
      catch (e) { toast(`That didn't save (${e.code || e.message}).`); save.disabled = false; }
    });
    const retry = el('button', { type: 'button', className: 'btn', textContent: result.remainingToday > 0 ? `Try again (${result.remainingToday} left today)` : 'No more tries today' });
    retry.disabled = !(result.remainingToday > 0);
    retry.addEventListener('click', () => { data.discardDraft(result.id).catch(() => {}); run(kind, input, title); });
    const discard = el('button', { type: 'button', className: 'btn ghost', textContent: 'Discard' });
    discard.addEventListener('click', () => { data.discardDraft(result.id).catch(() => {}); closeSheet(); });

    const kids = [el('h3', { textContent: 'Here is your challenge' })];
    for (const w of result.warnings ?? []) kids.push(el('div', { className: 'rv-note', role: 'status', textContent: w.replace(/^review: /, 'Worth a look: ') }));
    kids.push(renderCard(item, labels), el('div', { className: 'rv-actions' }, retry, save), discard);
    openSheet(...kids);
    dlg().scrollTop = 0;
  }
  const dlg = () => document.querySelector('dialog.sheet');

  // ---------- Create ----------
  function createSheet() {
    const prompt = el('textarea', { rows: 3, maxLength: 300, ariaLabel: 'What do you want to make?', placeholder: 'e.g. a pinch-pot mug for my sister, finished in an afternoon' });
    const option = (value, text) => el('option', { value, textContent: text });
    const time = el('select', { ariaLabel: 'Time' }, option('', 'Any time'), ...Object.entries(TIME_LABEL).map(([v, t]) => option(v, t)));
    const diff = el('select', { ariaLabel: 'Difficulty' }, option('', 'Any difficulty'), ...[1, 2, 3, 4, 5].map((n) => option(String(n), `Difficulty ${n}`)));
    const go = el('button', { type: 'button', className: 'btn primary', textContent: '✦ Create', disabled: true });
    prompt.addEventListener('input', () => { go.disabled = prompt.value.trim().length < 3; });
    go.addEventListener('click', () => {
      const hints = {};
      if (time.value) hints.timeBand = time.value;
      if (diff.value) hints.difficulty = Number(diff.value);
      run('create', { prompt: prompt.value.trim(), hints }, 'Making your challenge');
    });
    openSheet(el('h3', { textContent: 'Create a challenge' }), el('p', { className: 'muted', textContent: 'Describe what you would like to make, in a few words.' }),
      prompt, el('div', { className: 'pair' }, time, diff), go, cancelBtn());
  }

  // ---------- Remix ----------
  function remixSheet(item) {
    const note = el('textarea', { rows: 2, maxLength: 300, ariaLabel: 'Anything to add', placeholder: 'Anything to add? (optional)' });
    const grid = el('div', { className: 'stage-grid' });
    const source = item.isMine ? { type: 'mine', id: item.docId } : { type: 'library', id: item.id };
    for (const [preset, text] of REMIX_CHOICES) {
      const b = el('button', { type: 'button', className: 'btn', textContent: text });
      b.addEventListener('click', () => run('remix', { source, preset, note: note.value.trim() }, 'Remixing your challenge'));
      grid.append(b);
    }
    openSheet(el('h3', { textContent: `Remix: ${item.content.title}` }), el('p', { className: 'muted', textContent: 'How should it change?' }), note, grid, cancelBtn());
  }

  return {
    createButton() {
      const b = el('button', { type: 'button', className: 'btn primary', textContent: '✦ Create a challenge' });
      b.addEventListener('click', createSheet);
      return b;
    },
    remixButton(item) {
      const b = el('button', { type: 'button', className: 'btn', textContent: '✦ Remix' });
      b.addEventListener('click', () => remixSheet(item));
      return b;
    },
  };
}
