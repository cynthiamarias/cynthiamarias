// Claude's structured output supports only part of JSON Schema: no length or number limits, no
// if/then rules, no "$schema". So the schema sent to Claude is a simplified copy, with the
// allowed values (categories, techniques, ...) filled in from the taxonomy. Everything that
// was dropped is still enforced afterwards by validate.mjs, so nothing gets weaker.
const DROP = new Set([
  '$schema', '$id', 'title', 'description',
  'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'uniqueItems', 'if', 'then', 'else', 'allOf',
]);

function walk(node) {
  if (Array.isArray(node)) return node.map(walk);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, walk(sub)])); // a property may be called "title"
    else if (!DROP.has(k)) out[k] = walk(v);
  }
  return out;
}

export function structuredSchema(schema, taxonomy, { mixesOwnGlazes = false } = {}) {
  const s = walk(schema);
  const p = s.properties;
  p.category = { type: 'string', enum: taxonomy.categories.filter((c) => mixesOwnGlazes || !c.heldBack).map((c) => c.id) };
  p.techniques = { type: 'array', items: { type: 'string', enum: taxonomy.techniques } };
  p.challengeType = { type: 'string', enum: taxonomy.challengeTypes };
  p.timeBand = { type: 'string', enum: taxonomy.timeBands };
  p.seasons = { type: 'array', items: { type: 'string', enum: taxonomy.seasons } };
  p.firing.properties.type = { type: 'string', enum: Object.keys(taxonomy.firingTypes) };
  return s;
}
