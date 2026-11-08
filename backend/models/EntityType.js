import mongoose from 'mongoose';

const field = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  kind: { type: String, enum: ['text', 'number', 'date', 'select'], required: true },
  options: [{ type: String }],
  required: { type: Boolean, default: false },
}, { _id: false });
const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['sample', 'equipment', 'other'], required: true },
  fields: { type: [field], default: [] },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });
export default mongoose.model('EntityType', schema);
