/**
 * @fileoverview 문서 비교(LCS diff) 모듈 - 블록 단위 및 한국어 단어 단위 인라인 비교
 */

import { normalizeDoc } from './normalize.js';
import { docToPlainText } from './plain-text.js';

/**
 * 한국어 음절, 단어, 공백, 문장부호 경계를 고려하여 텍스트를 토큰화합니다.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeText(text) {
  if (!text || typeof text !== 'string') return [];
  // 한글 단어/어절, 숫자, 영문 단어, 공백, 특수기호/문장부호를 분리
  const matches = text.match(/[\uAC00-\uD7AF]+|[0-9]+|[a-zA-Z]+|\s+|[^\s\w\uAC00-\uD7AF]/gu);
  return matches || [text];
}

/**
 * 제네릭 LCS Diff 함수
 * @template T
 * @param {T[]} seqA
 * @param {T[]} seqB
 * @param {(a: T, b: T) => boolean} isEqual
 * @returns {Array<{ op: 'same' | 'add' | 'remove', aIndex?: number, bIndex?: number, a?: T, b?: T }>}
 */
function computeLcsDiff(seqA, seqB, isEqual) {
  const n = seqA.length;
  const m = seqB.length;

  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (isEqual(seqA[i], seqB[j])) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && isEqual(seqA[i - 1], seqB[j - 1])) {
      diff.push({ op: 'same', aIndex: i - 1, bIndex: j - 1, a: seqA[i - 1], b: seqB[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({ op: 'add', bIndex: j - 1, b: seqB[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diff.push({ op: 'remove', aIndex: i - 1, a: seqA[i - 1] });
      i--;
    }
  }

  return diff.reverse();
}

/**
 * 인라인 텍스트에 대한 단어 단위 diff를 계산하고 연속 토큰을 병합합니다.
 * @param {string} textA
 * @param {string} textB
 * @returns {import('./types.js').InlineDiff[]}
 */
export function diffInlineText(textA, textB) {
  const tokensA = tokenizeText(textA);
  const tokensB = tokenizeText(textB);

  const rawDiff = computeLcsDiff(tokensA, tokensB, (a, b) => a === b);
  const merged = [];

  for (const item of rawDiff) {
    const text = item.op === 'remove' ? item.a : item.b;
    if (merged.length > 0 && merged[merged.length - 1].op === item.op) {
      merged[merged.length - 1].text += text;
    } else {
      merged.push({ op: item.op, text });
    }
  }

  return merged;
}

/**
 * 두 문서를 블록 단위로 비교하고, 변경된 블록은 인라인 단어 단위 diff를 포함하여 반환합니다.
 *
 * @param {import('./types.js').Node} a
 * @param {import('./types.js').Node} b
 * @returns {import('./types.js').BlockDiff[]}
 */
export function diffDocs(a, b) {
  const blocksA = Array.isArray(a?.content) ? a.content : [];
  const blocksB = Array.isArray(b?.content) ? b.content : [];

  // 정규화된 블록 JSON 문자열로 일치 판정
  const normalizedBlocksA = blocksA.map((bl) => JSON.stringify(normalizeDoc(bl)));
  const normalizedBlocksB = blocksB.map((bl) => JSON.stringify(normalizeDoc(bl)));

  const blockDiffs = computeLcsDiff(
    blocksA,
    blocksB,
    (_ba, _bb) => false, // 임시 대신 인덱스 기반 매칭
  );

  // 실제 normalizedBlocks로 LCS 계산
  const rawDiff = computeLcsDiff(
    normalizedBlocksA,
    normalizedBlocksB,
    (strA, strB) => strA === strB,
  );

  const results = [];
  let i = 0;

  while (i < rawDiff.length) {
    const item = rawDiff[i];

    if (item.op === 'same') {
      results.push({
        op: 'same',
        blockIndexA: item.aIndex,
        blockIndexB: item.bIndex,
      });
      i++;
      continue;
    }

    // 연속된 remove와 add 블록을 찾아 change로 묶을 수 있는지 확인
    const removes = [];
    const adds = [];

    while (i < rawDiff.length && rawDiff[i].op !== 'same') {
      if (rawDiff[i].op === 'remove') {
        removes.push(rawDiff[i]);
      } else if (rawDiff[i].op === 'add') {
        adds.push(rawDiff[i]);
      }
      i++;
    }

    // 1:1 매칭 가능한 항목은 change로 변환
    const pairCount = Math.min(removes.length, adds.length);
    for (let p = 0; p < pairCount; p++) {
      const rem = removes[p];
      const add = adds[p];
      const blockA = blocksA[rem.aIndex];
      const blockB = blocksB[add.bIndex];

      const textA = docToPlainText(blockA).trim();
      const textB = docToPlainText(blockB).trim();

      results.push({
        op: 'change',
        blockIndexA: rem.aIndex,
        blockIndexB: add.bIndex,
        inline: diffInlineText(textA, textB),
      });
    }

    // 남은 remove 항목
    for (let r = pairCount; r < removes.length; r++) {
      results.push({
        op: 'remove',
        blockIndexA: removes[r].aIndex,
      });
    }

    // 남은 add 항목
    for (let aIdx = pairCount; aIdx < adds.length; aIdx++) {
      results.push({
        op: 'add',
        blockIndexB: adds[aIdx].bIndex,
      });
    }
  }

  return results;
}
