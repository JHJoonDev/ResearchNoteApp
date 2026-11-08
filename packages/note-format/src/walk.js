/**
 * @fileoverview 재귀 없이 문서를 순회하는 유틸리티
 */

/**
 * 재귀 없이 문서를 깊이 우선 순회합니다.
 * visitor가 명시적으로 false를 반환하면 해당 노드의 자식 순회를 건너뜁니다.
 *
 * @param {import('./types.js').Node} doc
 * @param {(node: import('./types.js').Node, parent: import('./types.js').Node | null, index: number, depth: number) => boolean | void} visitor
 */
export function walkDoc(doc, visitor) {
  if (!doc || typeof doc !== 'object') return;

  // stack item: [node, parent, index, depth]
  const stack = [[doc, null, 0, 0]];

  while (stack.length > 0) {
    const [node, parent, index, depth] = stack.pop();
    const shouldContinue = visitor(node, parent, index, depth);
    if (shouldContinue === false) {
      continue;
    }

    const content = node.content;
    if (Array.isArray(content) && content.length > 0) {
      // 원래 순서대로 pop되도록 역순으로 push
      for (let i = content.length - 1; i >= 0; i--) {
        const child = content[i];
        if (child && typeof child === 'object') {
          stack.push([child, node, i, depth + 1]);
        }
      }
    }
  }
}
