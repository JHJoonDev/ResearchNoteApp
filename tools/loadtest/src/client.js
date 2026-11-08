import { performance } from 'node:perf_hooks';

/**
 * 인증 쿠키 및 CSRF 헤더를 관리하는 가상 사용자 HTTP 클라이언트
 */
export class HttpClient {
  /**
   * @param {string} baseUrl 대상 기본 URL (예: http://127.0.0.1:18080)
   * @param {object} [options]
   */
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cookies = new Map();
    this.defaultHeaders = {
      'X-LabHub-Request': '1',
      ...(options.headers || {}),
    };
  }

  /**
   * 세션 쿠키 수동 설정
   * @param {string} name
   * @param {string} value
   */
  setCookie(name, value) {
    this.cookies.set(name, value);
  }

  /**
   * 쿠키 헤더 문자열 반환
   */
  getCookieHeader() {
    if (this.cookies.size === 0) return '';
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Set-Cookie 헤더 파싱 및 저장
   * @param {Headers} headers
   */
  #saveCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);

    for (const cookieStr of raw) {
      if (!cookieStr) continue;
      const part = cookieStr.split(';')[0];
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const k = part.slice(0, eqIdx).trim();
        const v = part.slice(eqIdx + 1).trim();
        this.cookies.set(k, v);
      }
    }
  }

  /**
   * 요청 수행 및 레이턴시/상태코드 측정
   * @param {string} path
   * @param {RequestInit} [init]
   * @returns {Promise<{ status: number, ok: boolean, data: any, durationMs: number, headers: Headers }>}
   */
  async request(path, init = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers = new Headers(init.headers || {});

    // 기본 헤더 적용
    for (const [k, v] of Object.entries(this.defaultHeaders)) {
      if (!headers.has(k)) headers.set(k, v);
    }

    // 쿠키 적용
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader && !headers.has('Cookie')) {
      headers.set('Cookie', cookieHeader);
    }

    const start = performance.now();
    let res;
    let err = null;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      err = e;
    }
    const durationMs = performance.now() - start;

    if (err) {
      return {
        status: 0,
        ok: false,
        error: err.message,
        durationMs,
        headers: new Headers(),
        data: null,
      };
    }

    this.#saveCookies(res.headers);

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } else {
      try {
        data = await res.text();
      } catch {
        data = null;
      }
    }

    return {
      status: res.status,
      ok: res.ok,
      data,
      durationMs,
      headers: res.headers,
    };
  }

  get(path, headers = {}) {
    return this.request(path, { method: 'GET', headers });
  }

  post(path, body, headers = {}) {
    const isJson = typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob);
    const h = { ...headers };
    if (isJson) h['Content-Type'] = 'application/json';

    return this.request(path, {
      method: 'POST',
      headers: h,
      body: isJson ? JSON.stringify(body) : body,
    });
  }

  put(path, body, headers = {}) {
    const isJson = typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob);
    const h = { ...headers };
    if (isJson) h['Content-Type'] = 'application/json';

    return this.request(path, {
      method: 'PUT',
      headers: h,
      body: isJson ? JSON.stringify(body) : body,
    });
  }

  delete(path, headers = {}) {
    return this.request(path, { method: 'DELETE', headers });
  }
}
