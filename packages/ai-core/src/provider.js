/**
 * @fileoverview AI Provider 인터페이스 및 Anthropic Provider 구현체
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  AiError,
  AiRefusalError,
  AiMaxTokensError,
  AiMalformedJsonError,
  mapSdkError,
} from './errors.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_EFFORT = 'medium';
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * AI Provider 기본 인터페이스
 */
export class AiProvider {
  /**
   * @param {object} params
   * @returns {Promise<any>}
   */
  async complete(params) {
    throw new AiError('AiProvider.complete() must be implemented by subclass', {
      code: 'unknown',
    });
  }
}

/**
 * Anthropic SDK 기반 AI Provider 구현체
 */
export class AnthropicProvider extends AiProvider {
  /**
   * @param {object} options
   * @param {Anthropic} [options.client]
   * @param {string} [options.defaultModel]
   * @param {string} [options.defaultEffort]
   * @param {number} [options.defaultMaxTokens]
   */
  constructor({
    client,
    defaultModel = DEFAULT_MODEL,
    defaultEffort = DEFAULT_EFFORT,
    defaultMaxTokens = DEFAULT_MAX_TOKENS,
  } = {}) {
    super();
    this.client = client || new Anthropic();
    this.defaultModel = defaultModel;
    this.defaultEffort = defaultEffort;
    this.defaultMaxTokens = defaultMaxTokens;
  }

  /**
   * Anthropic Beta Messages API 호출 (스트리밍 및 finalMessage() 대기)
   *
   * @param {object} params
   * @param {string} [params.model]
   * @param {string} [params.effort]
   * @param {number} [params.maxTokens]
   * @param {string} params.system
   * @param {Array<object>} params.messages
   * @param {object} [params.schema]
   * @returns {Promise<{
   *   message: object,
   *   text: string,
   *   json?: any,
   *   content?: any[],
   *   usage: { input_tokens: number, output_tokens: number },
   *   requestId: string
   * }>}
   */
  async complete(params) {
    const body = {
      model: params.model || this.defaultModel,
      max_tokens: params.maxTokens || this.defaultMaxTokens,
      messages: params.messages,
      system: params.system,
      output_config: {
        effort: params.effort || this.defaultEffort,
      },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    };

    if (params.schema) {
      body.output_config.format = {
        type: 'json_schema',
        schema: params.schema,
      };
    }

    let message;
    try {
      const stream = this.client.beta.messages.stream(body);
      message = await stream.finalMessage();
    } catch (err) {
      throw mapSdkError(err);
    }

    // stop_reason 먼저 검사
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category || null;
      throw new AiRefusalError('Request was refused by model', { category });
    }
    if (message.stop_reason === 'max_tokens') {
      throw new AiMaxTokensError('Response exceeded maximum token limit');
    }

    if (params.schema) {
      const textBlock = message.content?.find(b => b.type === 'text');
      if (!textBlock || typeof textBlock.text !== 'string') {
        throw new AiMalformedJsonError('Model response did not contain text content');
      }
      let json;
      try {
        json = JSON.parse(textBlock.text);
      } catch (e) {
        throw new AiMalformedJsonError('Model response contained malformed JSON');
      }
      return {
        message,
        text: textBlock.text,
        json,
        content: message.content,
        usage: message.usage || { input_tokens: 0, output_tokens: 0 },
        requestId: message.id,
      };
    }

    const textBlocks = message.content?.filter(b => b.type === 'text') || [];
    const text = textBlocks.map(b => b.text).join('');

    return {
      message,
      text,
      content: message.content,
      usage: message.usage || { input_tokens: 0, output_tokens: 0 },
      requestId: message.id,
    };
  }
}
