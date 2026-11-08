import mongoose from 'mongoose';
import { connectDB } from '../database.js';
import ElnNote from '../models/ElnNote.js';
import ElnVersion from '../models/ElnVersion.js';
import NoteSeal from '../models/NoteSeal.js';
import { htmlToDoc } from '@labhub/note-format/html';
import { docToSafeHtml, normalizeDoc, validateDoc } from '@labhub/note-format';
import { appendAudit } from '../lib/audit.js';

const apply = process.argv.includes('--apply');
const closeDB = await connectDB();
const report = { mode: apply ? 'apply' : 'dry-run', converted: 0, skipped: 0, notes: [] };
try {
  const notes = await ElnNote.find({ contentFormat: { $ne: 'doc' } }).sort({ _id: 1 }).lean();
  for (const note of notes) {
    if (!['진행중', '반려'].includes(note.status)) {
      report.skipped++;
      report.notes.push({ id: String(note._id), skipped: true, reason: 'locked status' });
      continue;
    }
    const seal = await NoteSeal.exists({ noteId: note._id });
    if (seal) {
      report.skipped++;
      report.notes.push({ id: String(note._id), skipped: true, reason: 'sealed' });
      continue;
    }
    const { doc, warnings } = htmlToDoc(note.content || '');
    const validation = validateDoc(doc);
    if (!validation.ok) {
      report.skipped++;
      report.notes.push({ id: String(note._id), skipped: true, warnings, errors: validation.errors });
      continue;
    }
    report.notes.push({ id: String(note._id), skipped: false, warnings });
    report.converted++;
    if (!apply) continue;
    await mongoose.connection.transaction(async (session) => {
      const current = await ElnNote.findById(note._id).session(session);
      if (!current || !['진행중', '반려'].includes(current.status) || await NoteSeal.exists({ noteId: note._id }).session(session)) return;
      await ElnVersion.create([{
        noteId: current._id, version: current.version, title: current.title, content: current.content,
        contentFormat: current.contentFormat || 'html', contentDoc: current.contentDoc,
        reagentsUsed: current.reagentsUsed, snapshot: current.toObject(), updaterName: 'Migration',
        changeReason: 'HTML to block document migration',
      }], { session });
      const before = current.toObject();
      current.contentDoc = normalizeDoc(doc);
      current.content = docToSafeHtml(current.contentDoc);
      current.contentFormat = 'doc';
      current.version += 1;
      await current.save({ session });
      await appendAudit({ userName: 'Migration', action: 'MIGRATE_TO_DOC', targetType: 'ELN', targetId: String(current._id), description: 'HTML note converted to block document', previousState: before, newState: current.toObject(), session });
    });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await closeDB();
}
