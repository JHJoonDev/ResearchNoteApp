import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
    recipient: { type: String, required: true }, // 'Admin', 'User Name', or 'Role'
    type: { 
        type: String, 
        enum: ['approval_request', 'approved', 'rejected', 'system', 'info'],
        default: 'info' 
    },
    message: { type: String, required: true },
    link: { type: String }, // e.g., '/eln/:id'
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const Notification = mongoose.model('Notification', NotificationSchema);
export default Notification;
