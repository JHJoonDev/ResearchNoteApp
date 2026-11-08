import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  feature: { type: String, required: true, enum: ['draftNote', 'generateProtocol', 'extractTables', 'checkNote', 'askNotes'] },
  provenance: { type: mongoose.Schema.Types.Mixed, required: true },
  sourceIds: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now, required: true, index: true },
}, { timestamps: false });

schema.index({ userId: 1, createdAt: -1 });
export default mongoose.model('AiRun', schema);
