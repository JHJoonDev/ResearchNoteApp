import mongoose from 'mongoose';

const limsTransactionSchema = new mongoose.Schema({
  reagentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LimsItem',
    required: true
  },
  lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'LimsLot' },
  lotNumber: String,
  reagentName: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  userName: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['소모', '입고', '폐기', '조정'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  unit: {
    type: String,
    required: true
  },
  noteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ElnNote',
    required: false
  },
  noteTitle: {
    type: String,
    required: false
  },
  remarks: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

export default mongoose.model('LimsTransaction', limsTransactionSchema);
