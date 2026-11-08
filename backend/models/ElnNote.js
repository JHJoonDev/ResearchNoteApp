import mongoose from 'mongoose';

const entityUsedSchema = new mongoose.Schema({
  entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity' },
  code: String,
  name: String,
  typeName: String,
}, { _id: false });

const elnNoteSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tags: [{ type: String }],
    requestId: String,
    requestHash: String,
    title: {
      type: String,
      required: true,
    },
    author: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['진행중', '승인대기', '승인됨', '반려'],
      default: '진행중',
    },
    date: {
      type: String,
    },
    content: {
      type: String, // Store RichText HTML
      default: '',
    },
    contentFormat: { type: String, enum: ['html', 'doc'], default: 'html', index: true },
    contentDoc: { type: mongoose.Schema.Types.Mixed, default: undefined },
    experimentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experiment', default: null, index: true },
    protocolRun: { type: mongoose.Schema.Types.Mixed, default: undefined },
    reagentsUsed: [
      {
        reagentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LimsItem' },
        name: String,
        amount: Number,
        unit: String,
        lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'LimsLot' },
        allocations: [{ lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'LimsLot' }, lotNumber: String, amount: Number }],
      },
    ],
    entitiesUsed: { type: [entityUsedSchema], default: [] },
    aiRuns: {
      type: [{
        _id: false,
        runId: { type: String, required: true },
        feature: { type: String, required: true },
        model: { type: String, required: true },
        outputSha256: { type: String, required: true },
        createdAt: { type: Date, required: true },
      }],
      default: [],
    },
    version: {
      type: Number,
      default: 1,
    },
    signatures: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: String,
        email: String,
        role: String,
        signedAt: { type: Date, default: Date.now },
        comment: String,
        keyId: String,
        algorithm: String,
        publicKey: String,
        signature: String,
        manifestSha256: String,
        isValid: { type: Boolean, default: true },
        invalidatedAt: Date,
        signatureHash: String,
        contentHash: String,
        version: Number,
        decision: String,
      },
    ],
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: false, // 기존 데이터 하위 호환성을 위해 우선 false 설정
    },
    amendsNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote' },
    amendmentReason: String,
    amendmentNo: Number,
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote' },
    pendingAuthorSignature: mongoose.Schema.Types.Mixed,
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

elnNoteSchema.index(
  { authorId: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } },
);
elnNoteSchema.index({ projectId: 1, isDeleted: 1, updatedAt: -1 });
elnNoteSchema.index({ projectId: 1, experimentId: 1, status: 1, isDeleted: 1, updatedAt: -1 });
export default mongoose.model('ElnNote', elnNoteSchema);
