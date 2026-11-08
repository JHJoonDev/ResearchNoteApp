import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  url: { type: String, required: true }, events: [{ type: String, enum: ['note.approved', 'note.rejected', 'reagent.low_stock', 'inbox.received'] }],
  secretEncrypted: { type: String, required: true }, active: { type: Boolean, default: true },
}, { timestamps: true });
export default mongoose.model('Webhook', schema);
