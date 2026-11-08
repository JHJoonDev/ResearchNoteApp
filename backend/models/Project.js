import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  endDate: { type: Date },
  members: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    role: { type: String, enum: ['viewer', 'editor', 'manager'], default: 'viewer' }
  }],
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model('Project', projectSchema);
