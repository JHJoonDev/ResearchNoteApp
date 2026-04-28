import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import authRoutes from './routes/auth.js';
import elnRoutes from './routes/eln.js';
import limsRoutes from './routes/lims.js';
import membersRoutes from './routes/members.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';
import statsRoutes from './routes/stats.js';
import uploadRoutes from './routes/upload.js';
import searchRoutes from './routes/search.js';

dotenv.config();

const app = express();

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import User from './models/User.js';
import ElnNote from './models/ElnNote.js';
import LimsItem from './models/LimsItem.js';

app.use(cors());
app.use(express.json());

// Serve uploads directory statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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
      // password will be automatically hashed by pre-save hook
      await User.create({ email: 'test@labhub.com', password: 'password', name: '연구원 A', role: 'admin' });
      await ElnNote.create([
        { title: '배터리 양극재 합성 실험', author: 'Kim', date: '2026-04-01', status: '진행중' },
        { title: '유기 합성 반응 분석', author: 'Lee', date: '2026-03-25', status: '승인됨' },
        { title: '신약 후보 물질 스크리닝', author: 'Park', date: '2026-03-20', status: '반려' },
        { title: '그래핀 코팅 전도성 테스트', author: 'Hong', date: '2026-04-02', status: '진행중' }
      ]);
      await LimsItem.create([
        { name: 'Acetone', cas: '67-64-1', brand: 'Sigma-Aldrich', stockValue: 2, unit: 'L', status: '양호', expiryDate: '2027-12-31' },
        { name: 'Sulfuric Acid', cas: '7664-93-9', brand: 'Merck', stockValue: 500, unit: 'mL', status: '부족', expiryDate: '2027-06-30' },
        { name: 'Ethanol', cas: '64-17-5', brand: 'Daejung', stockValue: 5, unit: 'L', status: '양호', expiryDate: '2026-05-15' },
        { name: 'Sodium Hydroxide', cas: '1310-73-2', brand: 'Fisher', stockValue: 1, unit: 'kg', status: '만료 예정', expiryDate: '2026-04-30' }
      ]);
      console.log('🌱 Seed Data Injected');
    }

    // Start Daily Cron Job for LIMS Status Update
    setInterval(async () => {
      try {
        const today = new Date();
        const thirtyDaysLater = new Date(today);
        thirtyDaysLater.setDate(today.getDate() + 30);
        
        const items = await LimsItem.find({ expiryDate: { $ne: null, $ne: '' } });
        for (let item of items) {
          const expDate = new Date(item.expiryDate);
          let newStatus = item.status;
          
          if (expDate < today) {
            newStatus = '만료';
          } else if (expDate <= thirtyDaysLater) {
            newStatus = '만료 예정';
          } else if (item.stockValue <= 0) {
             newStatus = '부족';
          } else if (newStatus === '만료 예정' || newStatus === '만료') {
             newStatus = '양호'; // Reverted
          }
          
          if (item.status !== newStatus && item.status !== '주문 중') {
            item.status = newStatus;
            await item.save();
          }
        }
      } catch (e) {
        console.error('LIMS status update cron job failed:', e);
      }
    }, 1000 * 60 * 60 * 24); // Run daily

  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
}

connectDB();

// API Routes
import { authMiddleware } from './middleware/authMiddleware.js';

app.use('/api/auth', authRoutes);
app.use('/api/eln', authMiddleware, elnRoutes);
app.use('/api/lims', authMiddleware, limsRoutes);
app.use('/api/members', authMiddleware, membersRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/stats', authMiddleware, statsRoutes);
app.use('/api/upload', authMiddleware, uploadRoutes);
app.use('/api/search', authMiddleware, searchRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
