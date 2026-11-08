import crypto from 'node:crypto';
import FileAttachment from '../../models/FileAttachment.js';
import { canonicalize, sha256 } from '../canonical.js';
import { reviewerMessage, verifySignature } from '../signing/index.js';
import { getTimestampProvider } from '../timestamp/index.js';
import { openFile } from '../storage/index.js';

async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of await openFile(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function sealSignatureData(signatures) {
  return signatures.map((item) => Object.fromEntries(Object.entries({
    role: item.role, userId: String(item.userId), name: item.name, keyId: item.keyId,
    algorithm: item.algorithm, publicKey: item.publicKey, signature: item.signature,
    signedAt: item.signedAt, comment: item.comment,
  }).filter(([, value]) => value !== undefined)));
}

export async function verifySeal(seal) {
  const checks = [];
  const manifestHash = sha256(canonicalize(seal.manifest));
  checks.push({ id: 'manifest', ok: manifestHash === seal.manifestSha256, detail: manifestHash === seal.manifestSha256 ? '매니페스트 해시가 일치합니다.' : '매니페스트 해시가 일치하지 않습니다.' });
  let pdfHash;
  try { pdfHash = await fileHash(seal); } catch { pdfHash = null; }
  checks.push({ id: 'pdf', ok: pdfHash === seal.pdfSha256, detail: pdfHash === seal.pdfSha256 ? 'PDF 해시가 일치합니다.' : 'PDF 파일 또는 해시가 일치하지 않습니다.' });
  const attachments = await FileAttachment.find({ _id: { $in: seal.manifest.attachments.map((item) => item.id) } });
  let attachmentsOk = attachments.length === seal.manifest.attachments.length;
  for (const item of seal.manifest.attachments) {
    const file = attachments.find((candidate) => String(candidate._id) === item.id);
    if (!file) { attachmentsOk = false; continue; }
    try { if (file.size !== item.size || await fileHash(file) !== item.sha256) attachmentsOk = false; }
    catch { attachmentsOk = false; }
  }
  checks.push({ id: 'attachments', ok: attachmentsOk, detail: attachmentsOk ? '첨부 파일 해시가 일치합니다.' : '첨부 파일이 없거나 해시가 일치하지 않습니다.' });
  const author = seal.signatures.find((item) => item.role === 'author');
  const reviewer = seal.signatures.find((item) => item.role === 'reviewer');
  const authorOk = Boolean(author && verifySignature(author.publicKey, seal.manifestSha256, author.signature));
  checks.push({ id: 'signature:author', ok: authorOk, detail: authorOk ? '작성자 서명이 유효합니다.' : '작성자 서명을 검증할 수 없습니다.' });
  const reviewerData = author ? reviewerMessage(seal.manifestSha256, author.signature) : '';
  const reviewerOk = Boolean(reviewer && authorOk && verifySignature(reviewer.publicKey, reviewerData, reviewer.signature));
  checks.push({ id: 'signature:reviewer', ok: reviewerOk, detail: reviewerOk ? '점검자 서명이 유효합니다.' : '점검자 서명을 검증할 수 없습니다.' });
  const signatureData = sealSignatureData(seal.signatures);
  const calculatedSealHash = sha256(canonicalize({ manifestSha256: seal.manifestSha256, pdfSha256: seal.pdfSha256, signatures: signatureData }));
  checks.push({ id: 'seal', ok: calculatedSealHash === seal.sealHash, detail: calculatedSealHash === seal.sealHash ? '봉인 해시가 일치합니다.' : '봉인 해시가 일치하지 않습니다.' });
  let timestamp = { status: seal.timestamp.status, genTime: seal.timestamp.genTime, tsaName: seal.timestamp.tsaName, isTrusted: Boolean(seal.timestamp.isTrusted) };
  let timestampOk = ['not_configured', 'pending'].includes(seal.timestamp.status);
  if (seal.timestamp.status === 'granted') {
    const provider = getTimestampProvider(seal.timestamp.provider);
    timestamp = { ...timestamp, ...(await provider.verify(seal.timestamp.tokenBase64, seal.sealHash)) };
    timestampOk = timestamp.status === 'granted';
  } else if (seal.timestamp.status === 'failed') timestampOk = false;
  checks.push({ id: 'timestamp', ok: timestampOk, detail: timestamp.status === 'not_configured' ? '시점인증이 설정되지 않았습니다.' : timestamp.status === 'pending' ? '시점인증 응답을 기다리고 있습니다.' : timestampOk ? '시점인증 토큰의 해시를 확인했습니다.' : '시점인증 토큰을 검증할 수 없습니다.' });
  return { valid: checks.filter((item) => item.id !== 'timestamp' || !['not_configured', 'pending'].includes(timestamp.status)).every((item) => item.ok), checks, timestamp };
}

export function bundleVerifier() {
  return `import { readFile } from 'node:fs/promises';\nimport { createHash, createPublicKey, verify } from 'node:crypto';\nconst canonicalize = (v) => { if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v); if (typeof v === 'number') return JSON.stringify(Object.is(v,-0)?0:v); if (Array.isArray(v)) return '['+v.map(canonicalize).join(',')+']'; return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalize(v[k])).join(',')+'}'; };\nconst hash = (b) => createHash('sha256').update(b).digest('hex');\nconst envelope = JSON.parse(await readFile('manifest.json','utf8'));\nconst manifest = envelope.manifest; const signatures = JSON.parse(await readFile('signatures.json','utf8'));\nconst pdf = await readFile('note.pdf');\nconst manifestHash = hash(Buffer.from(canonicalize(manifest)));\nif (manifestHash !== envelope.manifestSha256) throw new Error('manifest SHA-256 mismatch');\nconst pdfHash = hash(pdf); if (pdfHash !== envelope.pdfSha256) throw new Error('PDF SHA-256 mismatch');\nconst author = signatures.find(s=>s.role==='author'); const reviewer = signatures.find(s=>s.role==='reviewer');\nif (!author || !verify(null, Buffer.from(manifestHash), createPublicKey(author.publicKey), Buffer.from(author.signature,'base64'))) throw new Error('author signature invalid');\nconst reviewerHash = hash(Buffer.from(canonicalize({manifestSha256:manifestHash,authorSignature:author.signature})));\nif (!reviewer || !verify(null, Buffer.from(reviewerHash), createPublicKey(reviewer.publicKey), Buffer.from(reviewer.signature,'base64'))) throw new Error('reviewer signature invalid');\nconst sigData = signatures.map(s=>Object.fromEntries(Object.entries({role:s.role,userId:String(s.userId),name:s.name,keyId:s.keyId,algorithm:s.algorithm,publicKey:s.publicKey,signature:s.signature,signedAt:s.signedAt,comment:s.comment}).filter(([,v])=>v!==undefined)));\nconst sealHash = hash(Buffer.from(canonicalize({manifestSha256:manifestHash,pdfSha256:pdfHash,signatures:sigData})));\nif (sealHash !== envelope.sealHash) throw new Error('seal hash mismatch');\nconsole.log('manifest, PDF, seal hash and Ed25519 signatures verified');\n`;
}
