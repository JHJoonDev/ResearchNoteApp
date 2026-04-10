import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
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
  }
}, {
  timestamps: true,
});

export default mongoose.model('User', userSchema);
