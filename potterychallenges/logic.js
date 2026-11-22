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

// ---------- photos ----------
// Scale a width and height down so the longest side is at most `max` (never up).
export function scaleToFit(w, h, max) {
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// Looks inside a JPEG for hidden metadata that could carry a location: EXIF (where GPS lives),
// XMP, and Photoshop/IPTC blocks. Re-drawing a photo onto a canvas drops all of it, and this
// is the check that proves it before anything is uploaded. Walks the segment headers only.
export function inspectJpeg(bytes) {
  const out = { isJpeg: false, sensitive: [] };
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return out;
  out.isJpeg = true;
  const ascii = (start, n) => { let s = ''; for (let k = 0; k < n && start + k < bytes.length; k++) s += String.fromCharCode(bytes[start + k]); return s; };
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }                                   // fill byte
    if (marker === 0xda || marker === 0xd9) break;                               // image data starts: no more headers
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; } // markers with no length
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    const body = i + 4;
    if (marker === 0xe1) {
      const head = ascii(body, 30);
      if (head.startsWith('Exif')) out.sensitive.push('EXIF');
      else if (head.startsWith('http://ns.adobe.com/xap')) out.sensitive.push('XMP');
      else out.sensitive.push('APP1');
    } else if (marker === 0xed) out.sensitive.push('PHOTOSHOP');
    i += 2 + len;
  }
  return out;
}

// Cuts the EXIF/XMP (APP1) and Photoshop (APP13) blocks out of a JPEG without touching the
// picture itself: every other header and all of the image data are copied across byte for byte.
// Some browsers write a small EXIF block of their own when saving a canvas, so the app strips
// first and then runs inspectJpeg() as proof. Returns null if the data is not a sound JPEG.
export function stripJpegMetadata(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const keep = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;                                          // not where a header should start
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }                                   // fill byte
    if (marker === 0xda || marker === 0xd9) break;                               // image data (or the end) starts here
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { keep.push(bytes.subarray(i, i + 2)); i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;                      // damaged header
    if (marker !== 0xe1 && marker !== 0xed) keep.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  keep.push(bytes.subarray(i));                                                  // image data to the end, untouched
  const out = new Uint8Array(keep.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of keep) { out.set(c, at); at += c.length; }
  return out;
}
