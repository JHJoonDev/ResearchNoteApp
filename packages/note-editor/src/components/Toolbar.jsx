/**
 * @fileoverview TipTap 에디터 한국어 툴바 컴포넌트
 */

import React, { useRef } from 'react';
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
      >
        <strong>B</strong>
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="기울임 (Ctrl+I)"
      >
        <em>I</em>
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="밑줄 (Ctrl+U)"
      >
        <u>U</u>
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="취소선"
      >
        <s>S</s>
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('code') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="인라인 코드"
      >
        <code>{'<>'}</code>
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('subscript') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        title="아래첨자"
      >
        X<sub>2</sub>
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('superscript') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        title="위첨자"
      >
        X<sup>2</sup>
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('link') ? 'is-active' : ''}`}
        onClick={handleLink}
        title="링크"
      >
        🔗
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
      >
        ≡L
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
      >
        ≡C
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
      >
        ≡R
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
      >
        ≡J
      </button>

      <span className="toolbar-divider" />

      {/* 4. 목록 및 블록 */}
      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="글머리 기호 목록"
      >
        • 목록
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="번호 매기기 목록"
      >
        1. 목록
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('taskList') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="할 일 목록"
      >
        ☑ 할일
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="인용구"
      >
        ❝ 인용
      </button>

      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('codeBlock') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="코드 블록"
      >
        코드
      </button>

      <button
        type="button"
        className="toolbar-btn"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="구분선"
      >
        ―
      </button>

      <span className="toolbar-divider" />

      {/* 5. 표 */}
      <button
        type="button"
        className={`toolbar-btn ${editor.isActive('table') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        title="표 삽입"
      >
        ⊞ 표
      </button>

      {editor.isActive('table') && (
        <>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            title="행 아래 추가"
          >
            +행
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().deleteRow().run()}
            title="행 삭제"
          >
            -행
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            title="열 오른쪽 추가"
          >
            +열
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            title="열 삭제"
          >
            -열
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().mergeCells().run()}
            title="셀 병합"
          >
            병합
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor.chain().focus().deleteTable().run()}
            title="표 삭제"
          >
            표삭제
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
      >
        f(x)
      </button>

      <button
        type="button"
        className="toolbar-btn"
        onClick={handleAddMathBlock}
        title="블록 수식 삽입"
      >
        ∑ 수식
      </button>

      {onUploadImage && (
        <>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleImageClick}
            title="이미지 업로드"
          >
            🖼 이미지
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
      >
        ↺
      </button>
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="다시 실행 (Ctrl+Y)"
      >
        ↻
      </button>
    </div>
  );
}
