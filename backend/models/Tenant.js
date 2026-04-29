import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  complianceMode: { type: Boolean, default: false },
  // future extensions: defaultThreshold, etc.
});

export default mongoose.model('Tenant', tenantSchema);
