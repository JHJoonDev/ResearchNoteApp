import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  userName: {
    type: String,
    required: true,
    default: 'System'
  },
  userEmail: {
    type: String,
    required: false
  },
  apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey' },
  action: {
    type: String,
    required: true, // e.g. 'LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'SIGN'
  },
  targetType: {
    type: String,
    required: true, // e.g. 'USER', 'ELN', 'LIMS'
  },
  targetId: {
    type: String,
    required: false
  },
  description: {
    type: String,
    required: true
  },
  chainKey: { type: String },
  seq: { type: Number },
  prevHash: { type: String, default: null },
  hash: { type: String },
  ipAddress: {
    type: String,
    required: false
  },
  previousState: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  newState: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  }
}, {
  timestamps: true
});

auditLogSchema.index({ chainKey: 1, seq: 1 }, { unique: true, partialFilterExpression: { chainKey: { $type: 'string' } } });
const immutable = function () { throw new Error('감사 기록은 수정·삭제할 수 없습니다.'); };
for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove', 'remove']) auditLogSchema.pre(method, immutable);
auditLogSchema.pre('save', function () { if (!this.isNew) immutable(); });

export default mongoose.model('AuditLog', auditLogSchema);
