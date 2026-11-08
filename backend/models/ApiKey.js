import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true }, prefix: { type: String, required: true, unique: true },
  hash: { type: String, required: true }, scopes: [{ type: String, enum: ['notes:read', 'inventory:read', 'inbox:write'] }],
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: Date, lastUsedAt: Date, revokedAt: Date,
}, { timestamps: true });
export default mongoose.model('ApiKey', schema);
