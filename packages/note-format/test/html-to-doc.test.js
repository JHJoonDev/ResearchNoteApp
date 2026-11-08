import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToDoc } from '../src/html/index.js';
import { validateDoc } from '../src/validate.js';
import { docToPlainText } from '../src/plain-text.js';

test('htmlToDoc - Quill 구형 평면 목록 복원 (다단 들여쓰기, 글머리/번호 혼합)', () => {
  const legacyQuillHtml = `
    <ol>
      <li data-list="bullet">글머리 레벨 0-A</li>
      <li data-list="bullet" class="ql-indent-1">글머리 레벨 1-A</li>
      <li data-list="ordered" class="ql-indent-2">번호 레벨 2-A</li>
      <li data-list="ordered" class="ql-indent-2">번호 레벨 2-B</li>
      <li data-list="bullet" class="ql-indent-1">글머리 레벨 1-B</li>
      <li data-list="bullet">글머리 레벨 0-B</li>
    </ol>
  `;

  const { doc, warnings } = htmlToDoc(legacyQuillHtml);
  const validation = validateDoc(doc);
  assert.equal(validation.ok, true, `유효성 검사 실패: ${JSON.stringify(validation.errors)}`);

  // 최상위 리스트 검사
  assert.equal(doc.content.length, 1);
  const rootList = doc.content[0];
  assert.equal(rootList.type, 'bulletList');
  assert.equal(rootList.content.length, 2); // 0-A 와 0-B

  // 첫 번째 항목 검사
  const item0A = rootList.content[0];
  assert.equal(item0A.type, 'listItem');
  // 0-A 안에는 paragraph 1개와 하위 bulletList 1개
  assert.equal(item0A.content[0].type, 'paragraph');
  assert.equal(item0A.content[0].content[0].text, '글머리 레벨 0-A');

  const subListLevel1 = item0A.content[1];
  assert.equal(subListLevel1.type, 'bulletList');
  assert.equal(subListLevel1.content.length, 2); // 1-A 와 1-B

  // 1-A 안의 하위 번호 리스트 검사
  const item1A = subListLevel1.content[0];
  const subListLevel2 = item1A.content[1];
  assert.equal(subListLevel2.type, 'orderedList');
  assert.equal(subListLevel2.content.length, 2); // 2-A 와 2-B
});

test('htmlToDoc - Quill 2 getSemanticHTML 중첩 목록 변환', () => {
  const semanticHtml = `
    <ul>
      <li>1단계 항목
        <ul>
          <li>2단계 항목</li>
        </ul>
      </li>
    </ul>
  `;

  const { doc, warnings } = htmlToDoc(semanticHtml);
  const validation = validateDoc(doc);
  assert.equal(validation.ok, true);

  assert.equal(doc.content[0].type, 'bulletList');
  assert.equal(doc.content[0].content[0].content[1].type, 'bulletList');
});

test('htmlToDoc - ql-align-* 클래스를 align 속성으로 변환', () => {
  const html = `
    <p class="ql-align-center">중앙 정렬 본문</p>
    <h2 class="ql-align-right">우측 정렬 제목</h2>
    <p class="ql-align-justify">양쪽 정렬 본문</p>
  `;

  const { doc } = htmlToDoc(html);
  assert.equal(doc.content[0].attrs.align, 'center');
  assert.equal(doc.content[1].attrs.align, 'right');
  assert.equal(doc.content[2].attrs.align, 'justify');
});

test('htmlToDoc - backend cleanContent 허용 태그 전체 처리', () => {
  // p, br, strong, b, em, i, u, s, h1, h2, h3, ol, ul, li, blockquote, pre, code, a, table, thead, tbody, tr, th, td, span, sub, sup
  const fullHtml = `
    <h1>제목 1</h1>
    <h2>제목 2</h2>
    <h3>제목 3</h3>
    <p>
      <strong>굵게</strong> <b>볼드</b>
      <em>기울임</em> <i>이탤릭</i>
      <u>밑줄</u> <s>취소선</s>
      <code>인라인코드</code>
      <a href="https://labhub.internal">안전한 링크</a>
      <span>일반 스팬</span>
      <sub>아래첨자</sub> <sup>위첨자</sup>
      <br>
    </p>
    <blockquote>인용 블록</blockquote>
    <pre><code class="language-python">print('hello')</code></pre>
    <table>
      <thead>
        <tr><th>헤더 1</th><th>헤더 2</th></tr>
      </thead>
      <tbody>
        <tr><td>값 1</td><td>값 2</td></tr>
      </tbody>
    </table>
  `;

  const { doc, warnings } = htmlToDoc(fullHtml);
  const validation = validateDoc(doc);
  assert.equal(validation.ok, true, `유효성 검사 실패: ${JSON.stringify(validation.errors)}`);
});

test('htmlToDoc - 위험한 javascript: 링크 처리 시 링크 마크 제거 및 warnings 기록', () => {
  const evilHtml = '<p><a href="javascript:alert(1)">클릭하세요</a></p>';
  const { doc, warnings } = htmlToDoc(evilHtml);

  const validation = validateDoc(doc);
  assert.equal(validation.ok, true);

  const textNode = doc.content[0].content[0];
  assert.equal(textNode.text, '클릭하세요');
  assert.equal(textNode.marks, undefined);
  assert.ok(warnings.some((w) => w.includes('안전하지 않은 링크')));
});

// ========================================================
// 시드 고정 무작위 HTML 생성기 및 2000건 이관 안전성 검증
// ========================================================

function createPrng(seed = 987654321) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KOREAN_WORDS = ['실험', '연구', '시약', '결과', '온도', '압력', '반응', '기록', '데이터', '관찰', '가설', '검증'];
const ENGLISH_WORDS = ['Protocol', 'Sample', 'Buffer', 'NaCl', 'DNA', 'RNA', 'pH', 'Test', 'Step', 'Lab', 'Note', 'Data'];
const NUMBER_STRINGS = ['1', '10', '25.4', '100', '2026', '0.05'];
const ENTITIES = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'];
const INLINE_TAGS = ['strong', 'b', 'em', 'i', 'u', 's', 'code', 'sub', 'sup', 'span', 'a'];
const ALIGN_CLASSES = ['ql-align-center', 'ql-align-right', 'ql-align-justify'];

function randChoice(prng, arr) {
  return arr[Math.floor(prng() * arr.length)];
}

function randInt(prng, min, max) {
  return Math.floor(prng() * (max - min + 1)) + min;
}

function generateRandomText(prng) {
  const parts = [];
  const count = randInt(prng, 1, 3);
  for (let i = 0; i < count; i++) {
    const type = prng();
    if (type < 0.4) parts.push(randChoice(prng, KOREAN_WORDS));
    else if (type < 0.7) parts.push(randChoice(prng, ENGLISH_WORDS));
    else if (type < 0.85) parts.push(randChoice(prng, NUMBER_STRINGS));
    else parts.push(randChoice(prng, ENTITIES));
  }
  return parts.join(' ');
}

function generateRandomInline(prng, depth = 0) {
  if (depth > 1 || prng() < 0.35) {
    return generateRandomText(prng);
  }

  const tag = randChoice(prng, INLINE_TAGS);
  if (tag === 'a') {
    const text = generateRandomText(prng);
    return `<a href="https://labhub.internal/res" title="설명">${text}</a>`;
  }
  if (tag === 'span') {
    const text = generateRandomText(prng);
    return `<span>${text}</span>`;
  }
  const inner = generateRandomInline(prng, depth + 1);
  return `<${tag}>${inner}</${tag}>`;
}

function generateRandomInlines(prng) {
  const count = randInt(prng, 1, 3);
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(generateRandomInline(prng, 0));
  }
  return items.join(' ');
}

function generateRandomBlock(prng) {
  const r = prng();
  // 1) p
  if (r < 0.35) {
    const alignClass = prng() < 0.3 ? ` class="${randChoice(prng, ALIGN_CLASSES)}"` : '';
    return `<p${alignClass}>${generateRandomInlines(prng)}</p>`;
  }
  // 2) h1~h3
  if (r < 0.5) {
    const level = randInt(prng, 1, 3);
    const alignClass = prng() < 0.3 ? ` class="${randChoice(prng, ALIGN_CLASSES)}"` : '';
    return `<h${level}${alignClass}>${generateRandomInlines(prng)}</h${level}>`;
  }
  // 3) blockquote
  if (r < 0.6) {
    return `<blockquote><p>${generateRandomInlines(prng)}</p></blockquote>`;
  }
  // 4) pre
  if (r < 0.7) {
    const code = `console.log("${randChoice(prng, ENGLISH_WORDS)}");`;
    return `<pre><code class="language-js">${code}</code></pre>`;
  }
  // 5) table
  if (r < 0.8) {
    const rows = randInt(prng, 1, 2);
    const cols = randInt(prng, 1, 2);
    let tableHtml = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) {
      tableHtml += `<th>${generateRandomText(prng)}</th>`;
    }
    tableHtml += '</tr></thead><tbody>';
    for (let row = 0; row < rows; row++) {
      tableHtml += '<tr>';
      for (let c = 0; c < cols; c++) {
        tableHtml += `<td>${generateRandomText(prng)}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';
    return tableHtml;
  }
  // 6) list (Quill 평면 및 중첩)
  if (r < 0.9) {
    const isOrdered = prng() < 0.5;
    const tag = isOrdered ? 'ol' : 'ul';
    const listTypeAttr = isOrdered ? 'ordered' : 'bullet';
    let listHtml = `<${tag}>`;
    const itemCount = randInt(prng, 1, 3);
    for (let i = 0; i < itemCount; i++) {
      const indentClass = i > 0 && prng() < 0.5 ? ' class="ql-indent-1"' : '';
      listHtml += `<li data-list="${listTypeAttr}"${indentClass}>${generateRandomInlines(prng)}</li>`;
    }
    listHtml += `</${tag}>`;
    return listHtml;
  }
  // 7) Quill 2 nested list
  let nestedHtml = '<ul>';
  nestedHtml += `<li>${generateRandomInlines(prng)}`;
  if (prng() < 0.5) {
    nestedHtml += `<ul><li>${generateRandomInlines(prng)}</li></ul>`;
  }
  nestedHtml += '</li></ul>';
  return nestedHtml;
}

function generateRandomCleanHtml(prng) {
  const blockCount = randInt(prng, 1, 3);
  const blocks = [];
  for (let b = 0; b < blockCount; b++) {
    blocks.push(generateRandomBlock(prng));
  }
  return blocks.join('\n');
}

function extractExpectedPlainText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

test('htmlToDoc - 이관 안전성 (임의 생성한 허용 HTML 2000건 validateDoc 및 평문 일치 검증)', () => {
  const SEED = 20261108;
  const prng = createPrng(SEED);
  const TOTAL_CASES = 2000;

  for (let i = 0; i < TOTAL_CASES; i++) {
    const html = generateRandomCleanHtml(prng);
    const { doc, warnings } = htmlToDoc(html);

    // 1) validateDoc 통과 검증
    const validation = validateDoc(doc);
    assert.equal(
      validation.ok,
      true,
      `[케이스 ${i}, 시드 ${SEED}] validateDoc 실패: ${JSON.stringify(validation.errors)} | HTML: ${html}`,
    );

    // 2) 평문 일치 검증 (공백 정규화 후)
    const docPlain = docToPlainText(doc).replace(/\s+/g, ' ').trim();
    const expectedPlain = extractExpectedPlainText(html);

    assert.equal(
      docPlain,
      expectedPlain,
      `[케이스 ${i}, 시드 ${SEED}] 평문 불일치! 기대값: '${expectedPlain}', 실제값: '${docPlain}' | HTML: ${html}`,
    );
  }
});
