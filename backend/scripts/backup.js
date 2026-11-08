import mongoose from 'mongoose';
import { backup, restore } from '../lib/backup.js';
const [command, directory] = process.argv.slice(2);
if (!['backup', 'restore'].includes(command) || !directory) {
  console.error('사용법: node scripts/backup.js backup|restore <폴더>');
  process.exit(1);
}
try {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27028/?replicaSet=labhub', {
    dbName: process.env.DB_NAME || 'labhub',
    serverSelectionTimeoutMS: 10000,
  });
  console.log(await (command === 'backup' ? backup(directory) : restore(directory)));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
