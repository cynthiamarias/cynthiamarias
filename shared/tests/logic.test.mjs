import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVisible, matches, pool, pick, pushRecent, dots, NO_FILTERS, STAGES, STAGE_LABEL, isOpen, toMs, queueOf, historyOf, nextOrder, findOpenFor, swapTarget, dateFromInput, inputFromDate, scaleToFit, inspectJpeg, stripJpegMetadata, mineItem, isMineId, docIdOfMine, MINE_PREFIX, isVisible as isVisible2 } from '../../potterychallenges/logic.js';

const mk = (id, over = {}) => ({ id, category: 'functional-forms', difficulty: 3, timeBand: 'weekend', firing: 'electric-cone5', seasons: ['any'], ...over });

test('everything normal is visible by default; raku is on, other outside firings are hidden', () => {
  assert.equal(isVisible(mk('a')), true);
  assert.equal(isVisible(mk('a', { firing: 'bisque-only' })), true);
  assert.equal(isVisible(mk('a', { firing: 'none' })), true);
  assert.equal(isVisible(mk('a', { firing: 'raku' })), true);
  for (const f of ['pit', 'obvara', 'smoke']) assert.equal(isVisible(mk('a', { firing: f })), false, f);
});

test('turning an outside firing on in the profile reveals it', () => {
  const profile = { firingsAvailable: ['raku', 'obvara'] };
  assert.equal(isVisible(mk('a', { firing: 'obvara' }), profile), true);
  assert.equal(isVisible(mk('a', { firing: 'pit' }), profile), false);
});

test('an explicit empty list hides even raku (it is a real choice, not a default)', () => {
  assert.equal(isVisible(mk('a', { firing: 'raku' }), { firingsAvailable: [] }), false);
});

test('from-scratch glaze chemistry stays hidden until the profile allows it', () => {
  const c = mk('a', { category: 'glaze-chemistry' });
  assert.equal(isVisible(c), false);
  assert.equal(isVisible(c, { mixesOwnGlazes: true }), true);
});

test('filters combine, and "any" means no restriction', () => {
  const c = mk('a', { category: 'seasonal', difficulty: 2, timeBand: 'one-session', seasons: ['christmas', 'winter'] });
  assert.equal(matches(c, NO_FILTERS), true);
  assert.equal(matches(c, { ...NO_FILTERS, category: 'seasonal' }), true);
  assert.equal(matches(c, { ...NO_FILTERS, category: 'slab-work' }), false);
  assert.equal(matches(c, { ...NO_FILTERS, difficulty: '2' }), true);
  assert.equal(matches(c, { ...NO_FILTERS, difficulty: '3' }), false);
  assert.equal(matches(c, { ...NO_FILTERS, timeBand: 'weekend' }), false);
  assert.equal(matches(c, { ...NO_FILTERS, season: 'christmas' }), true);
  assert.equal(matches(c, { category: 'seasonal', difficulty: '2', timeBand: 'one-session', season: 'winter' }), true);
});

test('a season filter excludes all-year challenges and ones with no seasons field', () => {
  assert.equal(matches(mk('a', { seasons: ['any'] }), { ...NO_FILTERS, season: 'winter' }), false);
  assert.equal(matches(mk('a', { seasons: undefined }), { ...NO_FILTERS, season: 'winter' }), false);
  assert.equal(matches(mk('a', { seasons: undefined }), NO_FILTERS), true);
});

test('pool applies visibility and filters together', () => {
  const all = [mk('1'), mk('2', { firing: 'pit' }), mk('3', { difficulty: 5 }), mk('4', { firing: 'raku', difficulty: 5 })];
  assert.deepEqual(pool(all, {}, NO_FILTERS).map((c) => c.id), ['1', '3', '4']);
  assert.deepEqual(pool(all, {}, { ...NO_FILTERS, difficulty: '5' }).map((c) => c.id), ['3', '4']);
  assert.deepEqual(pool(all, { firingsAvailable: ['raku', 'pit'] }, NO_FILTERS).map((c) => c.id), ['1', '2', '3', '4']);
});

test('pick: nothing to pick gives null', () => {
  assert.equal(pick([]), null);
});

test('pick: avoids recent ones while there are others', () => {
  const c = [mk('1'), mk('2'), mk('3')];
  for (let i = 0; i < 50; i++) assert.notEqual(pick(c, ['1', '2'], Math.random).id, '1');
  for (let i = 0; i < 50; i++) assert.equal(pick(c, ['1', '2'], Math.random).id, '3');
});

test('pick: when everything is recent it still returns something', () => {
  const c = [mk('1'), mk('2')];
  assert.ok(['1', '2'].includes(pick(c, ['1', '2']).id));
  assert.equal(pick([mk('only')], ['only']).id, 'only');
});

test('pick: handles the extreme random values without running off the end', () => {
  const c = [mk('1'), mk('2'), mk('3')];
  assert.equal(pick(c, [], () => 0).id, '1');
  assert.equal(pick(c, [], () => 0.999999).id, '3');
  assert.equal(pick(c, [], () => 1).id, '3');
});

test('pick is roughly uniform', () => {
  const c = [mk('1'), mk('2'), mk('3'), mk('4')];
  const seen = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < 4000; i++) seen[pick(c).id]++;
  for (const n of Object.values(seen)) assert.ok(n > 800 && n < 1200, JSON.stringify(seen));
});

test('pushRecent keeps the last five, moves repeats to the end, never duplicates', () => {
  let r = [];
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) r = pushRecent(r, id);
  assert.deepEqual(r, ['c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
});

test('dots', () => {
  assert.equal(dots(1), '●○○○○');
  assert.equal(dots(5), '●●●●●');
});

// ---------- projects ----------
const proj = (id, over = {}) => ({ id, challengeId: `c-${id}`, stage: 'planned', queueOrder: Number(id), ...over });

test('the eight stages are exactly the agreed list, in order, each with a label', () => {
  assert.deepEqual(STAGES, ['planned', 'made', 'drying', 'bisque-ready', 'bisque-fired', 'glazed', 'glaze-fired', 'done']);
  for (const s of STAGES) assert.ok(STAGE_LABEL[s], s);
});

test('only "done" counts as finished', () => {
  for (const s of STAGES) assert.equal(isOpen({ stage: s }), s !== 'done', s);
});

test('toMs understands timestamps, dates, numbers and nothing', () => {
  assert.equal(toMs({ toMillis: () => 5 }), 5);
  assert.equal(toMs(new Date(7)), 7);
  assert.equal(toMs(9), 9);
  assert.equal(toMs(null), 0);
  assert.equal(toMs(undefined), 0);
  assert.equal(toMs({}), 0);
});

test('the queue holds unfinished projects in the person\'s order, and leaves done ones out', () => {
  const ps = [proj('3'), proj('1'), proj('2', { stage: 'done' }), proj('4', { stage: 'drying' })];
  assert.deepEqual(queueOf(ps).map((p) => p.id), ['1', '3', '4']);
});

test('history is finished projects, newest first, and a missing date sorts last', () => {
  const ps = [
    proj('1', { stage: 'done', completedAt: 100 }),
    proj('2', { stage: 'done', completedAt: 300 }),
    proj('3', { stage: 'done' }),
    proj('4', { stage: 'done', completedAt: { toMillis: () => 200 } }),
    proj('5'),
  ];
  assert.deepEqual(historyOf(ps).map((p) => p.id), ['2', '4', '1', '3']);
});

test('nextOrder goes after the largest existing order, and starts at 1', () => {
  assert.equal(nextOrder([]), 1);
  assert.equal(nextOrder([proj('1'), proj('7'), proj('3')]), 8);
  assert.equal(nextOrder([{ id: 'x' }]), 1);
});

test('findOpenFor finds an unfinished project for a challenge but ignores finished ones', () => {
  const ps = [proj('1', { challengeId: 'a', stage: 'done' }), proj('2', { challengeId: 'a' }), proj('3', { challengeId: 'b' })];
  assert.equal(findOpenFor(ps, 'a').id, '2');
  assert.equal(findOpenFor(ps, 'b').id, '3');
  assert.equal(findOpenFor(ps, 'zzz'), null);
  assert.equal(findOpenFor([proj('1', { challengeId: 'a', stage: 'done' })], 'a'), null);
});

test('swapTarget picks the neighbour, and nothing past either end', () => {
  const q = queueOf([proj('1'), proj('2'), proj('3')]);
  assert.equal(swapTarget(q, '2', -1).id, '1');
  assert.equal(swapTarget(q, '2', 1).id, '3');
  assert.equal(swapTarget(q, '1', -1), null);
  assert.equal(swapTarget(q, '3', 1), null);
  assert.equal(swapTarget(q, 'missing', 1), null);
});

test('moving swaps the two order values, so the queue really changes', () => {
  const ps = [proj('1'), proj('2'), proj('3')];
  const a = ps[1], b = swapTarget(queueOf(ps), '2', -1);
  [a.queueOrder, b.queueOrder] = [b.queueOrder, a.queueOrder];
  assert.deepEqual(queueOf(ps).map((p) => p.id), ['2', '1', '3']);
});

test('date pickers: a chosen day becomes noon local time, round-trips, and bad input is rejected', () => {
  const d = dateFromInput('2026-11-22');
  assert.equal(d.getHours(), 12);
  assert.equal(inputFromDate(d), '2026-11-22');
  assert.equal(dateFromInput('2026-12-31').getDate(), 31);
  assert.equal(dateFromInput('2024-02-29').getMonth(), 1);
  for (const bad of ['', null, undefined, 'tomorrow', '2026-13-45x', '22-11-2026', '2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31']) assert.equal(dateFromInput(bad), null, String(bad));
});

// ---------- photos ----------
test('scaleToFit shrinks the long side to the limit, keeps the shape, and never enlarges', () => {
  assert.deepEqual(scaleToFit(4000, 3000, 2048), { width: 2048, height: 1536 });
  assert.deepEqual(scaleToFit(3000, 4000, 2048), { width: 1536, height: 2048 });
  assert.deepEqual(scaleToFit(1000, 800, 2048), { width: 1000, height: 800 });
  assert.deepEqual(scaleToFit(2048, 2048, 2048), { width: 2048, height: 2048 });
  assert.deepEqual(scaleToFit(4000, 3000, 480), { width: 480, height: 360 });
  assert.deepEqual(scaleToFit(10000, 1, 480), { width: 480, height: 1 });
});

// Build a tiny fake JPEG: start marker, the listed segments, then image data and an end marker.
const seg = (marker, text, pad = 0) => {
  const body = [...Buffer.from(text, 'latin1'), ...Array(pad).fill(0)];
  const len = body.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...body];
};
const jpeg = (...segments) => new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 1, 2, 3, 0xff, 0xd9]);
const JFIF = seg(0xe0, 'JFIF\0', 9);

test('a plain JPEG with just a JFIF header is clean', () => {
  const r = inspectJpeg(jpeg(JFIF));
  assert.equal(r.isJpeg, true);
  assert.deepEqual(r.sensitive, []);
});

test('EXIF (where GPS lives) is found', () => {
  const r = inspectJpeg(jpeg(JFIF, seg(0xe1, 'Exif\0\0MM GPSLatitude 37.77 GPSLongitude -122.41', 20)));
  assert.deepEqual(r.sensitive, ['EXIF']);
});

test('EXIF is found even when it comes first, with no JFIF header', () => {
  assert.deepEqual(inspectJpeg(jpeg(seg(0xe1, 'Exif\0\0', 30))).sensitive, ['EXIF']);
});

test('XMP, Photoshop blocks and unknown APP1 data are all flagged', () => {
  assert.deepEqual(inspectJpeg(jpeg(seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'))).sensitive, ['XMP']);
  assert.deepEqual(inspectJpeg(jpeg(seg(0xed, 'Photoshop 3.0\0', 10))).sensitive, ['PHOTOSHOP']);
  assert.deepEqual(inspectJpeg(jpeg(seg(0xe1, 'MysteryData'))).sensitive, ['APP1']);
});

test('several kinds together are all reported', () => {
  const r = inspectJpeg(jpeg(JFIF, seg(0xe1, 'Exif\0\0abc'), seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0x'), seg(0xed, 'Photoshop 3.0\0')));
  assert.deepEqual(r.sensitive, ['EXIF', 'XMP', 'PHOTOSHOP']);
});

test('comments and colour profiles are not treated as sensitive', () => {
  assert.deepEqual(inspectJpeg(jpeg(JFIF, seg(0xfe, 'a harmless comment'), seg(0xe2, 'ICC_PROFILE\0', 20))).sensitive, []);
});

test('text that merely looks like EXIF inside the image data is ignored', () => {
  const bytes = new Uint8Array([0xff, 0xd8, ...JFIF, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00, ...Buffer.from('Exif\0\0 GPS'), 0xff, 0xd9]);
  assert.deepEqual(inspectJpeg(bytes).sensitive, []);
});

test('non-JPEG data, empty data and truncated data never crash', () => {
  assert.equal(inspectJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])).isJpeg, false); // PNG header
  assert.equal(inspectJpeg(new Uint8Array([])).isJpeg, false);
  assert.equal(inspectJpeg(null).isJpeg, false);
  assert.equal(inspectJpeg(new Uint8Array([0xff, 0xd8])).isJpeg, false);
  const cut = jpeg(JFIF, seg(0xe1, 'Exif\0\0xxxxxxxxxxxxxxxx')).slice(0, 30);
  assert.doesNotThrow(() => inspectJpeg(cut));
  assert.deepEqual(inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x45])).sensitive, []); // bogus zero length
});

// ---------- stripping metadata ----------
const tail = (b) => b.slice(b.length - 14);

test('stripping removes EXIF, XMP and Photoshop blocks and the result passes the checker', () => {
  const dirty = jpeg(JFIF, seg(0xe1, 'Exif\0\0MM GPSLatitude 37.77 GPSLongitude -122.41', 20), seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x/>'), seg(0xed, 'Photoshop 3.0\0', 10));
  assert.deepEqual(inspectJpeg(dirty).sensitive, ['EXIF', 'XMP', 'PHOTOSHOP']);
  const clean = stripJpegMetadata(dirty);
  assert.ok(clean);
  assert.equal(inspectJpeg(clean).isJpeg, true);
  assert.deepEqual(inspectJpeg(clean).sensitive, []);
  assert.ok(clean.length < dirty.length);
});

test('the location text is really gone from the bytes, not just hidden from the checker', () => {
  const dirty = jpeg(JFIF, seg(0xe1, 'Exif\0\0GPSLatitude 37.77 GPSLongitude -122.41', 20));
  const text = Buffer.from(stripJpegMetadata(dirty)).toString('latin1');
  assert.equal(text.includes('GPS'), false);
  assert.equal(text.includes('Exif'), false);
  assert.equal(text.includes('37.77'), false);
});

test('stripping keeps the other headers and the image data exactly as they were', () => {
  const icc = seg(0xe2, 'ICC_PROFILE\0', 20);
  const dirty = jpeg(JFIF, seg(0xe1, 'Exif\0\0abc'), icc, seg(0xfe, 'hello'));
  const clean = stripJpegMetadata(dirty);
  const text = Buffer.from(clean).toString('latin1');
  assert.ok(text.includes('JFIF'));
  assert.ok(text.includes('ICC_PROFILE'));
  assert.ok(text.includes('hello'));
  assert.deepEqual([...tail(clean)], [...tail(dirty)], 'the image data and end marker must be identical');
});

test('stripping an already clean JPEG changes nothing, and stripping twice is the same as once', () => {
  const clean = jpeg(JFIF, seg(0xfe, 'ok'));
  assert.deepEqual([...stripJpegMetadata(clean)], [...clean]);
  const dirty = jpeg(JFIF, seg(0xe1, 'Exif\0\0abc'));
  const once = stripJpegMetadata(dirty);
  assert.deepEqual([...stripJpegMetadata(once)], [...once]);
});

test('stripping works when the EXIF block comes first, last, or alone', () => {
  for (const segs of [[seg(0xe1, 'Exif\0\0a')], [seg(0xe1, 'Exif\0\0a'), JFIF], [JFIF, seg(0xe1, 'Exif\0\0a')]]) {
    assert.deepEqual(inspectJpeg(stripJpegMetadata(jpeg(...segs))).sensitive, []);
  }
});

test('stripping refuses data that is not a sound JPEG instead of guessing', () => {
  assert.equal(stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])), null);
  assert.equal(stripJpegMetadata(new Uint8Array([])), null);
  assert.equal(stripJpegMetadata(null), null);
  assert.equal(stripJpegMetadata(jpeg(seg(0xe1, 'Exif\0\0abcdefgh')).slice(0, 12)), null);          // cut off mid-header
  assert.equal(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x45, 0x00])), null); // zero length
  assert.equal(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78])), null);              // junk after the start
});

test('EXIF-looking text inside the image data is left alone (it is picture data, not a header)', () => {
  const bytes = new Uint8Array([0xff, 0xd8, ...JFIF, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00, ...Buffer.from('Exif\0\0 GPS'), 0xff, 0xd9]);
  assert.deepEqual([...stripJpegMetadata(bytes)], [...bytes]);
});

// ---------- challenges you made yourself ----------
test('a saved challenge of your own gets a safe id, and can be told apart from a library one', () => {
  const m = mineItem('abc123', { status: 'saved', category: 'functional-forms', firing: 'electric-cone5', content: { title: 'T' }, number: 99 });
  assert.equal(m.id, 'my-abc123');
  assert.equal(m.docId, 'abc123');
  assert.equal(m.isMine, true);
  assert.equal(m.number, null, 'it never has a public number');
  assert.equal(m.content.title, 'T');
  assert.equal(isMineId('my-abc123'), true);
  assert.equal(isMineId('abc123'), false);
  assert.equal(isMineId(undefined), false);
  assert.equal(isMineId(42), false);
  assert.equal(docIdOfMine('my-abc123'), 'abc123');
  assert.equal(docIdOfMine('abc123'), null);
  assert.equal(MINE_PREFIX, 'my-');
});

test('your own challenges follow the same firing and glaze-chemistry hiding as library ones', () => {
  assert.equal(isVisible2(mineItem('1', { category: 'alt-firing', firing: 'pit' })), false);
  assert.equal(isVisible2(mineItem('1', { category: 'alt-firing', firing: 'raku' })), true);
  assert.equal(isVisible2(mineItem('1', { category: 'glaze-chemistry', firing: 'electric-cone5' })), false);
  assert.equal(isVisible2(mineItem('1', { category: 'glaze-chemistry', firing: 'electric-cone5' }), { mixesOwnGlazes: true }), true);
});
