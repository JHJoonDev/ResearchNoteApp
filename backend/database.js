import mongoose from 'mongoose';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { dataDir, root } from './config.js';
export async function connectDB() {
  let local;
  const close = async () => {
    await mongoose.disconnect();
    if (local) await local.stop({ doCleanup: false });
  };
  try {
    let uri = process.env.MONGO_URI;
    if (!uri) {
      const dbPath = path.join(dataDir, 'mongo'),
        port = Number(process.env.LOCAL_DB_PORT || 27028);
      mkdirSync(dbPath, { recursive: true });
      local = new MongoMemoryServer({
        binary: { downloadDir: path.join(root, 'node_modules/.cache/mongodb-memory-server') },
        instance: { dbPath, port, replSet: 'labhub', storageEngine: 'wiredTiger', ip: '127.0.0.1' },
      });
      await local.start(true);
      const client = await mongoose.mongo.MongoClient.connect(local.getUri(), {
        directConnection: true,
      });
      try {
        const admin = client.db('admin');
        try {
          await admin.command({ replSetGetStatus: 1 });
        } catch (e) {
          if (e.code !== 94) throw e;
          await admin.command({
            replSetInitiate: {
              _id: 'labhub',
              members: [{ _id: 0, host: `127.0.0.1:${port}` }],
              settings: { electionTimeoutMillis: 500 },
            },
          });
        }
      } finally {
        await client.close();
      }
      uri = `mongodb://127.0.0.1:${port}/?replicaSet=labhub`;
    }
    await mongoose.connect(uri, {
      dbName: process.env.DB_NAME || 'labhub',
      serverSelectionTimeoutMS: 15000,
    });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid')
      throw new Error('트랜잭션을 지원하는 MongoDB replica set이 필요합니다.');
    return close;
  } catch (e) {
    await close();
    throw e;
  }
}
