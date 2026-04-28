import mongoose from 'mongoose';

const limsItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  cas: {
    type: String,
    default: 'N/A',
  },
  brand: {
    type: String,
    default: 'Unknown',
  },
  stockValue: {
    type: Number,
    required: true,
  },
  unit: {
    type: String,
    default: 'L',
    enum: ['L', 'mL', 'kg', 'g', 'mg', 'ea'],
  },
  status: {
    type: String,
    enum: ['양호', '부족', '만료 예정', '만료'],
    default: '양호',
  },
  expiryDate: {
    type: String,
    default: '',
  },
  history: [{
    date: { type: Date, default: Date.now },
    action: { type: String, enum: ['입고', '출고', '폐기', '수정'], required: true },
    amount: { type: Number, required: true },
    user: { type: String, required: true },
    reason: { type: String, default: '' }
  }]
}, {
  timestamps: true,
});

export default mongoose.model('LimsItem', limsItemSchema);
