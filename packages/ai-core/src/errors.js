/**
 * @fileoverview AI Core 에러 정의 및 SDK 에러 매핑
 */

import {
  RateLimitError,
  AuthenticationError,
  PermissionDeniedError,
  BadRequestError,
  UnprocessableEntityError,
  OverloadedError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from '@anthropic-ai/sdk';

/**
 * AI Core 기본 에러 클래스
 */
export class AiError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'unknown';
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

/**
 * AI 기능 비활성화 에러
 */
export class AiDisabledError extends AiError {
  constructor(message = 'AI features are disabled by policy') {
    super(message, { code: 'disabled' });
  }
}

/**
 * 입력 크기 초과 에러
 */
export class AiInputTooLargeError extends AiError {
  /**
   * @param {number|{ size: number, limit: number, message?: string }} sizeOrObj
   * @param {number} [limitArg]
   * @param {string} [messageArg]
   */
  constructor(sizeOrObj, limitArg, messageArg) {
    let size;
    let limit;
    let msg = messageArg;

    if (typeof sizeOrObj === 'object' && sizeOrObj !== null) {
      size = sizeOrObj.size;
      limit = sizeOrObj.limit;
      msg = sizeOrObj.message || msg;
    } else {
      size = sizeOrObj;
      limit = limitArg;
    }

    super(msg || `Input size (${size}) exceeds limit (${limit})`, { code: 'input_too_large' });
    this.size = size;
    this.limit = limit;
  }
}

/**
 * 모델 거절(Refusal) 에러
 */
export class AiRefusalError extends AiError {
  /**
   * @param {string|{ category?: string|null, message?: string }} [messageOrObj='Request was refused by model']
   * @param {{ category?: string|null }} [options]
   */
  constructor(messageOrObj = 'Request was refused by model', options = {}) {
    let msg = 'Request was refused by model';
    let cat = null;

    if (typeof messageOrObj === 'object' && messageOrObj !== null) {
      if (messageOrObj.message) msg = messageOrObj.message;
      if (messageOrObj.category !== undefined) cat = messageOrObj.category;
    } else if (typeof messageOrObj === 'string') {
      msg = messageOrObj;
      if (options.category !== undefined) cat = options.category;
    }

    super(msg, { code: 'refusal' });
    this.category = cat;
  }
}

/**
 * 최대 토큰 초과 에러
 */
export class AiMaxTokensError extends AiError {
  constructor(message = 'Response exceeded maximum token limit') {
    super(message, { code: 'max_tokens' });
  }
}

/**
 * 잘못된 JSON 응답 에러
 */
export class AiMalformedJsonError extends AiError {
  constructor(message = 'Model response contained malformed JSON') {
    super(message, { code: 'malformed_json' });
  }
}

/**
 * SDK 에러를 AiError로 안전하게 매핑합니다.
 * 에러 객체 및 메시지에는 사용자 노드 텍스트나 API 키가 포함되지 않도록 안전한 고정 메시지를 사용합니다.
 *
 * @param {unknown} err
 * @returns {AiError}
 */
export function mapSdkError(err) {
  if (err instanceof AiError) {
    return err;
  }

  if (err instanceof RateLimitError) {
    return new AiError('Rate limit exceeded', { code: 'rate_limit', status: err.status });
  }

  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new AiError('Authentication failed', { code: 'authentication', status: err.status });
  }

  if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
    return new AiError('Bad request to AI provider', { code: 'bad_request', status: err.status });
  }

  if (err instanceof OverloadedError) {
    return new AiError('AI provider is overloaded', { code: 'overloaded', status: err.status });
  }

  if (err instanceof APIConnectionError || err instanceof APIConnectionTimeoutError) {
    return new AiError('AI provider connection failed', { code: 'connection', status: err.status });
  }

  if (err instanceof APIError) {
    return new AiError('AI provider returned an error', { code: 'unknown', status: err.status });
  }

  return new AiError('Unexpected AI error', { code: 'unknown' });
}
