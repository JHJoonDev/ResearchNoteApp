/**
 * @fileoverview 테스트용 가상 LabHub HTTP 서버
 */

import http from 'node:http';

export class FakeServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.url = '';
    this.requests = [];
    this.sockets = new Set();
    this.handler = null;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      let bodyLength = 0;
      const chunks = [];
      const MAX_CAPTURE_BYTES = 5 * 1024 * 1024; // 최대 5MB까지만 캡처 (대용량 sparse 파일 메모리 절약)

      req.on('data', (chunk) => {
        bodyLength += chunk.length;
        if (bodyLength <= MAX_CAPTURE_BYTES) {
          chunks.push(chunk);
        }
      });

      req.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        const rawBody = fullBuffer.toString('utf8');

        const record = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          bodyLength,
          rawBody,
        };
        this.requests.push(record);

        try {
          if (this.handler) {
            const response = this.handler(req, rawBody, req.headers);
            const status = response.status || 200;
            const headers = { 'Connection': 'close', ...(response.headers || { 'Content-Type': 'application/json' }) };
            res.writeHead(status, headers);
            res.end(typeof response.body === 'object' ? JSON.stringify(response.body) : response.body || '');
          } else {
            res.writeHead(201, { 'Content-Type': 'application/json', 'Connection': 'close' });
            res.end(JSON.stringify({ id: 'file-123', status: 'stored' }));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Connection': 'close' });
          res.end(JSON.stringify({ error: err.message, stack: err.stack }));
        }
      });
    });

    this.server.keepAliveTimeout = 0;
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    await new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        this.port = addr.port;
        this.url = `http://127.0.0.1:${this.port}`;
        resolve();
      });
    });
  }

  setHandler(fn) {
    this.handler = fn;
  }

  reset() {
    this.requests = [];
    this.handler = null;
  }

  async stop() {
    if (this.server) {
      for (const socket of this.sockets) {
        socket.destroy();
      }
      this.sockets.clear();
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
  }
}
