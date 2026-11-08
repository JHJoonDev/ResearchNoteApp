import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['approval-requested', 'approved', 'rejected', 'mentioned', 'commented'], required: true },
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote', required: true },
  actorName: { type: String, required: true }, message: { type: String, required: true, maxlength: 500 },
  readAt: Date,
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ userId: 1, readAt: 1 });
export default mongoose.model('Notification', schema);
