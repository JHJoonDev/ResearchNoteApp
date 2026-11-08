import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../src/extensions/index.js';
import { toNoteDoc } from '../src/adapters.js';

describe('Paste sanitising tests', () => {
  let editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: createExtensions(),
    });
  });

  afterEach(() => {
    editor?.destroy();
  });

  it('원격 이미지(data-attachment-id 없는 src 이미지)는 문서에 삽입되지 않음', () => {
    const remoteHtml = '<p>텍스트 앞</p><img src="https://evil.com/tracker.png" alt="악성이미지"><p>텍스트 뒤</p>';
    editor.commands.setContent(remoteHtml);

    const noteDoc = toNoteDoc(editor.getJSON());

    // noteDoc 내에 image 노드가 없어야 함
    const hasImage = noteDoc.content?.some((node) => node.type === 'image');
    expect(hasImage).toBe(false);

    // src 속성이 어디에도 저장되지 않아야 함
    const jsonStr = JSON.stringify(noteDoc);
    expect(jsonStr).not.toContain('https://evil.com/tracker.png');
  });

  it('javascript: 링크는 링크 마크로 등록되지 않음', () => {
    const xssHtml = '<p><a href="javascript:alert(document.cookie)">악성 링크</a></p>';
    editor.commands.setContent(xssHtml);

    const noteDoc = toNoteDoc(editor.getJSON());
    const paragraph = noteDoc.content?.[0];
    const textNode = paragraph?.content?.[0];

    expect(textNode?.text).toBe('악성 링크');
    // marks에 link가 없어야 함
    expect(textNode?.marks).toBeUndefined();
    expect(JSON.stringify(noteDoc)).not.toContain('javascript:');
  });

  it('data: 및 vbscript: 링크도 차단됨', () => {
    const dataHtml = '<p><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">데이터 링크</a></p>';
    editor.commands.setContent(dataHtml);

    const noteDoc = toNoteDoc(editor.getJSON());
    const textNode = noteDoc.content?.[0]?.content?.[0];
    expect(textNode?.marks).toBeUndefined();
  });

  it('스키마에 없는 알 수 없는 노드(section, marquee, div 등)는 텍스트/단락으로 변환됨', () => {
    const unknownHtml = '<section><div class="wrapper"><marquee>흐르는 텍스트</marquee></div></section>';
    editor.commands.setContent(unknownHtml);

    const noteDoc = toNoteDoc(editor.getJSON());
    const nodeTypes = noteDoc.content?.map((n) => n.type);

    expect(nodeTypes).not.toContain('section');
    expect(nodeTypes).not.toContain('div');
    expect(nodeTypes).not.toContain('marquee');

    // 텍스트는 보존되어야 함
    expect(JSON.stringify(noteDoc)).toContain('흐르는 텍스트');
  });
});
