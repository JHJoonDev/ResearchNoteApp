import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('browser-compat - 메인 진입점 모듈들이 parse5 및 Node 전용 모듈을 import하지 않음', () => {
  const mainFiles = [
    '../src/index.js',
    '../src/constants.js',
    '../src/types.js',
    '../src/validate.js',
    '../src/normalize.js',
    '../src/plain-text.js',
    '../src/safe-html.js',
    '../src/references.js',
    '../src/walk.js',
    '../src/diff.js',
  ];

  const forbiddenModules = [
    'parse5',
    'fs',
    'node:fs',
    'path',
    'node:path',
    'os',
    'node:os',
    'child_process',
    'node:child_process',
    'crypto',
    'node:crypto',
    'buffer',
    'node:buffer',
    'stream',
    'node:stream',
  ];

  for (const relPath of mainFiles) {
    const fullPath = resolve(__dirname, relPath);
    const content = readFileSync(fullPath, 'utf8');

    for (const mod of forbiddenModules) {
      const importRegex = new RegExp(`from\\s+['"]${mod}['"]`, 'g');
      assert.equal(
        importRegex.test(content),
        false,
        `${relPath} 파일에서 금지된 모듈 '${mod}'를 import하고 있습니다.`,
      );
    }
  }
});
