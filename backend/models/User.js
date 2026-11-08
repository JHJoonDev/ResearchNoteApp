import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    tokenVersion: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    mfaEnabled: { type: Boolean, default: false },
    oidcIssuer: String,
    oidcSubject: String,
    ssoOnly: { type: Boolean, default: false },
    mfaSecretEncrypted: String,
    mfaPendingSecretEncrypted: String,
    recoveryCodeHashes: [{ type: String }],
    loginFailures: { type: Number, default: 0 },
    lockedUntil: Date,
    signingFailures: { type: Number, default: 0 },
    signingLockedUntil: Date,
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
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
  },
  {
    timestamps: true,
  },
);

userSchema.index({ oidcIssuer: 1, oidcSubject: 1 }, { unique: true, partialFilterExpression: { oidcSubject: { $type: 'string' } } });

export default mongoose.model('User', userSchema);
