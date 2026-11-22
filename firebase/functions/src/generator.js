// The heart of Create and Remix. It does not know about HTTP or about Firebase's function
// wrapper, so it can be tested with a fake Claude and the local Firestore emulator.
//
// Order of work for every call:
//   1. check the input        2. is this person on the allowlist?   3. is the feature switched on?
//   4. reserve a call against the daily cap and the monthly cost ceiling (one transaction)
//   5. ask Claude (shared prompt cached, structured JSON back)
//   6. run the schema + safety check; on failure retry once with the problems listed
//   7. record the real cost    8. save the result as a private draft
import { FieldValue } from 'firebase-admin/firestore';
import { validateChallenge, facets, dedupeKey } from '../shared/validate.mjs';
import { PRESETS, buildUserText } from './prompts.js';
import { costUsd, addUsage, emptyUsage } from './cost.js';
import { structuredSchema } from './structured.js';

export class GenError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const DEFAULTS = {
  defaultDailyApiCap: 5,
  monthlyCostCeilingUsd: 2,
  remixEnabled: true,
  model: 'claude-opus-5-5',
  promptVersion: '0.1',
  timezone: 'America/Los_Angeles',
  effort: 'low',
  maxTokens: 8000,
};
const SCHEMA_VERSION = 1;
const MAX_ATTEMPTS = 2;

const dayKeyOf = (date, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function createGenerator({ db, anthropic, schema, taxonomy, systemText, now = () => new Date() }) {
  // ---------- 1. input ----------
  function checkInput(mode, input) {
    if (!input || typeof input !== 'object') throw new GenError('invalid-argument', 'Missing request.');
    if (mode === 'create') {
      const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
      if (prompt.length < 3) throw new GenError('invalid-argument', 'Tell me a little about what you want to make.');
      if (prompt.length > 300) throw new GenError('invalid-argument', 'Keep the request under 300 characters.');
      const hints = {};
      if (input.hints?.timeBand != null) {
        if (!taxonomy.timeBands.includes(input.hints.timeBand)) throw new GenError('invalid-argument', 'Unknown time choice.');
        hints.timeBand = input.hints.timeBand;
      }
      if (input.hints?.difficulty != null) {
        const d = Number(input.hints.difficulty);
        if (!Number.isInteger(d) || d < 1 || d > 5) throw new GenError('invalid-argument', 'Difficulty must be 1 to 5.');
        hints.difficulty = d;
      }
      return { prompt, hints };
    }
    const src = input.source;
    if (!src || !['library', 'mine'].includes(src.type) || typeof src.id !== 'string' || !src.id || src.id.length > 128 || src.id.includes('/')) {
      throw new GenError('invalid-argument', 'Pick a challenge to remix.');
    }
    if (!(input.preset in PRESETS)) throw new GenError('invalid-argument', 'Unknown remix choice.');
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > 300) throw new GenError('invalid-argument', 'Keep the note under 300 characters.');
    return { source: src, preset: input.preset, presetText: PRESETS[input.preset], note };
  }

  // ---------- 4. daily cap + monthly ceiling ----------
  async function reserve(uid, cap, ceiling, dayKey, monthKey) {
    const dayRef = db.doc(`usage/${uid}/days/${dayKey}`);
    const monthRef = db.doc(`usageGlobal/${monthKey}`);
    return db.runTransaction(async (tx) => {
      const [d, m] = await Promise.all([tx.get(dayRef), tx.get(monthRef)]);
      const calls = d.exists ? d.data().calls ?? 0 : 0;
      const spent = m.exists ? m.data().costUsd ?? 0 : 0;
      if (calls >= cap) throw new GenError('resource-exhausted', `You have used today's ${cap} challenge${cap === 1 ? '' : 's'}. It resets tomorrow.`);
      if (spent >= ceiling) throw new GenError('resource-exhausted', 'The monthly spending limit has been reached. It resets next month.');
      tx.set(dayRef, { calls: calls + 1 }, { merge: true });
      tx.set(monthRef, { calls: FieldValue.increment(1) }, { merge: true });
      return calls + 1;
    });
  }
  const release = (uid, dayKey, monthKey) => Promise.all([
    db.doc(`usage/${uid}/days/${dayKey}`).set({ calls: FieldValue.increment(-1) }, { merge: true }),
    db.doc(`usageGlobal/${monthKey}`).set({ calls: FieldValue.increment(-1) }, { merge: true }),
  ]).catch(() => {});
  const recordCost = (uid, dayKey, monthKey, cost, usage) => Promise.all([
    db.doc(`usage/${uid}/days/${dayKey}`).set({ costUsd: FieldValue.increment(cost), inputTokens: FieldValue.increment(usage.inputTokens), outputTokens: FieldValue.increment(usage.outputTokens) }, { merge: true }),
    db.doc(`usageGlobal/${monthKey}`).set({ costUsd: FieldValue.increment(cost) }, { merge: true }),
  ]);

  // ---------- 5. ask Claude ----------
  async function askClaude(cfg, structured, userText) {
    const res = await anthropic.beta.messages.create({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                                  // re-run on another model if this one declines
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }], // the shared prompt: cached
      messages: [{ role: 'user', content: userText }],
      output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: structured } },
    });
    return res;
  }

  // ---------- 6. the checks ----------
  function readChallenge(res, { mixesOwnGlazes }) {
    if (res.stop_reason === 'refusal') return { fatal: new GenError('failed-precondition', "That request couldn't be made. Try wording it differently.") };
    if (res.stop_reason === 'max_tokens') return { problems: ['the answer was cut off before it finished'] };
    const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    let content;
    try { content = JSON.parse(text); } catch (e) { return { problems: ['the answer was not valid JSON'] }; }
    const check = validateChallenge(content);
    const problems = [...check.errors];
    if (check.ok && content.category === 'glaze-chemistry' && !mixesOwnGlazes) problems.push('glaze chemistry from scratch is not switched on for this person');
    if (problems.length) return { problems };
    return { content, warnings: check.warnings };
  }

  // ---------- the whole thing ----------
  async function generate({ uid, email, emailVerified, mode, input }) {
    // 2. who is asking
    if (!uid || !email || emailVerified !== true) throw new GenError('unauthenticated', 'Sign in first.');
    const allow = await db.doc(`allowlist/${email.toLowerCase()}`).get();
    if (!allow.exists) throw new GenError('permission-denied', "You're not on the list for this app.");

    const clean = checkInput(mode, input);

    // 3. switches and limits
    const cfgSnap = await db.doc('config/app').get();
    const cfg = { ...DEFAULTS, ...(cfgSnap.exists ? cfgSnap.data() : {}) };
    if (cfg.remixEnabled === false) throw new GenError('failed-precondition', 'Creating and remixing is switched off right now.');
    const cap = Number.isInteger(allow.data().dailyApiCap) ? allow.data().dailyApiCap : cfg.defaultDailyApiCap;

    const profileSnap = await db.doc(`users/${uid}`).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};

    // what to remix (read before reserving, so a bad source costs nothing)
    let source = null;
    if (mode === 'remix') {
      if (clean.source.type === 'library') {
        const s = await db.doc(`challenges/${clean.source.id}`).get();
        if (!s.exists || s.data().status !== 'approved') throw new GenError('not-found', "That challenge isn't available to remix.");
        source = s.data().content;
      } else {
        const s = await db.doc(`users/${uid}/remixes/${clean.source.id}`).get();
        if (!s.exists || s.data().status !== 'saved') throw new GenError('not-found', "That challenge isn't available to remix.");
        source = s.data().content;
      }
    }

    const dayKey = dayKeyOf(now(), cfg.timezone);
    const monthKey = dayKey.slice(0, 7);
    const used = await reserve(uid, cap, cfg.monthlyCostCeilingUsd, dayKey, monthKey);

    let usage = emptyUsage();
    let cost = 0;
    let result = null;
    let attempts = 0;
    try {
      const structured = structuredSchema(schema, taxonomy, { mixesOwnGlazes: Boolean(profile.mixesOwnGlazes) });
      let feedback = '';
      while (attempts < MAX_ATTEMPTS) {
        attempts++;
        const res = await askClaude(cfg, structured, buildUserText({ mode, input: clean, profile, source, feedback }));
        usage = addUsage(usage, res.usage);
        cost += costUsd(cfg.model, res.usage);
        const r = readChallenge(res, { mixesOwnGlazes: Boolean(profile.mixesOwnGlazes) });
        if (r.fatal) throw r.fatal;
        if (r.content) { result = r; break; }
        feedback = r.problems.join('; ');
      }
    } catch (e) {
      // Nothing usable came back, so give the person their call back. Money already spent is still counted.
      if (cost > 0) await recordCost(uid, dayKey, monthKey, cost, usage).catch(() => {});
      await release(uid, dayKey, monthKey);
      if (e instanceof GenError) throw e;
      const status = e?.status;
      if (status === 429 || status === 529 || status >= 500) throw new GenError('unavailable', 'Claude is busy right now. Try again in a minute.');
      if (status === 401 || status === 403) throw new GenError('internal', 'The server is not set up to reach Claude yet.');
      throw new GenError('internal', 'Something went wrong making that challenge.');
    }

    await recordCost(uid, dayKey, monthKey, cost, usage);
    if (!result) {
      await release(uid, dayKey, monthKey); // two tries, neither passed the checks: not the person's fault
      throw new GenError('failed-precondition', "I couldn't make that one safely. Try describing it a little differently.");
    }

    // 8. save as a private draft; the person taps Save to keep it
    const ref = db.collection(`users/${uid}/remixes`).doc();
    await ref.set({
      status: 'draft',
      source: mode === 'create' ? 'created' : 'remix',
      request: mode === 'create' ? { prompt: clean.prompt, hints: clean.hints } : { source: clean.source, preset: clean.preset, note: clean.note },
      content: result.content,
      ...facets(result.content),
      dedupeKey: dedupeKey(result.content),
      number: null,
      model: cfg.model,
      promptVersion: cfg.promptVersion,
      schemaVersion: SCHEMA_VERSION,
      usage: { ...usage, costUsd: Number(cost.toFixed(6)), attempts },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id: ref.id, content: result.content, warnings: result.warnings, remainingToday: Math.max(0, cap - used), costUsd: Number(cost.toFixed(6)) };
  }

  return { generate };
}
