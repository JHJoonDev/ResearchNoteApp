/**
 * @fileoverview KaTeX 기반 수식 노드 확장: mathInline, mathBlock
 */

import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-latex') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span.math-inline',
        getAttrs: (dom) => ({
          latex: dom.getAttribute('data-latex') || dom.textContent || '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    let rendered = node.attrs.latex || '';
    try {
      rendered = katex.renderToString(node.attrs.latex || '', {
        throwOnError: false,
        trust: false,
      });
    } catch {
      // ignore
    }
    return [
      'span',
      mergeAttributes({ class: 'math-inline' }, HTMLAttributes),
      rendered,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'math-inline';
      dom.setAttribute('data-latex', node.attrs.latex || '');

      const render = (latex) => {
        if (!latex) {
          dom.textContent = '(수식)';
          return;
        }
        try {
          katex.render(latex, dom, {
            throwOnError: false,
            trust: false,
          });
        } catch {
          dom.textContent = latex;
        }
      };

      render(node.attrs.latex);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;
          if (updatedNode.attrs.latex !== node.attrs.latex) {
            render(updatedNode.attrs.latex);
          }
          return true;
        },
      };
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-latex') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.math-block',
        getAttrs: (dom) => ({
          latex: dom.getAttribute('data-latex') || dom.textContent || '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    let rendered = node.attrs.latex || '';
    try {
      rendered = katex.renderToString(node.attrs.latex || '', {
        displayMode: true,
        throwOnError: false,
        trust: false,
      });
    } catch {
      // ignore
    }
    return [
      'div',
      mergeAttributes({ class: 'math-block' }, HTMLAttributes),
      rendered,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'math-block';
      dom.setAttribute('data-latex', node.attrs.latex || '');

      const render = (latex) => {
        if (!latex) {
          dom.textContent = '(블록 수식)';
          return;
        }
        try {
          katex.render(latex, dom, {
            displayMode: true,
            throwOnError: false,
            trust: false,
          });
        } catch {
          dom.textContent = latex;
        }
      };

      render(node.attrs.latex);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;
          if (updatedNode.attrs.latex !== node.attrs.latex) {
            render(updatedNode.attrs.latex);
          }
          return true;
        },
      };
    };
  },
});
