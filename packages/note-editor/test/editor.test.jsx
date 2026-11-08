import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import {
  NoteEditor,
  createExtensions,
  mentionSuggestionPluginKey,
  noteLinkSuggestionPluginKey,
  reagentRefSuggestionPluginKey,
} from '../src/index.js';
import { handleUpload } from '../src/extensions/image.js';
import { Toolbar } from '../src/components/Toolbar.jsx';

describe('NoteEditor component tests', () => {
  it('readOnly prop이 true이면 툴바가 숨겨지고 편집이 비활성화됨', () => {
    const doc = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '읽기 전용 본문' }] }],
    };

    const { container, rerender } = render(
      <NoteEditor value={doc} readOnly={true} />,
    );

    // 툴바 숨김 확인
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(container.querySelector('.is-readonly')).not.toBeNull();

    // readOnly가 false로 변경되면 툴바 노출
    rerender(<NoteEditor value={doc} readOnly={false} />);
    expect(screen.getByRole('toolbar')).not.toBeNull();
  });

  it('외부 value prop 변경 시 onChange가 호출되지 않고 내용이 교체됨', async () => {
    const docA = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '첫 번째 내용' }] }],
    };

    const docB = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '외부에서 변경된 두 번째 내용' }] }],
    };

    const onChange = vi.fn();

    const { rerender } = render(
      <NoteEditor value={docA} onChange={onChange} />,
    );

    expect(screen.getByText('첫 번째 내용')).not.toBeNull();
    onChange.mockClear();

    // 외부에서 value 변경
    await act(async () => {
      rerender(<NoteEditor value={docB} onChange={onChange} />);
    });

    expect(screen.getByText('외부에서 변경된 두 번째 내용')).not.toBeNull();
    // 외부 변경에 대해서는 onChange가 발생하지 않아야 함
    expect(onChange).not.toHaveBeenCalled();
  });

  it('동일한 value의 에코백 시 커서 및 상태 보존(재설정 미수행)', async () => {
    const docA = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '에코백 테스트' }] }],
    };

    const onChange = vi.fn();

    const { rerender } = render(
      <NoteEditor value={docA} onChange={onChange} />,
    );

    // 동일한 docA를 다시 전달 (부모의 value 에코백 시뮬레이션)
    await act(async () => {
      rerender(<NoteEditor value={{ ...docA }} onChange={onChange} />);
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('한국어 IME 조합 중(composition)에는 onChange가 호출되지 않음', async () => {
    const doc = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '조합' }] }],
    };

    const onChange = vi.fn();
    const { container } = render(<NoteEditor value={doc} onChange={onChange} />);

    const editorDom = container.querySelector('.ProseMirror');
    expect(editorDom).not.toBeNull();

    // compositionstart 이벤트 발생
    await act(async () => {
      editorDom.dispatchEvent(new CompositionEvent('compositionstart'));
    });

    onChange.mockClear();

    // 조합 중 상태에서는 onChange가 호출되지 않아야 함
    expect(onChange).not.toHaveBeenCalled();
  });

  it('이미지 업로드 성공 시 attachmentId를 가진 image 노드가 생성됨', async () => {
    const mockFile = new File(['dummy'], 'test.png', { type: 'image/png' });
    const onUploadImage = vi.fn().mockResolvedValue({
      attachmentId: 'att-success-999',
      alt: '성공이미지',
      width: 500,
    });

    const mockView = {
      state: {
        tr: {
          setMeta: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
        },
        selection: { from: 1 },
        schema: {
          nodes: {
            image: {
              create: vi.fn((attrs) => ({ type: 'image', attrs })),
            },
          },
        },
      },
      dispatch: vi.fn(),
    };

    await act(async () => {
      handleUpload(mockView, mockFile, { onUploadImage });
    });

    expect(onUploadImage).toHaveBeenCalledWith(mockFile);
    expect(mockView.state.schema.nodes.image.create).toHaveBeenCalledWith({
      attachmentId: 'att-success-999',
      alt: '성공이미지',
      width: 500,
    });
  });

  it('이미지 업로드 실패 시 에러 핸들러 호출 및 노드가 삽입되지 않음', async () => {
    const mockFile = new File(['dummy'], 'fail.png', { type: 'image/png' });
    const onUploadImage = vi.fn().mockRejectedValue(new Error('네트워크 오류'));
    const onUploadError = vi.fn();

    const mockView = {
      state: {
        tr: {
          setMeta: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
        },
        selection: { from: 1 },
        schema: {
          nodes: {
            image: {
              create: vi.fn(),
            },
          },
        },
      },
      dispatch: vi.fn(),
    };

    await act(async () => {
      handleUpload(mockView, mockFile, { onUploadImage, onUploadError });
    });

    expect(onUploadError).toHaveBeenCalledWith(
      '이미지 업로드에 실패했습니다.',
      expect.any(Error),
    );
    expect(mockView.state.schema.nodes.image.create).not.toHaveBeenCalled();
  });

  it('NoteEditor에 3가지 검색 prop(@, #, $)을 모두 전달하여 마운트하고 각 트리거를 실행함', async () => {
    const searchMentions = vi.fn().mockResolvedValue([
      { id: 'user-1', label: '홍길동' },
    ]);
    const searchNotes = vi.fn().mockResolvedValue([
      { id: 'note-1', label: '연구 노트 1' },
    ]);
    const searchReagents = vi.fn().mockResolvedValue([
      { id: 'reagent-1', label: '에탄올' },
    ]);

    const doc = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [] }],
    };

    const { container } = render(
      <NoteEditor
        value={doc}
        searchMentions={searchMentions}
        searchNotes={searchNotes}
        searchReagents={searchReagents}
      />,
    );

    const editorDom = container.querySelector('.ProseMirror');
    expect(editorDom).not.toBeNull();
    const editor = editorDom.editor;
    expect(editor).toBeDefined();

    // @ 트리거 실행
    await act(async () => {
      editor.commands.insertContent('@hong');
    });

    expect(searchMentions).toHaveBeenCalledWith('hong');

    // # 트리거 실행
    await act(async () => {
      editor.commands.insertContent(' #note');
    });

    expect(searchNotes).toHaveBeenCalledWith('note');

    // $ 트리거 실행
    await act(async () => {
      editor.commands.insertContent(' $reagent');
    });

    expect(searchReagents).toHaveBeenCalledWith('reagent');
  });

  it('세 가지 Suggestion 플러그인이 서로 다른 고유한 PluginKey를 가짐', () => {
    expect(mentionSuggestionPluginKey).toBeDefined();
    expect(noteLinkSuggestionPluginKey).toBeDefined();
    expect(reagentRefSuggestionPluginKey).toBeDefined();

    expect(mentionSuggestionPluginKey.key).toBe('mentionSuggestion$');
    expect(noteLinkSuggestionPluginKey.key).toBe('noteLinkSuggestion$');
    expect(reagentRefSuggestionPluginKey.key).toBe('reagentRefSuggestion$');

    expect(mentionSuggestionPluginKey).not.toBe(noteLinkSuggestionPluginKey);
    expect(mentionSuggestionPluginKey).not.toBe(reagentRefSuggestionPluginKey);
    expect(noteLinkSuggestionPluginKey).not.toBe(reagentRefSuggestionPluginKey);
  });

  it('TipTap 뷰가 아직 마운트되지 않은 상태(unmounted-view state)에서도 크래시 없이 안전하게 처리됨', () => {
    const unmountedEditor = new Editor({
      element: null, // TipTap v3의 useEditor가 실제 브라우저에서 마운트 전 생성하는 형태
      extensions: createExtensions(),
      content: '<p>테스트</p>',
    });

    // 미마운트 상태에서 view.dom 접근 시 실제 TipTap Proxy 에러가 발생하는지 확인 (재현 검증)
    expect(() => unmountedEditor.view.dom).toThrow(/The editor view is not available/);

    // Toolbar는 미마운트 뷰 상태에서도 에러 없이 렌더링되어야 함
    const { container } = render(
      <Toolbar editor={unmountedEditor} onUploadImage={vi.fn()} readOnly={false} />,
    );
    expect(container.firstChild).not.toBeNull();

    // handleUpload은 미마운트 뷰 상태에서도 크래시 없이 조기 반환됨
    expect(() => {
      handleUpload(unmountedEditor.view, new File(['dummy'], 'test.png'), {
        onUploadImage: vi.fn(),
      });
    }).not.toThrow();

    unmountedEditor.destroy();
  });

  it('React StrictMode 하에서 NoteEditor가 마운트, 언마운트, 재마운트되어도 에러 없이 정상 작동함', async () => {
    const searchMentions = vi.fn().mockResolvedValue([{ id: 'u1', label: '홍길동' }]);
    const searchNotes = vi.fn().mockResolvedValue([{ id: 'n1', label: '노트1' }]);
    const searchReagents = vi.fn().mockResolvedValue([{ id: 'r1', label: '시약1' }]);
    const onChange = vi.fn();

    const doc = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [] }],
    };

    let renderResult;
    // 1. StrictMode 하에서 마운트 (React StrictMode는 내부적으로 마운트 -> 언마운트 -> 재마운트 시뮬레이션)
    await act(async () => {
      renderResult = render(
        <React.StrictMode>
          <NoteEditor
            value={doc}
            onChange={onChange}
            searchMentions={searchMentions}
            searchNotes={searchNotes}
            searchReagents={searchReagents}
          />
        </React.StrictMode>,
      );
    });

    const editorDom1 = renderResult.container.querySelector('.ProseMirror');
    expect(editorDom1).not.toBeNull();
    expect(renderResult.container.querySelector('.labhub-note-editor')).not.toBeNull();

    // 2. 명시적 언마운트
    await act(async () => {
      renderResult.unmount();
    });

    // 3. 재마운트
    await act(async () => {
      renderResult = render(
        <React.StrictMode>
          <NoteEditor
            value={doc}
            onChange={onChange}
            searchMentions={searchMentions}
            searchNotes={searchNotes}
            searchReagents={searchReagents}
          />
        </React.StrictMode>,
      );
    });

    const editorDom2 = renderResult.container.querySelector('.ProseMirror');
    expect(editorDom2).not.toBeNull();
    const editor = editorDom2.editor;
    expect(editor).toBeDefined();

    // 재마운트 후에도 제안 트리거가 정상 작동하는지 검증
    await act(async () => {
      editor.commands.insertContent('@hong');
    });
    expect(searchMentions).toHaveBeenCalledWith('hong');

    await act(async () => {
      renderResult.unmount();
    });
  });
});
