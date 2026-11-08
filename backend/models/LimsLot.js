import mongoose from 'mongoose';

const limsLotSchema = new mongoose.Schema({
  reagentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LimsItem', required: true },
  lotNumber: { type: String, required: true, trim: true },
  supplierLot: { type: String, default: '' },
  initialAmount: { type: Number, required: true, min: 0 },
  remainingAmount: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true },
  expirationDate: { type: Date },
  receivedAt: { type: Date, default: Date.now },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  status: { type: String, enum: ['사용가능', '소진', '폐기', '만료'], default: '사용가능' },
  location: { type: String, default: '미지정' },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

limsLotSchema.index({ reagentId: 1, lotNumber: 1 }, { unique: true });
limsLotSchema.index({ reagentId: 1, status: 1, expirationDate: 1, receivedAt: 1 });

export default mongoose.model('LimsLot', limsLotSchema);
