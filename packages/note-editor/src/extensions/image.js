/**
 * @fileoverview 이미지 노드 확장 및 업로드/붙여넣기/드롭 처리
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const imageUploadPluginKey = new PluginKey('imageUpload');

export const ImageExtension = Node.create({
  name: 'image',
  group: 'block',
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return {
      resolveImageUrl: null,
      onUploadImage: null,
      onUploadError: null,
    };
  },

  addAttributes() {
    return {
      attachmentId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-attachment-id') || '',
        renderHTML: (attrs) => ({ 'data-attachment-id': attrs.attachmentId }),
      },
      alt: {
        default: '',
        parseHTML: (el) => el.getAttribute('alt') || '',
        renderHTML: (attrs) => ({ alt: attrs.alt }),
      },
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width') || null,
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-attachment-id]',
        getAttrs: (dom) => ({
          attachmentId: dom.getAttribute('data-attachment-id') || '',
          alt: dom.getAttribute('alt') || '',
          width: dom.getAttribute('width') || null,
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(
        {
          'data-attachment-id': node.attrs.attachmentId,
          alt: node.attrs.alt || '',
        },
        HTMLAttributes,
      ),
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const container = document.createElement('div');
      container.className = 'note-image-container';

      const img = document.createElement('img');
      img.setAttribute('data-attachment-id', node.attrs.attachmentId || '');
      img.alt = node.attrs.alt || '';
      if (node.attrs.width) {
        img.style.width = typeof node.attrs.width === 'number' ? `${node.attrs.width}px` : node.attrs.width;
      }

      container.appendChild(img);

      const resolve = this.options.resolveImageUrl;
      if (typeof resolve === 'function' && node.attrs.attachmentId) {
        Promise.resolve(resolve(node.attrs.attachmentId))
          .then((url) => {
            if (url) {
              img.src = url;
            }
          })
          .catch(() => {
            img.alt = `${node.attrs.alt || '이미지'} (불러오기 실패)`;
          });
      }

      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;
          if (updatedNode.attrs.attachmentId !== node.attrs.attachmentId) {
            img.setAttribute('data-attachment-id', updatedNode.attrs.attachmentId || '');
            if (typeof resolve === 'function' && updatedNode.attrs.attachmentId) {
              resolve(updatedNode.attrs.attachmentId).then((url) => {
                if (url) img.src = url;
              });
            }
          }
          if (updatedNode.attrs.alt !== node.attrs.alt) {
            img.alt = updatedNode.attrs.alt || '';
          }
          if (updatedNode.attrs.width !== node.attrs.width) {
            img.style.width = updatedNode.attrs.width
              ? typeof updatedNode.attrs.width === 'number' ? `${updatedNode.attrs.width}px` : updatedNode.attrs.width
              : '';
          }
          return true;
        },
      };
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: imageUploadPluginKey,
        state: {
          init() {
            return { decos: DecorationSet.empty, uploads: new Map() };
          },
          apply(tr, prev) {
            let decos = prev.decos.map(tr.mapping, tr.doc);
            const action = tr.getMeta(imageUploadPluginKey);
            if (!action) return { ...prev, decos };

            const uploads = new Map(prev.uploads);

            if (action.type === 'start') {
              const widget = document.createElement('div');
              widget.className = 'note-image-uploading';
              widget.textContent = '이미지 업로드 중...';

              const deco = Decoration.widget(action.pos, widget, { id: action.id });
              decos = decos.add(tr.doc, [deco]);
              uploads.set(action.id, { pos: action.pos });
            } else if (action.type === 'finish' || action.type === 'fail') {
              const found = decos.find(undefined, undefined, (spec) => spec.id === action.id);
              if (found.length > 0) {
                decos = decos.remove(found);
              }
              uploads.delete(action.id);
            }

            return { decos, uploads };
          },
        },
        props: {
          decorations(state) {
            return imageUploadPluginKey.getState(state)?.decos;
          },
          handlePaste(view, event) {
            const files = event.clipboardData?.files;
            if (!files || files.length === 0) return false;

            const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'));
            if (!imageFile) return false;

            if (typeof options.onUploadImage === 'function') {
              handleUpload(view, imageFile, options);
              return true;
            }
            return false;
          },
          handleDrop(view, event) {
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'));
            if (!imageFile) return false;

            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords)?.pos ?? view.state.selection.from;

            if (typeof options.onUploadImage === 'function') {
              handleUpload(view, imageFile, options, pos);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/**
 * 이미지 업로드를 실행하고 임시 위젯을 관리합니다.
 */
export function handleUpload(view, file, options, customPos = null) {
  if (!view || !options || typeof options.onUploadImage !== 'function') {
    return;
  }

  // view가 unmounted proxy(접근 시 throw)이거나 파괴된 경우 조기 반환
  try {
    if (view.isDestroyed) return;
    void view.dom;
  } catch {
    return;
  }

  const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pos = customPos !== null ? customPos : view.state.selection?.from ?? 0;

  // 1) 시작 데코레이션 삽입
  try {
    view.dispatch(
      view.state.tr.setMeta(imageUploadPluginKey, {
        type: 'start',
        id,
        pos,
      }),
    );
  } catch {
    // view dispatch 실패 시 중단
    return;
  }

  // 2) 업로드 비동기 실행
  Promise.resolve(options.onUploadImage(file))
    .then((result) => {
      if (!view || view.isDestroyed || !view.state || typeof view.dispatch !== 'function') {
        return;
      }
      if (!result || !result.attachmentId) {
        throw new Error('attachmentId가 반환되지 않았습니다.');
      }

      const state = view.state;
      const uploadState = imageUploadPluginKey.getState(state);
      const decos = uploadState?.decos.find(undefined, undefined, (spec) => spec.id === id);
      const insertPos = decos && decos.length > 0 ? decos[0].from : view.state.selection?.from ?? 0;

      const imageNode = state.schema.nodes.image.create({
        attachmentId: result.attachmentId,
        alt: result.alt || '',
        width: result.width || null,
      });

      let tr = state.tr;
      tr = tr.setMeta(imageUploadPluginKey, { type: 'finish', id });
      tr = tr.insert(insertPos, imageNode);
      view.dispatch(tr);
    })
    .catch((err) => {
      if (view && !view.isDestroyed && view.state && typeof view.dispatch === 'function') {
        try {
          view.dispatch(
            view.state.tr.setMeta(imageUploadPluginKey, {
              type: 'fail',
              id,
            }),
          );
        } catch {
          // ignore dispatch failure on unmounted view
        }
      }

      const errorMsg = '이미지 업로드에 실패했습니다.';
      if (typeof options.onUploadError === 'function') {
        options.onUploadError(errorMsg, err);
      } else if (typeof alert === 'function') {
        alert(errorMsg);
      }
    });
}
