import { createAiCore, DEFAULT_EFFORT, DEFAULT_MODEL } from '@labhub/ai-core';

const FEATURES = ['draftNote', 'generateProtocol', 'extractTables', 'checkNote', 'askNotes'];
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
let cachedCore;
let cachedConfig;
let testClient = null;
let missingKeyWarningLogged = false;

function configuration() {
  const provider = process.env.AI_PROVIDER || 'none';
  if (!['none', 'anthropic'].includes(provider)) throw new Error('AI_PROVIDER must be none or anthropic');
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const effort = process.env.AI_EFFORT || DEFAULT_EFFORT;
  if (!EFFORTS.has(effort)) throw new Error('AI_EFFORT is invalid');
  const rawLimit = process.env.AI_RATE_LIMIT;
  const rateLimit = rawLimit === undefined ? 10 : Number(rawLimit);
  if (!Number.isSafeInteger(rateLimit) || rateLimit < 1) throw new Error('AI_RATE_LIMIT must be a positive integer');
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const enabled = provider === 'anthropic' && (hasKey || Boolean(testClient));
  if (provider === 'anthropic' && !hasKey && !testClient && !missingKeyWarningLogged) {
    console.warn('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; AI is disabled.');
    missingKeyWarningLogged = true;
  }
  return { provider, model, effort, rateLimit, enabled, hasKey };
}

export function initializeAi() {
  const { enabled, rateLimit } = configuration();
  return { enabled, rateLimit };
}

export function aiRateLimit() {
  return configuration().rateLimit;
}

export function aiStatus() {
  const { enabled } = configuration();
  return { enabled, features: enabled ? [...FEATURES] : [] };
}

export function getAiCore() {
  const config = configuration();
  if (!config.enabled) return null;
  const cacheKey = `${config.provider}\0${config.model}\0${config.effort}\0${config.hasKey}\0${Boolean(testClient)}`;
  if (!cachedCore || cacheKey !== cachedConfig) {
    cachedCore = createAiCore({
      provider: config.provider,
      model: config.model,
      effort: config.effort,
      ...(testClient ? { client: testClient } : {}),
    });
    cachedConfig = cacheKey;
  }
  return cachedCore;
}

export function setAiClientForTests(client) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test AI clients are available only in test mode.');
  if (client !== null && typeof client?.beta?.messages?.stream !== 'function') throw new TypeError('Invalid fake AI client.');
  testClient = client;
  cachedCore = undefined;
  cachedConfig = undefined;
}
