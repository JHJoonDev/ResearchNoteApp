import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  state: { type: String, required: true, unique: true }, nonce: { type: String, required: true },
  verifier: { type: String, required: true }, expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true });
export default mongoose.model('OidcLoginState', schema);
