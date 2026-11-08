import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  purpose: { type: String, required: true },
  status: { type: String, enum: ['booked', 'cancelled'], default: 'booked' },
}, { timestamps: true });
schema.index({ entityId: 1, start: 1, end: 1, status: 1 });
export default mongoose.model('Booking', schema);
