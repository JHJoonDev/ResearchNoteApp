import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  instrumentId: { type: String, required: true }, relativePath: { type: String, required: true },
  capturedAt: { type: Date, required: true }, sha256: { type: String, required: true },
  size: { type: Number, required: true }, storageKey: { type: String, required: true },
  uploadedByKey: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey', required: true },
  status: { type: String, enum: ['new', 'attached', 'dismissed'], default: 'new' },
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote', default: null },
}, { timestamps: true });
schema.index({ instrumentId: 1, relativePath: 1, sha256: 1 }, { unique: true });
schema.index({ status: 1, createdAt: -1 });
export default mongoose.model('InboxFile', schema);
