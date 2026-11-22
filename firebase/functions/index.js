// Cloud Functions entry. Two callable functions, createChallenge and remixChallenge, that share
// one generator. The Anthropic key lives in Secret Manager and only this server ever sees it.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { createGenerator, GenError } from './src/generator.js';
import { loadPromptText, buildSystemText } from './src/prompts.js';

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const here = (f) => new URL(f, import.meta.url);
const read = (f) => JSON.parse(readFileSync(here(f), 'utf8'));
const schema = read('./shared/challenge.schema.json');
const taxonomy = read('./shared/taxonomy.json');
const systemText = buildSystemText(loadPromptText(here('./shared/generation-prompt.md')), taxonomy);

initializeApp();

let generator;
function getGenerator() {
  // Built on first use, so the secret is only read when a request actually arrives.
  generator ??= createGenerator({ db: getFirestore(), anthropic: new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() }), schema, taxonomy, systemText });
  return generator;
}

const options = { region: 'us-central1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB', maxInstances: 3, cors: true };

function handler(mode) {
  return async (request) => {
    const auth = request.auth;
    try {
      return await getGenerator().generate({
        uid: auth?.uid, email: auth?.token?.email, emailVerified: auth?.token?.email_verified, mode, input: request.data,
      });
    } catch (e) {
      if (e instanceof GenError) throw new HttpsError(e.code, e.message);
      console.error('unexpected error', e);
      throw new HttpsError('internal', 'Something went wrong.');
    }
  };
}

export const createChallenge = onCall(options, handler('create'));
export const remixChallenge = onCall(options, handler('remix'));
