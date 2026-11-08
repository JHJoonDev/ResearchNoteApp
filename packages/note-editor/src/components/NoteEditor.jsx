/**
 * @fileoverview TipTap 기반 연구노트 블록 편집기 메인 컴포넌트
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { createExtensions } from '../extensions/index.js';
import { toNoteDoc, fromNoteDoc } from '../adapters.js';
import { Toolbar } from './Toolbar.jsx';
import { SuggestionList } from './SuggestionList.jsx';

/**
 * @typedef {Object} NoteEditorProps
 * @property {Record<string, any>} [value]
 * @property {(noteDoc: Record<string, any>) => void} [onChange]
 * @property {boolean} [readOnly]
 * @property {string} [placeholder]
 * @property {(file: File) => Promise<{ attachmentId: string, alt?: string, width?: number }>} [onUploadImage]
 * @property {(attachmentId: string) => Promise<string>} [resolveImageUrl]
 * @property {(query: string) => Promise<Array<{ id: string, label: string }>>} [searchMentions]
 * @property {(query: string) => Promise<Array<{ id: string, label: string }>>} [searchNotes]
 * @property {(query: string) => Promise<Array<{ id: string, label: string }>>} [searchReagents]
 */

export function NoteEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  onUploadImage,
  resolveImageUrl,
  searchMentions,
  searchNotes,
  searchReagents,
}) {
  const isExternalUpdate = useRef(false);
  const lastEmittedDoc = useRef(null);
  const suggestionListRef = useRef(null);

  const [suggestionState, setSuggestionState] = useState({
    active: false,
    char: '@',
    items: [],
    command: null,
    clientRect: null,
  });

  const suggestionRender = useMemo(() => {
    return (char) => ({
      onStart: (props) => {
        setSuggestionState({
          active: true,
          char,
          items: props.items || [],
          command: props.command,
          clientRect: props.clientRect,
        });
      },
      onUpdate: (props) => {
        setSuggestionState((prev) => ({
          ...prev,
          items: props.items || [],
          command: props.command,
          clientRect: props.clientRect,
        }));
      },
      onKeyDown: (props) => {
        if (suggestionListRef.current) {
          return suggestionListRef.current.onKeyDown(props);
        }
        return false;
      },
      onExit: () => {
        setSuggestionState({
          active: false,
          char: '@',
          items: [],
          command: null,
          clientRect: null,
        });
      },
    });
  }, []);

  const extensions = useMemo(() => {
    return createExtensions({
      onUploadImage,
      resolveImageUrl,
      searchMentions,
      searchNotes,
      searchReagents,
      suggestionRender,
    });
  }, [
    onUploadImage,
    resolveImageUrl,
    searchMentions,
    searchNotes,
    searchReagents,
    suggestionRender,
  ]);

  const editor = useEditor({
    extensions,
    content: fromNoteDoc(value),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      // 1) 한국어 IME 조합 중일 때는 onChange를 발행하지 않음
      let isComposing = false;
      try {
        isComposing = Boolean(editor.view?.composing);
      } catch {
        isComposing = false;
      }
      if (isComposing) {
        return;
      }
      if (isExternalUpdate.current) {
        return;
      }

      const noteDoc = toNoteDoc(editor.getJSON());
      lastEmittedDoc.current = noteDoc;
      onChange?.(noteDoc);
    },
  });

  // 한국어 IME 조합 종료 시(compositionend) 변경 감지 및 발행
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let attachedDom = null;

    const handleCompositionEnd = () => {
      setTimeout(() => {
        if (!editor || editor.isDestroyed) return;
        const currentDoc = toNoteDoc(editor.getJSON());
        if (JSON.stringify(currentDoc) !== JSON.stringify(lastEmittedDoc.current)) {
          lastEmittedDoc.current = currentDoc;
          onChange?.(currentDoc);
        }
      }, 20);
    };

    const attach = () => {
      if (!editor || editor.isDestroyed) return;
      try {
        const dom = editor.view?.dom;
        if (dom && dom !== attachedDom) {
          if (attachedDom) {
            attachedDom.removeEventListener('compositionend', handleCompositionEnd);
          }
          dom.addEventListener('compositionend', handleCompositionEnd);
          attachedDom = dom;
        }
      } catch {
        // TipTap view가 아직 마운트되지 않은 경우(v3 지연 마운트) 안전하게 무시
      }
    };

    const detach = () => {
      if (attachedDom) {
        attachedDom.removeEventListener('compositionend', handleCompositionEnd);
        attachedDom = null;
      }
    };

    // 1) 이미 mount된 상태라면 즉시 리스너 부착
    attach();

    // 2) TipTap mount / unmount 이벤트 구독 (지연 마운트 및 StrictMode 재마운트 대응)
    const onMount = () => {
      attach();
    };
    const onUnmount = () => {
      detach();
    };

    editor.on('mount', onMount);
    editor.on('unmount', onUnmount);

    return () => {
      detach();
      if (!editor.isDestroyed) {
        editor.off('mount', onMount);
        editor.off('unmount', onUnmount);
      }
    };
  }, [editor, onChange]);

  // readOnly 변경 반영
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  // 외부 value 변경 및 에코백 방지 (커서 보존)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const currentNoteDoc = toNoteDoc(editor.getJSON());

    // 만약 현재 에디터 내용과 value가 동일하다면 에코백이므로 커서 보존을 위해 무시
    if (JSON.stringify(currentNoteDoc) === JSON.stringify(value)) {
      return;
    }

    // 진정한 외부 변경일 때만 setContent 수행 (onChange 미발생)
    isExternalUpdate.current = true;
    editor.commands.setContent(fromNoteDoc(value), false);
    lastEmittedDoc.current = toNoteDoc(editor.getJSON());
    isExternalUpdate.current = false;
  }, [editor, value]);

  // 제안 팝업 좌표 계산
  const popupCoords = useMemo(() => {
    if (!suggestionState.active || !suggestionState.clientRect) return null;
    try {
      const rect = suggestionState.clientRect();
      if (!rect) return null;

      return {
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
      };
    } catch {
      return null;
    }
  }, [suggestionState.active, suggestionState.clientRect]);

  return (
    <div className={`labhub-note-editor ${readOnly ? 'is-readonly' : ''}`}>
      {!readOnly && (
        <Toolbar
          editor={editor}
          onUploadImage={onUploadImage}
          readOnly={readOnly}
        />
      )}

      <div className="note-editor-content-wrapper">
        <EditorContent editor={editor} />
      </div>

      {suggestionState.active && popupCoords && (
        <div
          className="note-suggestion-container"
          style={{
            position: 'absolute',
            top: popupCoords.top,
            left: popupCoords.left,
            zIndex: 9999,
          }}
        >
          <SuggestionList
            ref={suggestionListRef}
            char={suggestionState.char}
            items={suggestionState.items}
            command={suggestionState.command}
          />
        </div>
      )}
    </div>
  );
}
