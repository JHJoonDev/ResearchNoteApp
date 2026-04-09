import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  labName: { type: String, default: '미래융합연구소' },
  receiveEmailNotifications: { type: Boolean, default: true },
  defaultElnRole: { type: String, default: 'researcher' },
  theme: { type: String, default: 'light' }
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);
