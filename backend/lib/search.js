import mongoose from 'mongoose';
import { createSearchIndex, noteToRecord } from '@labhub/search-index';
import ElnNote from '../models/ElnNote.js';

const provider = process.env.SEARCH_PROVIDER || 'memory';
if (!['memory', 'meilisearch'].includes(provider)) throw new Error('SEARCH_PROVIDER는 memory 또는 meilisearch여야 합니다.');
export const searchIndex = createSearchIndex({
  provider,
  host: process.env.MEILI_URL,
  apiKey: process.env.MEILI_API_KEY,
  indexUid: process.env.MEILI_INDEX_UID || 'labhub_search',
});

let initializedDb;
let setupPromise;
export async function ensureSearchIndex() {
  if (mongoose.connection.readyState !== 1) return;
  const key = `${mongoose.connection.name}:${mongoose.connection.host}`;
  if (initializedDb === key) return;
  if (!setupPromise) {
    setupPromise = (async () => {
      await searchIndex.ensureSetup();
      if (provider === 'memory') await searchIndex.clear();
      let offset = 0;
      while (true) {
        const notes = await ElnNote.find({}).sort({ _id: 1 }).skip(offset).limit(500).lean();
        if (!notes.length) break;
        await searchIndex.upsert(notes.map(noteToRecord));
        offset += notes.length;
      }
      initializedDb = key;
    })().finally(() => { setupPromise = undefined; });
  }
  await setupPromise;
}

export async function indexNoteAfterCommit(note) {
  try {
    await ensureSearchIndex();
    if (!note) return;
    await searchIndex.upsert([noteToRecord(note.toObject ? note.toObject() : note)]);
  } catch (error) {
    console.error('Search index update failed:', error);
  }
}

export async function rebuildSearchIndex() {
  await searchIndex.ensureSetup();
  await searchIndex.clear();
  const notes = await ElnNote.find({}).sort({ _id: 1 }).lean();
  for (let offset = 0; offset < notes.length; offset += 500) await searchIndex.upsert(notes.slice(offset, offset + 500).map(noteToRecord));
  initializedDb = `${mongoose.connection.name}:${mongoose.connection.host}`;
  return notes.length;
}
