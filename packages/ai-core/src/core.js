/**
 * @fileoverview createAiCore 메인 인스턴스 팩토리
 */

import { DEFAULT_MODEL, DEFAULT_EFFORT, AnthropicProvider } from './provider.js';
import { AiDisabledError, AiError } from './errors.js';
import { draftNote } from './features/draftNote.js';
import { generateProtocol } from './features/generateProtocol.js';
import { extractTables } from './features/extractTables.js';
import { checkNote } from './features/checkNote.js';
import { askNotes } from './features/askNotes.js';

export const DEFAULT_MAX_TEXT_LENGTH = 100_000;
export const DEFAULT_MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * AI Core 인스턴스를 생성합니다.
 *
 * @param {object} [options]
 * @param {'none'|'anthropic'} [options.provider='none']
 * @param {import('@anthropic-ai/sdk').default} [options.client]
 * @param {string} [options.model='claude-opus-5-5']
 * @param {'low'|'medium'|'high'|'xhigh'|'max'} [options.effort='medium']
 * @param {{ maxTextLength?: number, maxMediaBytes?: number }} [options.limits]
 * @returns {object}
 */
export function createAiCore(options = {}) {
  const provider = options.provider || 'none';
  const model = options.model || DEFAULT_MODEL;
  const effort = options.effort || DEFAULT_EFFORT;
  const limits = options.limits || {};

  const maxTextLength = Number.isInteger(limits.maxTextLength)
    ? limits.maxTextLength
    : DEFAULT_MAX_TEXT_LENGTH;
  const maxMediaBytes = Number.isInteger(limits.maxMediaBytes)
    ? limits.maxMediaBytes
    : DEFAULT_MAX_MEDIA_BYTES;

  let aiProvider = null;
  if (provider === 'anthropic') {
    aiProvider = new AnthropicProvider({
      client: options.client,
      defaultModel: model,
      defaultEffort: effort,
    });
  } else if (provider !== 'none') {
    throw new AiError(`Unsupported provider: ${provider}`, { code: 'bad_request' });
  }

  const context = {
    provider: aiProvider,
    providerName: provider,
    model,
    effort,
    maxTextLength,
    maxMediaBytes,
  };

  return {
    provider,
    model,
    effort,
    limits: {
      maxTextLength,
      maxMediaBytes,
    },

    async draftNote(params) {
      if (provider === 'none' || !aiProvider) {
        throw new AiDisabledError();
      }
      return draftNote(params, context);
    },

    async generateProtocol(params) {
      if (provider === 'none' || !aiProvider) {
        throw new AiDisabledError();
      }
      return generateProtocol(params, context);
    },

    async extractTables(params) {
      if (provider === 'none' || !aiProvider) {
        throw new AiDisabledError();
      }
      return extractTables(params, context);
    },

    async checkNote(params) {
      if (provider === 'none' || !aiProvider) {
        throw new AiDisabledError();
      }
      return checkNote(params, context);
    },

    async askNotes(params = {}) {
      if (provider === 'none' || !aiProvider) {
        throw new AiDisabledError();
      }
      return askNotes(params, context);
    },
  };
}
