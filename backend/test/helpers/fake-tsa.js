import http from 'node:http';
import { once } from 'node:events';

function length(n) {
  if (n < 128) return Buffer.from([n]);
  const bytes = [];
  while (n) { bytes.unshift(n & 255); n >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), length(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const oid = (value) => {
  const parts = value.split('.').map(Number); const bytes = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) { let n = part; const group = [n & 127]; while ((n = Math.floor(n / 128))) group.unshift((n & 127) | 128); bytes.push(...group); }
  return tlv(0x06, Buffer.from(bytes));
};
const integer = (value) => {
  let n = BigInt(value); const bytes = [];
  do { bytes.unshift(Number(n & 255n)); n >>= 8n; } while (n > 0n);
  if (bytes[0] & 128) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
};
const nullDer = () => tlv(0x05, Buffer.alloc(0));
function parse(buffer, offset = 0) {
  const start = offset; const tag = buffer[offset++]; let size = buffer[offset++];
  if (size & 128) { const count = size & 127; size = 0; for (let i = 0; i < count; i++) size = size * 256 + buffer[offset++]; }
  const bodyStart = offset; const end = bodyStart + size; const children = [];
  if (tag & 0x20) while (offset < end) { const result = parse(buffer, offset); children.push(result.node); offset = result.end; }
  return { node: { tag, body: buffer.subarray(bodyStart, end), raw: buffer.subarray(start, end), children }, end };
}
function readInteger(node) { return BigInt(`0x${node.body.toString('hex') || '0'}`); }
function response(hash, nonce) {
  const imprint = seq(seq(oid('2.16.840.1.101.3.4.2.1'), nullDer()), tlv(0x04, hash));
  const time = new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const tstInfo = seq(integer(1), oid('1.2.3'), imprint, integer(42), tlv(0x18, Buffer.from(time)), integer(nonce));
  const encap = seq(oid('1.2.840.113549.1.9.16.1.4'), tlv(0xa0, tlv(0x04, tstInfo)));
  const signedData = seq(integer(3), tlv(0x31, Buffer.alloc(0)), encap);
  const contentInfo = seq(oid('1.2.840.113549.1.7.2'), tlv(0xa0, signedData));
  return seq(seq(integer(0)), contentInfo);
}

export async function startFakeTsa(initialMode = 'normal') {
  let mode = initialMode;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (mode === 'error') { res.writeHead(503); res.end('unavailable'); return; }
    try {
      const root = parse(Buffer.concat(chunks)).node;
      const imprint = root.children[1];
      const hash = Buffer.from(imprint.children[1].body);
      const nonce = readInteger(root.children[2]);
      const actualHash = mode === 'mismatch-imprint' ? Buffer.alloc(hash.length, 0x5a) : hash;
      const actualNonce = mode === 'mismatch-nonce' ? nonce + 1n : nonce;
      const result = response(actualHash, actualNonce);
      res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' });
      res.end(result);
    } catch (error) { res.writeHead(400); res.end(error.message); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    setMode(next) { mode = next; },
    close() { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}
