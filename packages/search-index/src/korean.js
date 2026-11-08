/**
 * @fileoverview 한국어 검색 품질 향상을 위한 토큰화 및 Bigram 모듈
 */

/**
 * 텍스트를 정규화하고 단어 토큰 및 2-gram(바이그램)을 추출합니다.
 * 형태소 분석기 없이도 한국어 복합어('완충용액' 등)의 부분 일치('완충')를 지원합니다.
 *
 * @param {string} text
 * @returns {{ words: string[], bigrams: string[], all: Set<string> }}
 */
export function extractTokens(text) {
  if (!text || typeof text !== 'string') {
    return { words: [], bigrams: [], all: new Set() };
  }

  // 소문자 변환 및 구두점/특수문자를 공백으로 치환
  const cleaned = text.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ');
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

  const bigrams = [];
  for (const word of words) {
    if (word.length >= 2) {
      for (let i = 0; i < word.length - 1; i++) {
        bigrams.push(word.slice(i, i + 2));
      }
    }
  }

  const all = new Set([...words, ...bigrams]);
  return { words, bigrams, all };
}

/**
 * 주어진 검색 질의어에 대해 레코드의 매칭 여부와 관련도 점수를 계산합니다.
 *
 * @param {import('./types.js').SearchRecord} record
 * @param {string} query
 * @returns {number} 매칭 점수 (0이면 불일치)
 */
export function scoreRecord(record, query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return 1; // 검색어가 없으면 접근 권한 내 모든 레코드 허용
  }

  const rawQuery = query.toLowerCase().trim();
  const queryTokens = extractTokens(rawQuery);

  if (queryTokens.words.length === 0) {
    return 1;
  }

  const titleLower = (record.title || '').toLowerCase();
  const textLower = (record.text || '').toLowerCase();
  const tagsLower = (record.tags || []).map((t) => String(t).toLowerCase());

  let score = 0;
  let matchFound = false;

  // 1. 완전 구문 일치 보너스 (Exact phrase matching)
  if (titleLower.includes(rawQuery)) {
    score += 50;
    matchFound = true;
  }
  if (textLower.includes(rawQuery)) {
    score += 25;
    matchFound = true;
  }
  if (tagsLower.some((t) => t.includes(rawQuery))) {
    score += 40;
    matchFound = true;
  }

  // 2. 단어 및 바이그램 단위 매칭
  const titleTokens = extractTokens(titleLower);
  const textTokens = extractTokens(textLower);
  const tagTokens = new Set();
  for (const t of tagsLower) {
    const extracted = extractTokens(t);
    extracted.all.forEach((item) => tagTokens.add(item));
  }

  // 쿼리의 단어별 매칭 확인
  for (const qWord of queryTokens.words) {
    if (titleTokens.words.includes(qWord) || titleLower.includes(qWord)) {
      score += 20;
      matchFound = true;
    }
    if (tagTokens.has(qWord)) {
      score += 15;
      matchFound = true;
    }
    if (textTokens.words.includes(qWord) || textLower.includes(qWord)) {
      score += 10;
      matchFound = true;
    }
  }

  // 쿼리의 바이그램별 부분 매칭 (예: '완충' -> '완충용액')
  for (const qBigram of queryTokens.bigrams) {
    if (titleLower.includes(qBigram)) {
      score += 8;
      matchFound = true;
    }
    if (tagsLower.some((t) => t.includes(qBigram))) {
      score += 6;
      matchFound = true;
    }
    if (textLower.includes(qBigram)) {
      score += 4;
      matchFound = true;
    }
  }

  return matchFound ? score : 0;
}

/**
 * 텍스트에서 검색어 주변 발췌문(스니펫)을 생성하고 매칭 키워드를 <mark> 태그로 감쌉니다.
 *
 * @param {string} text
 * @param {string} query
 * @param {number} [targetLength=100]
 * @returns {string}
 */
export function createSnippet(text, query, targetLength = 100) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const cleanText = text.replace(/[\r\n\t]+/g, ' ').trim();
  if (!cleanText) return '';

  if (!query || typeof query !== 'string' || !query.trim()) {
    return cleanText.length > targetLength ? `${cleanText.slice(0, targetLength)}...` : cleanText;
  }

  const queryTerms = extractTokens(query).words;
  if (queryTerms.length === 0) {
    return cleanText.length > targetLength ? `${cleanText.slice(0, targetLength)}...` : cleanText;
  }

  const lowerText = cleanText.toLowerCase();

  // 가장 먼저 등장하는 검색어 위치 찾기
  let earliestPos = -1;
  let matchedTerm = '';

  for (const term of queryTerms) {
    const pos = lowerText.indexOf(term.toLowerCase());
    if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
      earliestPos = pos;
      matchedTerm = term;
    }
  }

  // 단어 단위 매칭이 안 되면 바이그램 단위로 위치 찾기
  if (earliestPos === -1) {
    const queryBigrams = extractTokens(query).bigrams;
    for (const bg of queryBigrams) {
      const pos = lowerText.indexOf(bg.toLowerCase());
      if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
        earliestPos = pos;
        matchedTerm = bg;
      }
    }
  }

  let start = 0;
  let end = cleanText.length;

  if (earliestPos !== -1) {
    const leadContext = Math.floor(targetLength * 0.3);
    start = Math.max(0, earliestPos - leadContext);
    end = Math.min(cleanText.length, start + targetLength);
    if (end - start < targetLength) {
      start = Math.max(0, end - targetLength);
    }
  } else {
    start = 0;
    end = Math.min(cleanText.length, targetLength);
  }

  let snippet = cleanText.slice(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < cleanText.length) snippet = `${snippet}...`;

  // 매칭 검색어 하이라이트 (<mark>...</mark>)
  const highlightRegexTerms = [query.trim(), ...queryTerms]
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (highlightRegexTerms.length > 0) {
    const regex = new RegExp(`(${highlightRegexTerms.join('|')})`, 'gi');
    snippet = snippet.replace(regex, '<mark>$1</mark>');
  }

  return snippet;
}
