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
