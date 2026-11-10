/**
 * @fileoverview TipTap 에디터 한국어 툴바 컴포넌트
 */

import React, { useRef } from 'react';
import { Bold, Italic, Underline, Strikethrough, Code, Subscript, Superscript, Link, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, ListTodo, Quote, CodeXml, Minus, Table2, Rows3, Columns3, Merge, FunctionSquare, Sigma, Image, Undo2, Redo2 } from 'lucide-react';
import { handleUpload } from '../extensions/image.js';

export function Toolbar({ editor, onUploadImage, readOnly }) {
  const fileInputRef = useRef(null);

  if (!editor || readOnly) {
    return null;
  }

  const handleLink = () => {
    const previousUrl = editor.getAttributes('link').href || '';
    const url = window.prompt('링크 URL을 입력하세요 (http, https, mailto만 허용):', previousUrl);

    if (url === null) return;

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    const trimmed = url.trim();
    if (!/^(?:https?:\/\/|mailto:)/i.test(trimmed)) {
      window.alert('유효한 URL(http://, https://, mailto:)만 입력할 수 있습니다.');
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && onUploadImage && editor && !editor.isDestroyed) {
      try {
        const view = editor.view;
        if (view && view.dom) {
          handleUpload(view, file, { onUploadImage });
        }
      } catch {
        // editor view not available/mounted yet
      }
    }
    e.target.value = '';
  };

  const handleAddMathInline = () => {
    const latex = window.prompt('인라인 LaTeX 수식을 입력하세요:', 'E = mc^2');
    if (latex !== null && latex.trim()) {
      editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: latex.trim() } }).run();
    }
  };

  const handleAddMathBlock = () => {
    const latex = window.prompt('블록 LaTeX 수식을 입력하세요:', '\\int_0^1 x dx');
    if (latex !== null && latex.trim()) {
      editor.chain().focus().insertContent({ type: 'mathBlock', attrs: { latex: latex.trim() } }).run();
    }
  };

  const currentHeading = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
    ? 'h2'
    : editor.isActive('heading', { level: 3 })
    ? 'h3'
    : 'p';

  return (
    <div className="note-editor-toolbar" role="toolbar" aria-label="연구노트 서식 도구">
      {/* 1. 단락 및 제목 */}
      <select
        className="toolbar-select"
        value={currentHeading}
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'p') editor.chain().focus().setParagraph().run();
          else if (val === 'h1') editor.chain().focus().setHeading({ level: 1 }).run();
          else if (val === 'h2') editor.chain().focus().setHeading({ level: 2 }).run();
          else if (val === 'h3') editor.chain().focus().setHeading({ level: 3 }).run();
        }}
        title="단락 형식"
      >
        <option value="p">본문</option>
        <option value="h1">제목 1</option>
        <option value="h2">제목 2</option>
        <option value="h3">제목 3</option>
      </select>

      <span className="toolbar-divider" />

      {/* 2. 인라인 서식 */}
      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="굵게 (Ctrl+B)"
        aria-label="굵게"
      >
        <Bold size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="기울임 (Ctrl+I)"
        aria-label="기울임"
      >
        <Italic size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="밑줄 (Ctrl+U)"
        aria-label="밑줄"
      >
        <Underline size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="취소선"
        aria-label="취소선"
      >
        <Strikethrough size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('code') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="인라인 코드"
        aria-label="인라인 코드"
      >
        <Code size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('subscript') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        title="아래첨자"
        aria-label="아래첨자"
      >
        <Subscript size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('superscript') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        title="위첨자"
        aria-label="위첨자"
      >
        <Superscript size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('link') ? 'is-active' : ''}`}
        onClick={handleLink}
        title="링크"
        aria-label="링크"
      >
        <Link size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <span className="toolbar-divider" />

      {/* 3. 정렬 */}
      <button
        type="button"
        className={`toolbar-btn ${editor.isActive({ align: 'left' }) ? 'is-active' : ''}`}
        onClick={() => {
          const current = editor.getAttributes('paragraph').align || editor.getAttributes('heading').align;
          const next = current === 'left' ? null : 'left';
          editor.chain().focus().updateAttributes('paragraph', { align: next }).updateAttributes('heading', { align: next }).run();
        }}
        title="왼쪽 정렬"
        aria-label="왼쪽 정렬"
      >
        <AlignLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive({ align: 'center' }) ? 'is-active' : ''}`}
        onClick={() => {
          const current = editor.getAttributes('paragraph').align || editor.getAttributes('heading').align;
          const next = current === 'center' ? null : 'center';
          editor.chain().focus().updateAttributes('paragraph', { align: next }).updateAttributes('heading', { align: next }).run();
        }}
        title="가운데 정렬"
        aria-label="가운데 정렬"
      >
        <AlignCenter size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive({ align: 'right' }) ? 'is-active' : ''}`}
        onClick={() => {
          const current = editor.getAttributes('paragraph').align || editor.getAttributes('heading').align;
          const next = current === 'right' ? null : 'right';
          editor.chain().focus().updateAttributes('paragraph', { align: next }).updateAttributes('heading', { align: next }).run();
        }}
        title="오른쪽 정렬"
        aria-label="오른쪽 정렬"
      >
        <AlignRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive({ align: 'justify' }) ? 'is-active' : ''}`}
        onClick={() => {
          const current = editor.getAttributes('paragraph').align || editor.getAttributes('heading').align;
          const next = current === 'justify' ? null : 'justify';
          editor.chain().focus().updateAttributes('paragraph', { align: next }).updateAttributes('heading', { align: next }).run();
        }}
        title="양쪽 정렬"
        aria-label="양쪽 정렬"
      >
        <AlignJustify size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <span className="toolbar-divider" />

      {/* 4. 목록 및 블록 */}
      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="글머리 기호 목록"
        aria-label="글머리 기호 목록"
      >
        <List size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="번호 매기기 목록"
        aria-label="번호 매기기 목록"
      >
        <ListOrdered size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('taskList') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="할 일 목록"
        aria-label="할 일 목록"
      >
        <ListTodo size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="인용구"
        aria-label="인용구"
      >
        <Quote size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('codeBlock') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="코드 블록"
        aria-label="코드 블록"
      >
        <CodeXml size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="toolbar-btn"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="구분선"
        aria-label="구분선"
      >
        <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <span className="toolbar-divider" />

      {/* 5. 표 */}
      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('table') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        title="표 삽입"
        aria-label="표 삽입"
      >
        <Table2 size={16} strokeWidth={1.75} aria-hidden="true" />표
      </button>

      {editor.isActive('table') && (
        <>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            title="행 아래 추가"
        aria-label="행 아래 추가"
      >
        <Rows3 size={16} strokeWidth={1.75} aria-hidden="true" />행 추가
      </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().deleteRow().run()}
            title="행 삭제"
        aria-label="행 삭제"
      >
        <Rows3 size={16} strokeWidth={1.75} aria-hidden="true" />행 삭제
      </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            title="열 오른쪽 추가"
        aria-label="열 오른쪽 추가"
      >
        <Columns3 size={16} strokeWidth={1.75} aria-hidden="true" />열 추가
      </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            title="열 삭제"
        aria-label="열 삭제"
      >
        <Columns3 size={16} strokeWidth={1.75} aria-hidden="true" />열 삭제
      </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().mergeCells().run()}
            title="셀 병합"
        aria-label="셀 병합"
      >
        <Merge size={16} strokeWidth={1.75} aria-hidden="true" />병합
      </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().deleteTable().run()}
            title="표 삭제"
        aria-label="표 삭제"
      >
        <Table2 size={16} strokeWidth={1.75} aria-hidden="true" />표 삭제
      </button>
        </>
      )}

      <span className="toolbar-divider" />

      {/* 6. 수식 및 미디어 */}
      <button
        type="button"
        className="toolbar-btn"
        onClick={handleAddMathInline}
        title="인라인 수식 삽입"
        aria-label="인라인 수식 삽입"
      >
        <FunctionSquare size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="toolbar-btn"
        onClick={handleAddMathBlock}
        title="블록 수식 삽입"
        aria-label="블록 수식 삽입"
      >
        <Sigma size={16} strokeWidth={1.75} aria-hidden="true" />수식
      </button>

      {onUploadImage && (
        <>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleImageClick}
            title="이미지 업로드"
        aria-label="이미지 업로드"
      >
        <Image size={16} strokeWidth={1.75} aria-hidden="true" />이미지
      </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/*"
            onChange={handleFileChange}
          />
        </>
      )}

      <span className="toolbar-divider" />

      {/* 7. 실행 취소 / 다시 실행 */}
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="실행 취소 (Ctrl+Z)"
        aria-label="실행 취소"
      >
        <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="다시 실행 (Ctrl+Y)"
        aria-label="다시 실행"
      >
        <Redo2 size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
