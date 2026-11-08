import { connectDB } from './database.js';
import { app } from './app.js';
import { encryptionKey } from './lib/crypto.js';
import { startEvidenceWorkers } from './lib/seal/worker.js';
import { ensureSearchIndex } from './lib/search.js';
import { startWebhookWorker, drainWebhookWorker } from './lib/webhooks.js';
import { drainBackground } from './lib/background.js';
import { initializeAi } from './lib/ai.js';
initializeAi();
try {
  await encryptionKey();
  const closeDB = await connectDB();
  await ensureSearchIndex().catch((error) => console.error('Search index startup rebuild failed:', error));
  const stopWorkers = startEvidenceWorkers();
  const stopWebhookWorker = startWebhookWorker();
  const server = app.listen(Number(process.env.PORT || 5000), process.env.HOST || '127.0.0.1', () =>
    console.log('LabHub API ready'),
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    stopWebhookWorker();
    server.close(async () => {
      await stopWorkers();
      await drainWebhookWorker();
      await drainBackground();
      await closeDB();
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('서버 시작 실패:', error.message);
  process.exit(1);
}
