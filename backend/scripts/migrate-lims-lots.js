import mongoose from 'mongoose';
import { connectDB } from '../database.js';
import LimsItem from '../models/LimsItem.js';
import LimsLot from '../models/LimsLot.js';
import ElnNote from '../models/ElnNote.js';
import NoteSeal from '../models/NoteSeal.js';
import { roundQuantity } from '../lib/quantity.js';

const apply = process.argv.includes('--apply');
const close = await connectDB();
let candidates = 0, created = 0, notesUpdated = 0, skipped = 0;
try {
  const items = await LimsItem.find({ isDeleted: false }).sort({ _id: 1 });
  for (const item of items) {
    const lotNumber = `LEGACY-${String(item._id)}`;
    if (await LimsLot.exists({ reagentId: item._id, lotNumber })) { skipped++; continue; }
    const notes = await ElnNote.find({ isDeleted: false, 'reagentsUsed.reagentId': item._id }).select('_id reagentsUsed');
    const sealedIds = new Set((await NoteSeal.find({ noteId: { $in: notes.map((note) => note._id) } }).distinct('noteId')).map(String));
    const editable = notes.filter((note) => !sealedIds.has(String(note._id)));
    const historyAmount = roundQuantity(editable.reduce((sum, note) => sum + note.reagentsUsed.filter((use) => String(use.reagentId) === String(item._id) && !(use.allocations || []).length).reduce((n, use) => n + (Number(use.amount) || 0), 0), 0));
    candidates++;
    if (!apply) { notesUpdated += editable.length; continue; }
    await mongoose.connection.transaction(async (session) => {
      const stillMissing = await LimsLot.exists({ reagentId: item._id, lotNumber }).session(session);
      if (stillMissing) return;
      const remainingAmount = roundQuantity(item.stockValue);
      const [lot] = await LimsLot.create([{ reagentId: item._id, lotNumber, initialAmount: roundQuantity(remainingAmount + historyAmount), remainingAmount, unit: item.unit, receivedAt: item.createdAt || new Date(), location: item.location || '미지정', status: remainingAmount > 0 ? '사용가능' : '소진' }], { session });
      for (const note of editable) {
        let changed = false;
        for (const use of note.reagentsUsed) {
          if (String(use.reagentId) !== String(item._id) || (use.allocations || []).length) continue;
          use.amount = roundQuantity(use.amount);
          use.allocations = [{ lotId: lot._id, lotNumber, amount: use.amount }];
          changed = true;
        }
        if (changed) { note.markModified('reagentsUsed'); await note.save({ session }); notesUpdated++; }
      }
      created++;
    });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates, created, notesUpdated, skipped, sealedNotesChanged: 0 }));
} finally { await close(); }
