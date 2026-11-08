import mongoose from 'mongoose';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

export async function deliverNotifications(userIds, payload) {
  try {
    const ids = [...new Set((userIds || []).map(String))].filter((id) => mongoose.isObjectIdOrHexString(id));
    if (!ids.length) return;
    const active = await User.find({ _id: { $in: ids }, isActive: true }).select('_id');
    if (!active.length) return;
    await Notification.insertMany(active.map((user) => ({ ...payload, userId: user._id })), { ordered: false });
  } catch (error) {
    console.error('Notification delivery failed:', error);
  }
}
