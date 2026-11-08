import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import mongoose from 'mongoose';
import { createServer as createHttpServer } from 'node:http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const dir = await mkdtemp(path.join(os.tmpdir(), 'labhub-e2e-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = 'e2e-only-testing-secret-at-least-32-characters';
process.env.MAIL_PROVIDER = 'smtp';
process.env.SMTP_HOST = 'mail-capture.local';
process.env.MAIL_FROM = 'labhub-e2e@example.test';
if (process.env.E2E_FAKE_AI === '1') {
  process.env.AI_PROVIDER = 'anthropic';
  process.env.AI_MODEL = 'e2e-fake-model';
  process.env.ANTHROPIC_API_KEY = 'e2e-fake-key-never-sent-to-a-provider';
  const { setAiClientForTests } = await import('../lib/ai.js');
  setAiClientForTests({
    beta: {
      messages: {
        stream(body) {
          const schema = body.output_config?.format?.schema;
          let json;
          let content;
          if (schema?.properties?.sections) {
            json = { sections: [{ heading: '초안', blocks: [{ kind: 'paragraph', text: 'E2E 가짜 AI 초안' }] }], missing: ['실험 조건'] };
          } else if (schema?.properties?.steps) {
            json = { title: 'E2E 가짜 프로토콜', steps: [], safetyNotes: [] };
          } else if (schema?.properties?.tables) {
            json = { tables: [] };
          } else if (schema?.properties?.findings) {
            json = { findings: [] };
          } else {
            content = [{ type: 'text', text: 'E2E 가짜 답변입니다.', citations: [{ document_index: 0, cited_text: 'E2E 인용 문장' }] }];
          }
          if (json) content = [{ type: 'text', text: JSON.stringify(json) }];
          return {
            async finalMessage() {
              return { id: `e2e-fake-${Date.now()}`, model: 'e2e-fake-model', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content };
            },
          };
        },
      },
    },
  });
} else {
  process.env.AI_PROVIDER = 'none';
  delete process.env.ANTHROPIC_API_KEY;
}
const messages = [];
const { setMailTransport } = await import('../lib/mail/index.js');
setMailTransport({
  async sendMail(message) {
    messages.push({ to: message.to, subject: message.subject, text: message.text || '', html: message.html || '', createdAt: new Date().toISOString() });
    return { messageId: `capture-${messages.length}` };
  },
});
const mailServer = createHttpServer((req, res) => {
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim());
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET' && req.url === '/mail') return res.end(JSON.stringify({ messages }));
  if (req.method === 'DELETE' && req.url === '/mail') { messages.length = 0; return res.end(JSON.stringify({ success: true })); }
  res.statusCode = 404;
  res.end(JSON.stringify({ message: 'Not found.' }));
});
mailServer.listen(5099, '127.0.0.1', () => console.log('E2E mail capture ready on 127.0.0.1:5099'));
const { app } = await import('../app.js');
const mongo = await MongoMemoryReplSet.create({
  binary: {
    downloadDir: fileURLToPath(
      new URL('../node_modules/.cache/mongodb-memory-server', import.meta.url),
    ),
  },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
await mongoose.connect(mongo.getUri(), { dbName: 'e2e' });
const server = app.listen(5000, '127.0.0.1', () => console.log('E2E API ready'));
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  server.close();
  await new Promise((resolve) => mailServer.close(resolve));
  await mongoose.disconnect();
  await mongo.stop();
  if (
    path.dirname(dir) === path.resolve(os.tmpdir()) &&
    path.basename(dir).startsWith('labhub-e2e-')
  )
    await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
