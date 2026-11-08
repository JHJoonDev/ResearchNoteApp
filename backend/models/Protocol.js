import mongoose from 'mongoose';

const checklist = new mongoose.Schema({ id: { type: String, required: true }, text: { type: String, required: true, maxlength: 500 } }, { _id: false });
const resultField = new mongoose.Schema({
  id: { type: String, required: true }, name: { type: String, required: true, maxlength: 200 },
  unit: { type: String, default: '', maxlength: 80 }, kind: { type: String, enum: ['text', 'number'], required: true },
}, { _id: false });
const step = new mongoose.Schema({
  id: { type: String, required: true }, title: { type: String, required: true, maxlength: 200 },
  instructions: { type: String, default: '', maxlength: 10000 }, checklist: { type: [checklist], default: [] },
  resultFields: { type: [resultField], default: [] },
}, { _id: false });
const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 }, description: { type: String, default: '', maxlength: 4000 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' }, version: { type: Number, default: 1 },
  steps: { type: [step], default: [] }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ projectId: 1, status: 1, isDeleted: 1, updatedAt: -1 });
export default mongoose.model('Protocol', schema);
