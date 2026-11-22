// What a call cost, from the token counts the API reports. Prices are dollars per million tokens.
// An unknown model is charged at the most expensive known rate, so the monthly ceiling errs on
// the side of stopping early rather than late.
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};
const FALLBACK = PRICES['claude-opus-5-5'];

export function costUsd(model, usage = {}) {
  const p = PRICES[model] ?? FALLBACK;
  const inTok = usage.input_tokens ?? 0;          // tokens that were not cached
  const outTok = usage.output_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  return (inTok * p.input + outTok * p.output + read * p.cacheRead + write * p.cacheWrite) / 1e6;
}

export function addUsage(total, usage = {}) {
  return {
    inputTokens: total.inputTokens + (usage.input_tokens ?? 0),
    outputTokens: total.outputTokens + (usage.output_tokens ?? 0),
    cacheReadTokens: total.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: total.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
  };
}
export const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
