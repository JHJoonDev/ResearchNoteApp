import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 4000 },
  status: { type: String, enum: ['active', 'done', 'archived'], default: 'active' },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

schema.index({ projectId: 1, isDeleted: 1, updatedAt: -1 });
export default mongoose.model('Experiment', schema);
