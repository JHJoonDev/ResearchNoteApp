import mongoose from 'mongoose';

const fileAttachmentSchema = new mongoose.Schema(
  {
    sha256: String,
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    path: { type: String },
    storageKey: { type: String },
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElnNote' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model('FileAttachment', fileAttachmentSchema);
