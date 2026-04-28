import mongoose from 'mongoose';

const elnNoteSchema = new mongoose.Schema({
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
    enum: ['진행중', '1차 승인', '승인됨', '반려'],
    default: '진행중',
  },
  approvals: [{
    name: String,
    date: { type: Date, default: Date.now }
  }],
  date: {
    type: String,
  },
  content: {
    type: String, // Store RichText HTML
    default: '',
  },
  reagentsUsed: [{
    reagentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LimsItem' },
    name: String,
    amount: Number,
    unit: String
  }],
  attachments: [{
    name: String,
    size: Number,
    type: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  isStockDeducted: {
    type: Boolean,
    default: false
  },
  isTemplate: {
    type: Boolean,
    default: false
  },
  history: [{
    version: Number,
    content: String,
    title: String,
    updatedBy: String,
    updatedAt: { type: Date, default: Date.now }
  }],
  comments: [{
    author: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
  }],
  tags: [String]
}, {
  timestamps: true,
});

elnNoteSchema.index({ title: 'text', content: 'text' });

export default mongoose.model('ElnNote', elnNoteSchema);
