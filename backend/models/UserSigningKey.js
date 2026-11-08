import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  keyId: { type: String, required: true, unique: true },
  algorithm: { type: String, enum: ['Ed25519'], required: true },
  publicKey: { type: String, required: true },
  encryptedPrivateKey: { type: String, required: true },
  kdf: { salt: String, params: mongoose.Schema.Types.Mixed },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  revokedAt: Date,
  revokeReason: String,
}, { timestamps: false });
schema.index({ userId: 1, active: 1 });
export default mongoose.model('UserSigningKey', schema);
