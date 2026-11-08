import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  root: { type: String, required: true },
  leafCount: { type: Number, required: true },
  chainHeads: { type: mongoose.Schema.Types.Mixed, required: true },
  timestamp: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: false });
const deny = function () { throw new Error('감사 앵커는 시점인증 상태만 변경할 수 있습니다.'); };
for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne']) schema.pre(method, function () {
  const update = this.getUpdate() || {};
  const paths = Object.keys(update).flatMap((key) => key.startsWith('$') ? Object.keys(update[key] || {}) : [key]);
  if (!paths.length || paths.some((key) => key !== 'timestamp' && !key.startsWith('timestamp.'))) deny();
});
for (const method of ['deleteOne', 'deleteMany', 'findOneAndDelete']) schema.pre(method, deny);
schema.pre('save', function () { if (!this.isNew && this.modifiedPaths().some((key) => key !== 'timestamp' && !key.startsWith('timestamp.'))) deny(); });
export default mongoose.model('AuditAnchor', schema);
