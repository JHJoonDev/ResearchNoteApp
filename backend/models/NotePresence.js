import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true }, expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ noteId: 1, userId: 1 }, { unique: true });
export default mongoose.model('NotePresence', schema);
