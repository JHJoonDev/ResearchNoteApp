import mongoose from 'mongoose';

const elnVersionSchema = new mongoose.Schema(
  {
    noteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ElnNote',
      required: true,
    },
    version: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String, // Store RichText HTML snapshot
      default: '',
    },
    contentFormat: { type: String, enum: ['html', 'doc'], default: 'html' },
    contentDoc: mongoose.Schema.Types.Mixed,
    snapshot: mongoose.Schema.Types.Mixed,
    reagentsUsed: [
      {
        reagentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LimsItem' },
        name: String,
        amount: Number,
        unit: String,
      },
    ],
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    updaterName: {
      type: String,
      required: true,
    },
    changeReason: {
      type: String,
      default: '수정됨',
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model('ElnVersion', elnVersionSchema);
