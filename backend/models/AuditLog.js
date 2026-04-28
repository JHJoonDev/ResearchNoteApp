import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    required: true,
  },
  target: {
    type: String,
    required: true,
  },
  details: {
    type: String,
    default: '',
  }
}, {
  timestamps: true,
});

export default mongoose.model('AuditLog', auditLogSchema);
