import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import elnRoutes from './routes/eln.js';
import limsRoutes from './routes/lims.js';
import membersRoutes from './routes/members.js';
import settingsRoutes from './routes/settings.js';

dotenv.config();

const app = express();

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import User from './models/User.js';
import ElnNote from './models/ElnNote.js';
import LimsItem from './models/LimsItem.js';

// ... existing setup ...

app.use(cors());
app.use(express.json());

// Initialize MongoDB Connection (Using in-memory server if URI is absent)
async function connectDB() {
  try {
    let mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.log('No MONGO_URI provided. Spinning up an in-memory MongoDB instance for development...');
      const mongoServer = await MongoMemoryServer.create();
      mongoUri = mongoServer.getUri();
    }
    
    await mongoose.connect(mongoUri, {
      dbName: 'labhub'
    });
    console.log(`✅ MongoDB Connected Successfully: ${mongoUri}`);
    
    // Seed initial data
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      await User.create({ email: 'test@labhub.com', password: 'password', name: '연구원 A', role: 'admin' });
      await ElnNote.create([
        { title: '배터리 양극재 합성 실험', author: 'Kim', date: '2026-04-01', status: '진행중' },
        { title: '유기 합성 반응 분석', author: 'Lee', date: '2026-03-25', status: '승인됨' },
        { title: '신약 후보 물질 스크리닝', author: 'Park', date: '2026-03-20', status: '반려' },
        { title: '그래핀 코팅 전도성 테스트', author: 'Hong', date: '2026-04-02', status: '진행중' }
      ]);
      await LimsItem.create([
        { name: 'Acetone', cas: '67-64-1', brand: 'Sigma-Aldrich', stockValue: 2, unit: 'L', status: '양호' },
        { name: 'Sulfuric Acid', cas: '7664-93-9', brand: 'Merck', stockValue: 500, unit: 'mL', status: '부족' },
        { name: 'Ethanol', cas: '64-17-5', brand: 'Daejung', stockValue: 5, unit: 'L', status: '양호' },
        { name: 'Sodium Hydroxide', cas: '1310-73-2', brand: 'Fisher', stockValue: 1, unit: 'kg', status: '만료 예정' }
      ]);
      console.log('🌱 Seed Data Injected');
    }
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
}

connectDB();

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/eln', elnRoutes);
app.use('/api/lims', limsRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
