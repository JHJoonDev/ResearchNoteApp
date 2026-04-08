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
    enum: ['진행중', '승인됨', '반려'],
    default: '진행중',
  },
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
  }
}, {
  timestamps: true,
});

export default mongoose.model('ElnNote', elnNoteSchema);
