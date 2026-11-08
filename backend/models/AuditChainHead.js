import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  chainKey: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0, required: true },
  hash: String,
}, { timestamps: false });
export default mongoose.model('AuditChainHead', schema);
