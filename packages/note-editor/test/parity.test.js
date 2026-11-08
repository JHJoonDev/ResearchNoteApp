import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../src/extensions/index.js';
import {
  ALLOWED_BLOCK_TYPES,
  ALLOWED_INLINE_TYPES,
  ALLOWED_MARK_TYPES,
} from '../../note-format/src/constants.js';

describe('Schema Parity Test', () => {
  const editor = new Editor({
    extensions: createExtensions(),
  });

  const schema = editor.schema;

  it('노드 집합이 note-format의 정의와 양방향으로 정확히 일치해야 함', () => {
    const editorNodeNames = new Set(Object.keys(schema.nodes));
    const expectedNodeNames = new Set([
      'doc',
      ...ALLOWED_BLOCK_TYPES,
      ...ALLOWED_INLINE_TYPES,
    ]);

    expect(editorNodeNames).toEqual(expectedNodeNames);
  });

  it('마크 집합이 note-format의 정의와 양방향으로 정확히 일치해야 함', () => {
    const editorMarkNames = new Set(Object.keys(schema.marks));
    const expectedMarkNames = new Set(ALLOWED_MARK_TYPES);

    expect(editorMarkNames).toEqual(expectedMarkNames);
  });

  it('각 노드의 속성(attributes)이 note-format 명세와 정확히 일치해야 함', () => {
    const expectedAttrs = {
      doc: [],
      paragraph: ['align'],
      heading: ['level', 'align'],
      bulletList: [],
      orderedList: ['start'],
      listItem: [],
      taskList: [],
      taskItem: ['checked'],
      blockquote: [],
      codeBlock: ['language'],
      table: [],
      tableRow: [],
      tableHeader: ['colspan', 'rowspan'],
      tableCell: ['colspan', 'rowspan'],
      horizontalRule: [],
      image: ['attachmentId', 'alt', 'width'],
      mathBlock: ['latex'],
      text: [],
      hardBreak: [],
      mathInline: ['latex'],
      mention: ['userId', 'label'],
      noteLink: ['noteId', 'label'],
      reagentRef: ['reagentId', 'label'],
    };

    for (const [nodeName, expectedAttrList] of Object.entries(expectedAttrs)) {
      const nodeType = schema.nodes[nodeName];
      expect(nodeType, `Node ${nodeName} should exist`).toBeDefined();
      const actualAttrs = Object.keys(nodeType.spec.attrs || {}).sort();
      expect(actualAttrs, `Node ${nodeName} attributes`).toEqual([...expectedAttrList].sort());
    }
  });

  it('각 마크의 속성(attributes)이 note-format 명세와 정확히 일치해야 함', () => {
    const expectedAttrs = {
      bold: [],
      italic: [],
      underline: [],
      strike: [],
      code: [],
      subscript: [],
      superscript: [],
      link: ['href', 'title'],
    };

    for (const [markName, expectedAttrList] of Object.entries(expectedAttrs)) {
      const markType = schema.marks[markName];
      expect(markType, `Mark ${markName} should exist`).toBeDefined();
      const actualAttrs = Object.keys(markType.spec.attrs || {}).sort();
      expect(actualAttrs, `Mark ${markName} attributes`).toEqual([...expectedAttrList].sort());
    }
  });
});
