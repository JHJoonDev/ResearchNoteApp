import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['admin', 'researcher', 'viewer'],
    default: 'researcher',
  },
  elnRole: {
    type: String,
    enum: ['연구원', '책임연구원', '연구소장'],
    default: '연구원',
  },
  notificationSettings: {
    email: { type: Boolean, default: true },
    inApp: { type: Boolean, default: true },
    types: {
      approvalRequest: { type: Boolean, default: true },
      approvalDone: { type: Boolean, default: true },
      inventoryAlert: { type: Boolean, default: true }
    }
  },
  isFirstLogin: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
});

userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (err) {
    throw err;
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);
