// Draw tab (one challenge at a time, random, with filters) and Library tab (a list to browse),
// plus the small settings block on the Me tab.
import { el, renderCard, hasSafetyNotes, TIME_LABEL } from './card.js?v=0.10';
import { NO_FILTERS, OUTSIDE_FIRINGS, DEFAULT_FIRINGS, pick, pushRecent, dots } from './logic.js?v=0.10';

const store = (key, value) => {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
};
const SEASON_LABEL = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter', valentines: "Valentine's", easter: 'Easter', halloween: 'Halloween', christmas: 'Christmas' };

export function createBrowse({ data, taxonomy, projects, creator, drawRoot, libRoot, meRoot }) {
  const catLabel = Object.fromEntries((taxonomy.categories ?? []).map((c) => [c.id, c.label]));

  // ---------- shared bits ----------
  function select(label, options, value, onChange) {
    const s = el('select', { ariaLabel: label }, options.map(([v, text]) => el('option', { value: v, textContent: text, selected: v === value })));
    s.addEventListener('change', () => onChange(s.value));
    return el('label', { className: 'sel' }, el('span', { textContent: label }), s);
  }
  const errorNote = (e) => el('div', { className: 'rv-note', role: 'alert', textContent: `That didn't save (${e.code || e.message}).` });

  // ---------- Draw ----------
  let filters = (() => { try { return { ...NO_FILTERS, ...JSON.parse(store('potterychallenges.filters') || '{}') }; } catch (e) { return { ...NO_FILTERS }; } })();
  let current = null;
  let recent = [];
  let note = '';

  function filterOptions() {
    const cats = [['any', 'Any category'], ...(taxonomy.categories ?? []).filter((c) => !c.heldBack).map((c) => [c.id, c.label])];
    const diffs = [['any', 'Any difficulty'], ...[1, 2, 3, 4, 5].map((n) => [String(n), `${dots(n)} ${n}`])];
    const times = [['any', 'Any time'], ...Object.entries(TIME_LABEL)];
    const seasons = [['any', 'Any season'], ...Object.entries(SEASON_LABEL)];
    return { cats, diffs, times, seasons };
  }

  function setFilter(key, value) {
    filters = { ...filters, [key]: value };
    store('potterychallenges.filters', JSON.stringify(filters));
    nextDraw(); // a changed filter means a fresh draw
  }

  function nextDraw(keepNote) {
    if (!keepNote) note = '';
    const candidates = data.visiblePool(filters);
    const c = pick(candidates, recent);
    if (c && current && c.id === current.id && candidates.length === 1) note = "That's the only one that matches these filters.";
    current = c;
    if (c) {
      recent = pushRecent(recent, c.id);
      data.recordDraw(c).catch(() => {}); // history is nice to have; never block the screen on it
    }
    renderDraw();
    scrollTo(0, 0);
  }

  function renderDraw() {
    const { cats, diffs, times, seasons } = filterOptions();
    const bar = el('div', { className: 'filters' },
      select('Category', cats, filters.category, (v) => setFilter('category', v)),
      select('Difficulty', diffs, filters.difficulty, (v) => setFilter('difficulty', v)),
      select('Time', times, filters.timeBand, (v) => setFilter('timeBand', v)),
      select('Season', seasons, filters.season, (v) => setFilter('season', v)));
    drawRoot.replaceChildren(el('div', { className: 'act-wide top' }, creator.createButton()), bar);
    if (note) drawRoot.append(el('div', { className: 'rv-note', role: 'status', textContent: note }));

    if (!data.all().length) {
      drawRoot.append(el('div', { className: 'card empty' }, el('p', {}, el('b', { textContent: 'No challenges yet.' })),
        el('p', { className: 'muted', textContent: 'Nothing has been approved. Approve some in the Review tab.' })));
      return;
    }
    if (!current) {
      const reset = el('button', { type: 'button', className: 'btn', textContent: 'Clear filters' });
      reset.addEventListener('click', () => { filters = { ...NO_FILTERS }; store('potterychallenges.filters', JSON.stringify(filters)); nextDraw(); });
      drawRoot.append(el('div', { className: 'card empty' }, el('p', {}, el('b', { textContent: 'Nothing matches these filters.' })),
        el('p', { className: 'muted', textContent: 'Try fewer filters. Challenges that need a firing you cannot do are hidden; change that on the Me tab.' }), reset));
      return;
    }

    const card = renderCard(current, catLabel);
    // Swipe left for another one.
    let x0 = 0, y0 = 0;
    card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    card.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.5) nextDraw();
    }, { passive: true });
    drawRoot.append(card, actions(current, () => nextDraw(), 'Another one →'));
  }

  function actions(c, onSecondary, secondaryText) {
    const fav = el('button', { type: 'button', className: 'btn' });
    const paint = () => { const on = data.isFavorite(c.id); fav.textContent = on ? '♥ Favorited' : '♡ Favorite'; fav.setAttribute('aria-pressed', String(on)); fav.classList.toggle('on', on); };
    paint();
    fav.addEventListener('click', async () => {
      fav.disabled = true;
      try { await data.toggleFavorite(c); paint(); } catch (e) { fav.before(errorNote(e)); } finally { fav.disabled = false; }
    });
    const other = el('button', { type: 'button', className: 'btn primary', textContent: secondaryText });
    other.addEventListener('click', onSecondary);
    return el('div', { className: 'act' }, el('div', { className: 'rv-actions' }, fav, other), projects.challengeButtons(c), el('div', { className: 'act-wide' }, creator.remixButton(c)));
  }

  // ---------- Library ----------
  const lib = { mode: 'all', category: 'any', openId: null };

  function deleteMineButton(c) {
    const b = el('button', { type: 'button', className: 'btn danger', textContent: 'Delete this challenge' });
    b.addEventListener('click', () => {
      const yes = el('button', { type: 'button', className: 'btn danger', textContent: 'Delete it' });
      yes.addEventListener('click', async () => {
        yes.disabled = true;
        try { await data.deleteMine(c); projects.ui.closeSheet(); projects.ui.toast('Deleted.'); lib.openId = null; current = null; renderLibrary(); }
        catch (e) { projects.ui.fail(e); yes.disabled = false; }
      });
      projects.ui.openSheet(el('h3', { textContent: 'Delete this challenge?' }),
        el('p', { textContent: 'It is removed from Mine. Projects you made from it keep their notes and photos.' }), yes, projects.ui.cancelBtn('Keep it'));
    });
    return b;
  }

  function renderMine() {
    libRoot.append(el('div', { className: 'act-wide top' }, creator.createButton()));
    const rows = data.mine();
    if (!rows.length) {
      libRoot.append(el('div', { className: 'card empty' }, el('p', {}, el('b', { textContent: 'Nothing here yet.' })),
        el('p', { className: 'muted', textContent: 'Tap ✦ Create a challenge, or ✦ Remix on any challenge, and keep the ones you like.' })));
      return;
    }
    libRoot.append(el('p', { className: 'muted rv-count', textContent: `${rows.length} made by you` }));
    const ul = el('div', { className: 'lib-list' });
    for (const c of rows) {
      const row = el('button', { type: 'button', className: 'lib-row' },
        el('span', { className: 'num', textContent: '✦' }),
        el('span', { className: 'lib-main' },
          el('span', { className: 'lib-title', textContent: c.content.title }),
          el('span', { className: 'lib-meta' }, el('span', { className: 'dots', textContent: dots(c.difficulty) }), ` ${TIME_LABEL[c.timeBand] ?? c.timeBand} · ${catLabel[c.category] ?? c.category}`)),
        el('span', { className: 'lib-tags', textContent: data.isFavorite(c.id) ? '♥' : '' }));
      row.addEventListener('click', () => { lib.openId = c.id; renderLibrary(); scrollTo(0, 0); });
      ul.append(row);
    }
    libRoot.append(ul);
  }

  function renderLibrary() {
    libRoot.replaceChildren();
    if (lib.openId) {
      const c = data.byId(lib.openId);
      if (!c) { lib.openId = null; return renderLibrary(); }
      libRoot.append(renderCard(c, catLabel), actions(c, () => { lib.openId = null; renderLibrary(); scrollTo(0, 0); }, '← Back'));
      if (c.isMine) libRoot.append(el('div', { className: 'act-wide top' }, deleteMineButton(c)));
      return;
    }
    const seg = (mode, text) => {
      const b = el('button', { type: 'button', className: 'seg', textContent: text });
      b.setAttribute('aria-pressed', String(lib.mode === mode));
      b.addEventListener('click', () => { lib.mode = mode; renderLibrary(); });
      return b;
    };
    libRoot.append(el('div', { className: 'segs' }, seg('all', 'All'), seg('fav', 'Favorites'), seg('mine', 'Mine'), seg('done', 'Done')));
    if (lib.mode === 'mine') return renderMine();
    if (lib.mode === 'done') {
      const box = el('div');
      libRoot.append(box);
      projects.renderDone(box);
      return;
    }
    libRoot.append(el('div', { className: 'filters' },
      select('Category', filterOptions().cats, lib.category, (v) => { lib.category = v; renderLibrary(); })));

    const rows = data.visiblePool({ ...NO_FILTERS, category: lib.category }).filter((c) => lib.mode === 'all' || data.isFavorite(c.id));
    if (!rows.length) {
      libRoot.append(el('div', { className: 'card empty' }, el('p', {}, el('b', { textContent: lib.mode === 'fav' ? 'No favorites yet.' : 'Nothing here.' })),
        el('p', { className: 'muted', textContent: lib.mode === 'fav' ? 'Tap ♡ Favorite on a challenge to keep it here.' : 'Try another category.' })));
      return;
    }
    libRoot.append(el('p', { className: 'muted rv-count', textContent: `${rows.length} challenge${rows.length === 1 ? '' : 's'}` }));
    const ul = el('div', { className: 'lib-list' });
    for (const c of rows) {
      const tags = [data.isFavorite(c.id) ? '♥' : '', OUTSIDE_FIRINGS.includes(c.firing) ? '🔥' : '', hasSafetyNotes(c) ? '⚠' : ''].filter(Boolean).join(' ');
      const row = el('button', { type: 'button', className: 'lib-row' },
        el('span', { className: 'num', textContent: c.number != null ? `#${c.number}` : '' }),
        el('span', { className: 'lib-main' },
          el('span', { className: 'lib-title', textContent: c.content.title }),
          el('span', { className: 'lib-meta' }, el('span', { className: 'dots', textContent: dots(c.difficulty) }), ` ${TIME_LABEL[c.timeBand] ?? c.timeBand} · ${catLabel[c.category] ?? c.category}`)),
        el('span', { className: 'lib-tags', textContent: tags }));
      row.addEventListener('click', () => { lib.openId = c.id; renderLibrary(); scrollTo(0, 0); });
      ul.append(row);
    }
    libRoot.append(ul);
  }

  // ---------- Me: settings ----------
  function renderMe() {
    const saved = data.profile().firingsAvailable;
    const on = new Set(Array.isArray(saved) ? saved : DEFAULT_FIRINGS);
    meRoot.replaceChildren(el('h3', { className: 'set-h', textContent: 'Firings I can do outside the kiln' }),
      el('p', { className: 'muted', textContent: 'Challenges that need a firing you leave unticked are hidden from Draw and the Library.' }));
    for (const f of OUTSIDE_FIRINGS) {
      const box = el('input', { type: 'checkbox', checked: on.has(f) });
      const row = el('label', { className: 'check' }, box, el('span', { textContent: f[0].toUpperCase() + f.slice(1) }));
      box.addEventListener('change', async () => {
        const next = OUTSIDE_FIRINGS.filter((x) => (x === f ? box.checked : on.has(x)));
        box.disabled = true;
        try { await data.setFirings(next); on.clear(); next.forEach((x) => on.add(x)); current = null; recent = []; }
        catch (e) { box.checked = !box.checked; row.after(errorNote(e)); }
        finally { box.disabled = false; }
      });
      meRoot.append(row);
    }

    const mineBox = el('input', { type: 'checkbox', checked: Boolean(data.profile().includeMine) });
    const mineRow = el('label', { className: 'check' }, mineBox, el('span', { textContent: 'Include challenges I made in Draw' }));
    mineBox.addEventListener('change', async () => {
      mineBox.disabled = true;
      try { await data.setIncludeMine(mineBox.checked); current = null; recent = []; }
      catch (e) { mineBox.checked = !mineBox.checked; mineRow.after(errorNote(e)); }
      finally { mineBox.disabled = false; }
    });
    meRoot.append(el('h3', { className: 'set-h set-gap', textContent: 'Draw' }), mineRow);
  }

  return {
    drawTab() { if (!current && !note) nextDraw(); else renderDraw(); },
    libraryTab: renderLibrary,
    meTab: renderMe,
  };
}
