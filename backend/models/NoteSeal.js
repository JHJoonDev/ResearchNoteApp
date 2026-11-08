import mongoose from 'mongoose';
const signature = new mongoose.Schema({
  role: { type: String, enum: ['author', 'reviewer'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  keyId: String,
  algorithm: { type: String, default: 'Ed25519' },
  publicKey: String,
  signature: String,
  signedAt: Date,
  comment: String,
}, { _id: false });
const schema = new mongoose.Schema({
  verifyId: { type: String, required: true, unique: true, index: true },
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote', required: true, index: true },
  noteVersion: { type: Number, required: true },
  manifest: { type: mongoose.Schema.Types.Mixed, required: true },
  manifestSha256: { type: String, required: true },
  pdfPath: { type: String },
  storageKey: String,
  pdfSha256: { type: String, required: true },
  signatures: [signature],
  sealHash: { type: String, required: true, unique: true, index: true },
  timestamp: {
    provider: String,
    status: { type: String, enum: ['pending', 'granted', 'failed', 'not_configured'], required: true },
    tokenBase64: String,
    genTime: Date,
    tsaName: String,
    serial: String,
    attempts: { type: Number, default: 0 },
    lastError: String,
    requestedAt: Date,
    grantedAt: Date,
    nextAttemptAt: Date,
    lockedAt: Date,
    lockId: String,
    isTrusted: { type: Boolean, default: false },
  },
  retainUntil: Date,
  createdAt: { type: Date, default: Date.now },
}, { timestamps: false });
const immutableMessage = '봉인 기록은 시점인증 상태만 변경할 수 있습니다.';
for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne']) {
  schema.pre(method, function () {
    const update = this.getUpdate() || {};
    const paths = Object.keys(update).flatMap((key) => key.startsWith('$') ? Object.keys(update[key] || {}) : [key]);
    if (!paths.length || paths.some((key) => key !== 'storageKey' && key !== 'timestamp' && !key.startsWith('timestamp.'))) throw new Error(immutableMessage);
  });
}
for (const method of ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove', 'remove']) {
  schema.pre(method, function () { throw new Error(immutableMessage); });
}
schema.pre('save', function () {
  if (!this.isNew && this.modifiedPaths().some((key) => key !== 'storageKey' && key !== 'timestamp' && !key.startsWith('timestamp.'))) throw new Error(immutableMessage);
});
export default mongoose.model('NoteSeal', schema);
