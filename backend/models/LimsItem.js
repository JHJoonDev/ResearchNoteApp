import mongoose from 'mongoose';

const limsItemSchema = new mongoose.Schema(
  {
    minimumStock: { type: Number, default: 0, min: 0 },
    name: {
      type: String,
      required: true,
    },
    cas: {
      type: String,
      default: 'N/A',
    },
    brand: {
      type: String,
      default: 'Unknown',
    },
    stockValue: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      default: 'L',
      enum: ['L', 'mL', 'kg', 'g', 'mg', 'ea'],
    },
    status: {
      type: String,
      enum: ['양호', '부족', '만료 예정', '만료'],
      default: '양호',
    },
    location: {
      type: String,
      default: '미지정',
    },
    ghsPictograms: [
      {
        type: String,
      },
    ],
    msdsUrl: {
      type: String,
      default: '',
    },
    expirationDate: {
      type: String,
      default: '',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model('LimsItem', limsItemSchema);
