import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChallenge, facets, dedupeKey } from '../validate.mjs';

// A known-good challenge. Each test copies it and breaks one thing.
const good = () => ({
  title: 'Three Spouts, One Pitcher',
  summary: 'Throw one pitcher form and give it three different spout shapes.',
  category: 'functional-forms',
  techniques: ['throwing', 'pulled-handles'],
  difficulty: 3,
  timeBand: 'weekend',
  challengeType: 'variation-series',
  seasons: ['any'],
  brief: 'Make three pitchers of the same size and volume, changing only the spout shape each time.',
  constraints: ['Walls no thicker than 1/4 in', 'Same handle on all three'],
  materials: ['Cone 5 stoneware', 'Wooden rib', 'Pottery knife'],
  maxSizeIn: { width: 9, height: 10 },
  glaze: { cone: 5, atmosphere: 'oxidation', status: 'untested-not-food-safe' },
  firing: { type: 'electric-cone5', cone: 5 },
  safety: {
    leadFree: true,
    hazards: [],
    foodSafety: 'untested-not-food-safe',
    general: 'Wear a dust mask when sanding or trimming dry clay, and wipe surfaces damp.',
  },
});

const rakuNotes = {
  fumes: 'Smoke from burning combustibles is irritating. Stay upwind and work outdoors.',
  fire: 'Keep a hose and a fire extinguisher within reach. Clear dry material away from the site.',
  burnBan: 'Check your local burn ban status before every firing.',
  ppe: 'Leather gloves, face shield, long cotton sleeves, and a respirator for the smoke.',
};

test('a good challenge passes with no errors', () => {
  const r = validateChallenge(good());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('schema: safety block is required', () => {
  const c = good(); delete c.safety;
  assert.equal(validateChallenge(c).ok, false);
});

test('schema: leadFree must be true', () => {
  const c = good(); c.safety.leadFree = false;
  assert.equal(validateChallenge(c).ok, false);
});

test('schema: glaze status must be untested-not-food-safe', () => {
  const c = good(); c.glaze.status = 'food-safe';
  assert.equal(validateChallenge(c).ok, false);
});

test('schema: cone 5 glaze is allowed (usual cone), cone 4 is not', () => {
  assert.equal(validateChallenge(good()).ok, true);
  const c = good(); c.glaze.cone = 4;
  assert.equal(validateChallenge(c).ok, false);
});

test('schema: a glaze with foodSafety not-applicable is rejected', () => {
  const c = good(); c.safety.foodSafety = 'not-applicable';
  assert.equal(validateChallenge(c).ok, false);
});

test('lead: a lead compound anywhere is rejected', () => {
  for (const bad of ['Add 20 parts lead bisilicate frit', 'a galena glaze', 'litharge wash', 'red lead']) {
    const c = good(); c.brief = `Make a mug. ${bad} for shine, then fire it.`;
    const r = validateChallenge(c);
    assert.equal(r.ok, false, bad);
    assert.ok(r.errors.some((e) => e.includes('lead-compound')), bad);
  }
});

test('lead: a lead material in the recipe is rejected', () => {
  const c = good();
  c.glaze.recipe = [{ material: 'White lead', parts: 40 }, { material: 'Kaolin', parts: 10 }];
  assert.equal(validateChallenge(c).ok, false);
});

test('lead: "lead-free" and "no lead" are fine, a stray bare "lead" is a warning, not an error', () => {
  const ok = good(); ok.safety.general = 'All materials are lead-free. Wear a dust mask and wipe surfaces damp.';
  const r1 = validateChallenge(ok);
  assert.equal(r1.ok, true);
  assert.equal(r1.warnings.length, 0);
  const odd = good(); odd.brief = 'Use the lead material from the studio shelf to weigh down the piece.';
  const r2 = validateChallenge(odd);
  assert.equal(r2.ok, true);
  assert.ok(r2.warnings.some((w) => w.includes('lead')));
});

test('hazards: barium without a hazard entry fails; with one passes', () => {
  const c = good();
  c.glaze.recipe = [{ material: 'Barium carbonate', parts: 10 }, { material: 'Custer feldspar', parts: 40 }];
  const bad = validateChallenge(c);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('barium')));
  c.safety.hazards = [{ material: 'Barium carbonate', risk: 'Toxic if swallowed or inhaled as dust.', handling: 'Wear a respirator and gloves, wet-clean spills, never use on food surfaces.' }];
  assert.equal(validateChallenge(c).ok, true);
});

test('hazards: lithium via spodumene, chrome, manganese, cobalt, copper are all caught', () => {
  for (const mat of ['Spodumene', 'Chrome oxide', 'Manganese dioxide', 'Cobalt carbonate', 'Copper carbonate']) {
    const c = good(); c.glaze.colorants = [{ material: mat, percent: 2 }];
    assert.equal(validateChallenge(c).ok, false, mat);
  }
});

test('hazards: silica in the materials list needs an entry', () => {
  const c = good(); c.materials.push('Silica (200 mesh)');
  const r = validateChallenge(c);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('silica')));
});

test('alt firing: raku without firingNotes fails; with notes passes', () => {
  const c = good(); delete c.glaze; c.firing = { type: 'raku' };
  c.safety.foodSafety = 'not-applicable';
  const bad = validateChallenge(c);
  assert.equal(bad.ok, false);
  c.safety.firingNotes = rakuNotes;
  assert.equal(validateChallenge(c).ok, true);
});

test('alt firing: pit, obvara and smoke also need firingNotes', () => {
  for (const type of ['pit', 'obvara', 'smoke']) {
    const c = good(); delete c.glaze; c.firing = { type }; c.safety.foodSafety = 'not-applicable';
    assert.equal(validateChallenge(c).ok, false, type);
  }
});

test('alt firing: firingNotes with a blank burn-ban line fails', () => {
  const c = good(); delete c.glaze; c.firing = { type: 'pit' }; c.safety.foodSafety = 'not-applicable';
  c.safety.firingNotes = { ...rakuNotes, burnBan: '' };
  assert.equal(validateChallenge(c).ok, false);
});

test('hanging: wall piece without hangingNotes fails; with notes passes', () => {
  const c = good(); delete c.glaze; delete c.maxSizeIn;
  c.category = 'wall-hanging-light'; c.challengeType = 'hanging'; c.safety.foodSafety = 'not-applicable';
  const bad = validateChallenge(c);
  assert.equal(bad.ok, false);
  c.safety.hangingNotes = {
    holes: 'Pierce two holes at least 1 in from the edge while the clay is leather hard.',
    weight: 'Keep the fired piece under 3 lb and use a wall anchor rated well above that.',
    wiring: 'Not applicable: no electrical parts.',
  };
  assert.equal(validateChallenge(c).ok, true);
});

test('saggar firing is rejected everywhere', () => {
  const c = good(); c.brief = 'Wrap the piece in foil and fire it in a saggar with copper and salt, then see the marks.';
  const r = validateChallenge(c);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('saggar')));
});

test('combustibles in the electric kiln are rejected', () => {
  const c = good(); c.steps = ['Pack sawdust around the pot and fire it inside the electric kiln for a smoky look.'];
  const r = validateChallenge(c);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('combustibles')));
});

test('kiln fit: too wide or too tall for the 1827HE is rejected, outside firings are exempt', () => {
  const wide = good(); wide.maxSizeIn = { width: 17, height: 10 };
  assert.equal(validateChallenge(wide).ok, false);
  const tall = good(); tall.maxSizeIn = { width: 10, height: 23 };
  assert.equal(validateChallenge(tall).ok, false);
  const edge = good(); edge.maxSizeIn = { width: 16, height: 22 };
  assert.equal(validateChallenge(edge).ok, true);
  const raku = good(); delete raku.glaze; raku.firing = { type: 'raku' }; raku.safety.foodSafety = 'not-applicable';
  raku.safety.firingNotes = rakuNotes; raku.maxSizeIn = { width: 20, height: 30 };
  assert.equal(validateChallenge(raku).ok, true);
});

test('reduction effect with no workaround is flagged for review', () => {
  const c = good(); c.brief = 'Try for a copper red look with a deep oxblood glaze on three bowls.';
  c.safety.hazards = [{ material: 'Copper carbonate', risk: 'Can irritate and is toxic if ingested.', handling: 'Wear gloves and a respirator when mixing.' }];
  const r = validateChallenge(c);
  assert.ok(r.warnings.some((w) => w.includes('reduction-style')));
  c.steps = ['Use silicon carbide in the glaze for local reduction in the electric kiln.'];
  assert.equal(validateChallenge(c).warnings.some((w) => w.includes('reduction-style')), false);
});

test('taxonomy: unknown category, technique and firing type are rejected', () => {
  const a = good(); a.category = 'basket-weaving'; assert.equal(validateChallenge(a).ok, false);
  const b = good(); b.techniques = ['levitation']; assert.equal(validateChallenge(b).ok, false);
  const c = good(); c.firing = { type: 'wood-kiln' }; assert.equal(validateChallenge(c).ok, false);
});

test('held-back glaze chemistry category validates but warns', () => {
  const c = good(); c.category = 'glaze-chemistry'; c.challengeType = 'glaze-chemistry';
  const r = validateChallenge(c);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes('held back')));
});

test('extra unknown fields are rejected', () => {
  const c = good(); c.sneaky = 'x';
  assert.equal(validateChallenge(c).ok, false);
});

test('facets and dedupeKey', () => {
  const f = facets(good());
  assert.equal(f.category, 'functional-forms');
  assert.equal(f.firing, 'electric-cone5');
  assert.equal(f.hasGlaze, true);
  assert.equal(dedupeKey({ title: 'Three Spouts, One Pitcher!' }), 'three spouts one pitcher');
});
