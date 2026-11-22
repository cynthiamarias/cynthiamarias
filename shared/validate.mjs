// Validates one challenge's `content` object: JSON schema, taxonomy, then the safety lint.
// Used by the seed pipeline now and by the remix Cloud Function later (same rules both places).
// To swap in a different challenge schema: replace challenge.schema.json and facets() below.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const here = (f) => new URL(f, import.meta.url);
const load = (f) => JSON.parse(readFileSync(here(f), 'utf8'));

const schema = load('./challenge.schema.json');
const taxonomy = load('./taxonomy.json');
const rules = load('./safety-rules.json');

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
const validateSchema = ajv.compile(schema);

const re = (pattern) => new RegExp(pattern, 'i');
const bannedAnywhere = rules.bannedAnywhere.map((r) => ({ ...r, re: re(r.pattern) }));
const hazardRules = rules.requiredHazardNotes.map((r) => ({ ...r, re: re(r.pattern) }));
const bareLead = re(rules.bareLeadWarning.pattern);
const reduction = re(rules.reductionPattern);
const reductionFix = re(rules.reductionWorkaroundPattern);

// Every string in the object with its path, so rules can say where they matched.
function strings(value, path = '', out = []) {
  if (typeof value === 'string') out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

// What the app filters and sorts on. Kept next to the schema on purpose.
export function facets(c) {
  return {
    category: c.category,
    techniques: c.techniques,
    difficulty: c.difficulty,
    challengeType: c.challengeType,
    timeBand: c.timeBand,
    seasons: c.seasons ?? ['any'],
    firing: c.firing?.type ?? 'none',
    hasGlaze: Boolean(c.glaze),
    cone10Optional: Boolean(c.glaze?.cone10Optional || c.firing?.cone10Optional),
  };
}

export function dedupeKey(c) {
  return c.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Returns { ok, errors, warnings }. ok is false if there is any error.
export function validateChallenge(c) {
  const errors = [];
  const warnings = [];

  // 1. Schema
  if (!validateSchema(c)) {
    for (const e of validateSchema.errors) errors.push(`schema: ${e.instancePath || '/'} ${e.message}`);
    return { ok: false, errors, warnings }; // later checks assume the shape is right
  }

  // 2. Taxonomy
  const catIds = taxonomy.categories.map((x) => x.id);
  if (!catIds.includes(c.category)) errors.push(`taxonomy: unknown category "${c.category}"`);
  for (const t of c.techniques) {
    if (!taxonomy.techniques.includes(t)) errors.push(`taxonomy: unknown technique "${t}"`);
  }
  if (!taxonomy.challengeTypes.includes(c.challengeType)) errors.push(`taxonomy: unknown challengeType "${c.challengeType}"`);
  if (!taxonomy.timeBands.includes(c.timeBand)) errors.push(`taxonomy: unknown timeBand "${c.timeBand}"`);
  for (const s of c.seasons ?? []) {
    if (!taxonomy.seasons.includes(s)) errors.push(`taxonomy: unknown season "${s}"`);
  }
  if (c.firing && !(c.firing.type in taxonomy.firingTypes)) errors.push(`taxonomy: unknown firing type "${c.firing.type}"`);
  const heldBack = taxonomy.categories.find((x) => x.id === c.category)?.heldBack;
  if (heldBack) warnings.push(`held back: category "${c.category}" is off until the studio profile turns it on`);

  // 3. Safety lint
  const all = strings(c);
  const text = all.filter((s) => !s.path.endsWith('.atmosphere') && s.path !== 'atmosphere');
  const outsideHazards = text.filter((s) => !s.path.startsWith('safety.hazards'));

  for (const rule of bannedAnywhere) {
    for (const s of all) {
      const m = s.text.match(rule.re);
      if (m) errors.push(`safety: ${rule.id} ("${m[0]}" at ${s.path}). ${rule.reason}`);
    }
  }

  for (const s of all) {
    const m = bareLead.exec(s.text);
    if (!m) continue;
    const window = s.text.slice(Math.max(0, m.index - 10), m.index + 14).toLowerCase();
    if (!rules.bareLeadWarning.allowedContexts.some((ctx) => window.includes(ctx))) {
      warnings.push(`review: bare word "lead" at ${s.path}. ${rules.bareLeadWarning.reason}`);
    }
  }

  const materialStrings = [
    ...(c.materials ?? []).map((text, i) => ({ path: `materials[${i}]`, text })),
    ...(c.glaze?.recipe ?? []).map((r, i) => ({ path: `glaze.recipe[${i}]`, text: r.material })),
    ...(c.glaze?.colorants ?? []).map((r, i) => ({ path: `glaze.colorants[${i}]`, text: r.material })),
  ];
  for (const rule of hazardRules) {
    const haystack = rule.scope === 'materials' ? materialStrings : outsideHazards;
    if (!haystack.some((s) => rule.re.test(s.text))) continue;
    if (!c.safety.hazards.some((h) => rule.re.test(h.material))) {
      errors.push(`safety: "${rule.id}" is used but has no entry in safety.hazards`);
    }
  }

  const needsFiringNotes = c.firing && rules.firingsNeedingFiringNotes.includes(c.firing.type);
  if (needsFiringNotes && !c.safety.firingNotes) errors.push(`safety: ${c.firing.type} firing requires safety.firingNotes`);
  const needsHanging = c.challengeType === 'hanging' || c.category === 'wall-hanging-light';
  if (needsHanging && !c.safety.hangingNotes) errors.push('safety: hanging or wall pieces require safety.hangingNotes');

  if (c.glaze && c.safety.foodSafety !== 'untested-not-food-safe') {
    errors.push('safety: every glaze recipe must be marked untested-not-food-safe');
  }

  // Kiln fit (electric kiln pieces only)
  const outside = c.firing ? Boolean(taxonomy.firingTypes[c.firing.type]?.outsideKiln) : false;
  if (c.maxSizeIn && !outside) {
    if (c.maxSizeIn.width > rules.kiln.maxFiredWidthIn) errors.push(`kiln: width ${c.maxSizeIn.width} in is over the ${rules.kiln.maxFiredWidthIn} in limit`);
    if (c.maxSizeIn.height > rules.kiln.maxFiredHeightIn) errors.push(`kiln: height ${c.maxSizeIn.height} in is over the ${rules.kiln.maxFiredHeightIn} in limit`);
  }

  // Electric kiln is oxidation only
  const prose = text.map((s) => s.text).join(' \n ');
  if (reduction.test(prose) && !reductionFix.test(prose)) {
    warnings.push('review: reduction-style effect with no workaround (local reduction, silicon carbide, or an outside firing)');
  }

  return { ok: errors.length === 0, errors, warnings };
}
