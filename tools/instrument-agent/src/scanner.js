/**
 * @fileoverview 감시 디렉토리 스캐너 (경로 탈출 방지, 심볼릭 링크 루프 방지, 한글 경로 지원)
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

/**
 * 간단한 glob 패턴을 정규식으로 변환합니다.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegex(pattern) {
  if (!pattern || pattern === '*') return /.*/;
  let p = pattern.replace(/^\/+/, '');
  if (!p.includes('/')) {
    p = '**/' + p;
  }
  let reStr = '^';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        reStr += '(?:.+/)?';
        i += 3;
      } else {
        reStr += '.*';
        i += 2;
      }
    } else if (c === '*') {
      reStr += '[^/]*';
      i++;
    } else if (c === '?') {
      reStr += '[^/]';
      i++;
    } else if ('/\\+|^${}()[].'.includes(c)) {
      reStr += '\\' + c;
      i++;
    } else {
      reStr += c;
      i++;
    }
  }
  reStr += '$';
  return new RegExp(reStr, 'i');
}

/**
 * 파일 경로가 include/exclude 규칙에 부합하는지 판정합니다.
 * @param {string} relPath
 * @param {RegExp[]} includeRegexes
 * @param {RegExp[]} excludeRegexes
 * @returns {boolean}
 */
export function matchesFilters(relPath, includeRegexes, excludeRegexes) {
  const norm = relPath.replace(/\\/g, '/');

  // 제외 규칙에 일치하면 제외
  for (const ex of excludeRegexes) {
    if (ex.test(norm)) return false;
  }

  // 포함 규칙이 비어있으면 기본 포함
  if (includeRegexes.length === 0) return true;

  // 포함 규칙이 있으면 하나라도 일치해야 함
  for (const inc of includeRegexes) {
    if (inc.test(norm)) return true;
  }

  return false;
}

/**
 * 단일 감시 루트를 재귀 스캔하여 발견된 파일 목록을 반환합니다.
 * @param {string} watchRoot
 * @param {string[]} [includes]
 * @param {string[]} [excludes]
 * @param {number} [maxFileSizeMb]
 * @returns {Promise<Array<{ absolutePath: string, relativePath: string, size: number, mtimeMs: number }>>}
 */
export async function scanWatchDirectory(watchRoot, includes = [], excludes = [], maxFileSizeMb = 1024) {
  const results = [];
  const resolvedRoot = path.resolve(watchRoot);

  if (!fs.existsSync(resolvedRoot)) {
    logger.warn('감시 디렉토리가 존재하지 않습니다.', { path: resolvedRoot });
    return results;
  }

  let realWatchRoot;
  try {
    realWatchRoot = await fs.promises.realpath(resolvedRoot);
  } catch (err) {
    logger.error('감시 루트 경로의 realpath 확인 실패', { path: resolvedRoot, error: err.message });
    return results;
  }

  const includeRegexes = (includes || []).map(globToRegex);
  const excludeRegexes = (excludes || []).map(globToRegex);
  const maxBytes = maxFileSizeMb * 1024 * 1024;

  const visitedDirs = new Set();
  const dirQueue = [resolvedRoot];

  while (dirQueue.length > 0) {
    const currentDir = dirQueue.shift();

    let realCurrentDir;
    try {
      realCurrentDir = await fs.promises.realpath(currentDir);
    } catch {
      continue;
    }

    // 감시 루트 탈출 방지
    if (!realCurrentDir.startsWith(realWatchRoot)) {
      logger.warn('감시 루트를 벗어난 디렉토리 탐색 차단', { path: currentDir, real: realCurrentDir });
      continue;
    }

    // 심볼릭 링크 루프 방지
    if (visitedDirs.has(realCurrentDir)) {
      continue;
    }
    visitedDirs.add(realCurrentDir);

    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      logger.warn('디렉토리 읽기 실패', { dir: currentDir, error: err.message });
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        dirQueue.push(fullPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          // 파일의 실제 경로 검사
          const realFilePath = await fs.promises.realpath(fullPath);
          if (!realFilePath.startsWith(realWatchRoot)) {
            logger.warn('감시 루트를 벗어난 파일 제외', { file: fullPath });
            continue;
          }

          // 상대 경로 계산 (슬래시는 항상 forward slash / 로 통일)
          const relPath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');

          // 필터 규칙 검사
          if (!matchesFilters(relPath, includeRegexes, excludeRegexes)) {
            continue;
          }

          const stat = await fs.promises.stat(fullPath);
          if (!stat.isFile()) continue;

          // 최대 파일 크기 검사
          if (stat.size > maxBytes) {
            logger.warn('최대 허용 크기 초과 파일 제외', { file: relPath, size: stat.size, maxBytes });
            continue;
          }

          results.push({
            absolutePath: fullPath,
            relativePath: relPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch (err) {
          // 파일 접근 불가 등 (예: 쓰기 중 권한 잠금 등)
          continue;
        }
      }
    }
  }

  return results;
}
