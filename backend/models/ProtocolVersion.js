import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  protocolId: { type: mongoose.Schema.Types.ObjectId, ref: 'Protocol', required: true, index: true },
  version: { type: Number, required: true }, snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, publishedAt: { type: Date, default: Date.now },
}, { timestamps: false });
schema.index({ protocolId: 1, version: 1 }, { unique: true });
const immutable = new Error('Published protocol versions are immutable.');
schema.pre('save', function () { if (!this.isNew && this.isModified()) throw immutable; });
for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(method, function () { throw immutable; });
}
export default mongoose.model('ProtocolVersion', schema);
