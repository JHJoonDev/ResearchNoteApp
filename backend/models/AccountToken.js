import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true }, purpose: { type: String, enum: ['password-reset', 'invite'], required: true },
  expiresAt: { type: Date, required: true }, usedAt: Date, createdAt: { type: Date, default: Date.now },
}, { timestamps: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export default mongoose.model('AccountToken', schema);
