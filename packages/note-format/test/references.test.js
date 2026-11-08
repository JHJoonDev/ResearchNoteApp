import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReferences } from '../src/references.js';

test('collectReferences - 중복 제거 및 리소스 ID 추출', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { userId: 'user-1', label: '연구원 A' } },
          { type: 'mention', attrs: { userId: 'user-2', label: '연구원 B' } },
          { type: 'mention', attrs: { userId: 'user-1', label: '연구원 A(중복)' } },
          { type: 'reagentRef', attrs: { reagentId: 'reagent-100', label: '에탄올' } },
          { type: 'reagentRef', attrs: { reagentId: 'reagent-100', label: '에탄올' } },
          { type: 'noteLink', attrs: { noteId: 'note-999', label: '노트 999' } },
        ],
      },
      {
        type: 'image',
        attrs: { attachmentId: 'att-1', alt: 'img1' },
      },
      {
        type: 'image',
        attrs: { attachmentId: 'att-1', alt: 'img1 duplicate' },
      },
      {
        type: 'image',
        attrs: { attachmentId: 'att-2', alt: 'img2' },
      },
    ],
  };

  const refs = collectReferences(doc);
  assert.deepEqual(refs.userIds.sort(), ['user-1', 'user-2']);
  assert.deepEqual(refs.reagentIds, ['reagent-100']);
  assert.deepEqual(refs.noteIds, ['note-999']);
  assert.deepEqual(refs.attachmentIds.sort(), ['att-1', 'att-2']);
});
