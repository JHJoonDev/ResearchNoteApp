import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  typeId: { type: mongoose.Schema.Types.ObjectId, ref: 'EntityType', required: true, index: true },
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  values: { type: mongoose.Schema.Types.Mixed, default: {} },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  position: { row: Number, col: Number },
  status: { type: String, enum: ['active', 'in_use', 'retired'], default: 'active' },
  calibrationDueAt: Date,
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });
schema.index(
  { locationId: 1, 'position.row': 1, 'position.col': 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, 'position.row': { $exists: true }, 'position.col': { $exists: true } } },
);
export default mongoose.model('Entity', schema);
