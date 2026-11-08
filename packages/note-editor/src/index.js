/**
 * @fileoverview @labhub/note-editor 공개 진입점
 */

export { NoteEditor } from './components/NoteEditor.jsx';
export { createExtensions } from './extensions/index.js';
export { toNoteDoc, fromNoteDoc } from './adapters.js';
export {
  MentionSuggestion,
  NoteLinkSuggestion,
  ReagentRefSuggestion,
  mentionSuggestionPluginKey,
  noteLinkSuggestionPluginKey,
  reagentRefSuggestionPluginKey,
} from './extensions/suggestions.js';
