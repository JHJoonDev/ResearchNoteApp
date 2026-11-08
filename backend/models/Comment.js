import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote', required: true, index: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, authorName: { type: String, required: true },
  body: { type: String, required: true, maxlength: 4000 }, blockIndex: { type: Number, default: null, min: 0 },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], resolvedAt: Date, editedAt: Date,
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ noteId: 1, createdAt: 1 });
export default mongoose.model('Comment', schema);
