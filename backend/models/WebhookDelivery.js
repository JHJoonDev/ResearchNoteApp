import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  webhookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Webhook', required: true, index: true },
  event: { type: String, required: true }, payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'delivered', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 }, responseStatus: Number, lastError: String,
  nextAttemptAt: { type: Date, default: Date.now, index: true }, deliveredAt: Date,
}, { timestamps: true });
export default mongoose.model('WebhookDelivery', schema);
