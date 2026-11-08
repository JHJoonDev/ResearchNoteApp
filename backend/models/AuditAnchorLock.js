import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  lockedUntil: Date,
  lastAnchorAt: Date,
}, { timestamps: false });
export default mongoose.model('AuditAnchorLock', schema);
