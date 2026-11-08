import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  name: { type: String, required: true, trim: true },
  kind: { type: String, enum: ['room', 'freezer', 'shelf', 'box', 'other'], required: true },
  grid: { rows: { type: Number, min: 1 }, cols: { type: Number, min: 1 } },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ parentId: 1, name: 1, isDeleted: 1 });
export default mongoose.model('Location', schema);
