// One challenge as a card. Everything from the data goes in with textContent, never as HTML.
import { dots, OUTSIDE_FIRINGS } from './logic.js?v=0.8';

export const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
};
const list = (items) => el('ul', {}, items.map((t) => el('li', { textContent: t })));
const section = (title, ...kids) => el('div', { className: 'rv-sec' }, el('h3', { textContent: title }), ...kids);

export const TIME_LABEL = { 'one-session': 'One session', weekend: 'A weekend', 'multi-week': 'Multi-week' };

export function renderCard(item, labels = {}) {
  const c = item.content;
  const card = el('article', { className: 'card rv-card' });

  const badges = [];
  if (item.firing && OUTSIDE_FIRINGS.includes(item.firing)) badges.push(`Outside firing: ${item.firing}`);
  if (item.cone10Optional) badges.push('Cone 10 optional');
  if (item.number != null) card.append(el('p', { className: 'num', textContent: `#${item.number}` }));
  card.append(
    el('h2', { textContent: c.title }),
    el('p', { className: 'rv-meta' },
      el('span', { className: 'dots', textContent: dots(c.difficulty), title: `Difficulty ${c.difficulty} of 5` }),
      ` ${TIME_LABEL[c.timeBand] ?? c.timeBand} · ${labels[c.category] ?? c.category}`),
  );
  if (badges.length) card.append(el('p', { className: 'badges' }, badges.map((b) => el('span', { className: 'badge', textContent: b }))));
  card.append(
    el('p', { className: 'rv-summary', textContent: c.summary }),
    el('p', { textContent: c.brief }),
    section('Constraints', list(c.constraints)),
    section('Materials', list(c.materials)),
  );
  if (c.maxSizeIn) card.append(el('p', { className: 'muted', textContent: `Max size: ${c.maxSizeIn.width} in wide × ${c.maxSizeIn.height} in tall` }));
  if (c.glaze) card.append(el('p', { className: 'muted', textContent: `Glaze: cone ${c.glaze.cone}, oxidation. Untested and not food-safe.${c.glaze.cone10Optional ? ' Cone 10 is optional.' : ''}` }));
  if (c.firing?.schedule) {
    card.append(section('Firing schedule (starting point only)', list(c.firing.schedule.map((s) => `${s.rateFPerHr} °F/hr to ${s.targetF} °F, hold ${s.holdMin} min`))));
  }
  if (c.tradition) card.append(el('p', { className: 'muted', textContent: `Tradition: ${c.tradition.name} (${c.tradition.region}). ${c.tradition.credit}` }));

  const s = c.safety;
  const safe = [s.general];
  for (const h of s.hazards ?? []) safe.push(`${h.material}: ${h.risk} ${h.handling}`);
  if (s.firingNotes) safe.push(`Fumes: ${s.firingNotes.fumes}`, `Fire: ${s.firingNotes.fire}`, `Burn ban: ${s.firingNotes.burnBan}`, `Gear: ${s.firingNotes.ppe}`);
  if (s.hangingNotes) safe.push(`Holes: ${s.hangingNotes.holes}`, `Weight: ${s.hangingNotes.weight}`, `Wiring: ${s.hangingNotes.wiring}`);
  card.append(el('div', { className: 'rv-safety' }, el('h3', { textContent: 'Safety' }), list(safe)));
  return card;
}

// A one-line summary row for the Library list.
export function hasSafetyNotes(item) {
  const s = item.content.safety;
  return Boolean((s.hazards && s.hazards.length) || s.firingNotes || s.hangingNotes);
}
