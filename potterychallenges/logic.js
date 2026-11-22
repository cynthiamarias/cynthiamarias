// Pure logic for what to show and what to draw. No Firebase and no page code in here,
// so it can be tested on its own (see shared/tests/logic.test.mjs).

// Firings that happen outside the electric kiln. Challenges that need one are hidden unless
// the person has said they can do it (users/{uid}.firingsAvailable).
export const OUTSIDE_FIRINGS = ['raku', 'pit', 'obvara', 'smoke'];
export const DEFAULT_FIRINGS = ['raku'];

export const NO_FILTERS = { category: 'any', difficulty: 'any', timeBand: 'any', season: 'any' };

// Should this approved challenge be offered to this person at all?
export function isVisible(c, profile = {}) {
  const available = Array.isArray(profile.firingsAvailable) ? profile.firingsAvailable : DEFAULT_FIRINGS;
  if (c.category === 'glaze-chemistry' && !profile.mixesOwnGlazes) return false;
  if (OUTSIDE_FIRINGS.includes(c.firing) && !available.includes(c.firing)) return false;
  return true;
}

export function matches(c, f = NO_FILTERS) {
  if (f.category !== 'any' && c.category !== f.category) return false;
  if (f.difficulty !== 'any' && c.difficulty !== Number(f.difficulty)) return false;
  if (f.timeBand !== 'any' && c.timeBand !== f.timeBand) return false;
  // A season filter shows only challenges tagged for that season, not the all-year ones.
  if (f.season !== 'any' && !(c.seasons ?? []).includes(f.season)) return false;
  return true;
}

export function pool(challenges, profile, filters) {
  return challenges.filter((c) => isVisible(c, profile) && matches(c, filters));
}

// Random pick that avoids the most recent ones when there is anything else to show.
export function pick(candidates, recentIds = [], rand = Math.random) {
  if (!candidates.length) return null;
  const fresh = candidates.filter((c) => !recentIds.includes(c.id));
  const from = fresh.length ? fresh : candidates;
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
}

export function pushRecent(recent, id, max = 5) {
  return [...recent.filter((x) => x !== id), id].slice(-max);
}

export const dots = (n) => '●'.repeat(n) + '○'.repeat(5 - n);

// ---------- projects: one record per attempt at a challenge ----------
// A project is the queue entry, the stage tracker and the completion record all in one.
export const STAGES = ['planned', 'made', 'drying', 'bisque-ready', 'bisque-fired', 'glazed', 'glaze-fired', 'done'];
export const STAGE_LABEL = {
  planned: 'Planned', made: 'Made', drying: 'Drying', 'bisque-ready': 'Bisque-ready',
  'bisque-fired': 'Bisque-fired', glazed: 'Glazed', 'glaze-fired': 'Glaze-fired', done: 'Done',
};
export const OCCASIONS = ['Gift', 'Birthday', 'Christmas', 'Craft fair', 'Other'];

export const isOpen = (p) => p.stage !== 'done';

// Firestore timestamps, Dates and plain milliseconds all become milliseconds.
export const toMs = (t) => (t == null ? 0 : typeof t === 'number' ? t : t instanceof Date ? t.getTime() : typeof t.toMillis === 'function' ? t.toMillis() : 0);

// The up-next queue: everything not finished, in the order the person set.
export const queueOf = (projects) => projects.filter(isOpen).sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0));

// Finished work, newest first.
export const historyOf = (projects) => projects.filter((p) => !isOpen(p)).sort((a, b) => toMs(b.completedAt) - toMs(a.completedAt));

export const nextOrder = (projects) => projects.reduce((m, p) => Math.max(m, p.queueOrder ?? 0), 0) + 1;

// Is there already an unfinished project for this challenge?
export const findOpenFor = (projects, challengeId) => projects.find((p) => p.challengeId === challengeId && isOpen(p)) ?? null;

// Which project does this one swap places with when moved up (-1) or down (+1)? null at the ends.
export function swapTarget(queue, id, dir) {
  const i = queue.findIndex((p) => p.id === id);
  if (i < 0) return null;
  return queue[i + dir] ?? null;
}

// "2026-11-22" from a date picker -> a Date at noon local time, so time zones never shift the day.
export function dateFromInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  // Reject days that do not exist (Feb 31 would otherwise roll over to Mar 3).
  return Number.isNaN(d.getTime()) || inputFromDate(d) !== value ? null : d;
}
export const inputFromDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
