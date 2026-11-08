/**
 * @fileoverview TipTap Suggestion 기반 @(사용자), #(노트), $(시약) 자동완성 확장
 */

import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

export const mentionSuggestionPluginKey = new PluginKey('mentionSuggestion');
export const noteLinkSuggestionPluginKey = new PluginKey('noteLinkSuggestion');
export const reagentRefSuggestionPluginKey = new PluginKey('reagentRefSuggestion');

/**
 * 멘션(@) 자동완성 확장
 */
export const MentionSuggestion = Extension.create({
  name: 'mentionSuggestion',

  addOptions() {
    return {
      pluginKey: mentionSuggestionPluginKey,
      searchMentions: null,
      suggestionRender: null,
    };
  },

  addProseMirrorPlugins() {
    const search = this.options.searchMentions;
    const render = this.options.suggestionRender;
    const pluginKey = this.options.pluginKey || mentionSuggestionPluginKey;

    if (typeof search !== 'function') return [];

    return [
      Suggestion({
        pluginKey,
        editor: this.editor,
        char: '@',
        allowSpaces: false,
        items: async ({ query }) => {
          try {
            const results = await search(query);
            return Array.isArray(results) ? results : [];
          } catch {
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          if (!editor || editor.isDestroyed) return;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: 'mention',
                attrs: {
                  userId: String(props.id ?? props.userId ?? ''),
                  label: String(props.label ?? props.name ?? ''),
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: render ? () => render('@') : undefined,
      }),
    ];
  },
});

/**
 * 노트 링크(#) 자동완성 확장
 */
export const NoteLinkSuggestion = Extension.create({
  name: 'noteLinkSuggestion',

  addOptions() {
    return {
      pluginKey: noteLinkSuggestionPluginKey,
      searchNotes: null,
      suggestionRender: null,
    };
  },

  addProseMirrorPlugins() {
    const search = this.options.searchNotes;
    const render = this.options.suggestionRender;
    const pluginKey = this.options.pluginKey || noteLinkSuggestionPluginKey;

    if (typeof search !== 'function') return [];

    return [
      Suggestion({
        pluginKey,
        editor: this.editor,
        char: '#',
        allowSpaces: false,
        items: async ({ query }) => {
          try {
            const results = await search(query);
            return Array.isArray(results) ? results : [];
          } catch {
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          if (!editor || editor.isDestroyed) return;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: 'noteLink',
                attrs: {
                  noteId: String(props.id ?? props.noteId ?? ''),
                  label: String(props.label ?? props.title ?? ''),
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: render ? () => render('#') : undefined,
      }),
    ];
  },
});

/**
 * 시약 참조($) 자동완성 확장
 */
export const ReagentRefSuggestion = Extension.create({
  name: 'reagentRefSuggestion',

  addOptions() {
    return {
      pluginKey: reagentRefSuggestionPluginKey,
      searchReagents: null,
      suggestionRender: null,
    };
  },

  addProseMirrorPlugins() {
    const search = this.options.searchReagents;
    const render = this.options.suggestionRender;
    const pluginKey = this.options.pluginKey || reagentRefSuggestionPluginKey;

    if (typeof search !== 'function') return [];

    return [
      Suggestion({
        pluginKey,
        editor: this.editor,
        char: '$',
        allowSpaces: false,
        items: async ({ query }) => {
          try {
            const results = await search(query);
            return Array.isArray(results) ? results : [];
          } catch {
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          if (!editor || editor.isDestroyed) return;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: 'reagentRef',
                attrs: {
                  reagentId: String(props.id ?? props.reagentId ?? ''),
                  label: String(props.label ?? props.name ?? ''),
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: render ? () => render('$') : undefined,
      }),
    ];
  },
});
