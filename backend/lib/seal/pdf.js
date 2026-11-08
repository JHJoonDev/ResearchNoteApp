import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import { root, sealDir } from '../../config.js';
import { renderDoc } from './render-doc.js';
import { flattenPng } from './images.js';

const fontPath = path.join(root, 'assets', 'fonts', 'NotoSansKR.ttf');
const monoFontPath = path.join(root, 'node_modules', '@fontsource', 'noto-sans-mono', 'files', 'noto-sans-mono-latin-400-normal.woff');
const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
function renderHtml(html = '') {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_, level) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<blockquote[^>]*>/gi, '\n> ')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<pre[^>]*>/gi, '\n[코드]\n')
    .replace(/<\/pre>/gi, '\n[/코드]\n')
    .replace(/<code[^>]*>/gi, '「')
    .replace(/<\/code>/gi, '」')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<t[dh][^>]*>/gi, ' | ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (all) => entities[all] || all)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const line = (doc, label, value) => {
  if (value === undefined || value === null || value === '') return;
  doc.font('NotoSansKR').fontSize(10).fillColor('#1f2937').text(label, { continued: true, lineGap: 2 });
  doc.font('NotoSansKR').fontSize(10).text(String(value), { lineGap: 2 });
  doc.moveDown(0.2);
};

export async function createSealPdf({ noteId, version, manifest, manifestSha256, signatures, verifyUrl, attachmentFiles = [] }) {
  await mkdir(sealDir, { recursive: true });
  const filename = `note-${noteId}-v${version}-${crypto.randomUUID()}.pdf`;
  const pdfPath = path.join(sealDir, filename);
  const stream = createWriteStream(pdfPath, { flags: 'wx' });
  const doc = new PDFDocument({ autoFirstPage: true, margin: 52, size: 'A4', bufferPages: true, pdfVersion: '1.7', subset: 'PDF/A-2b', lang: 'ko-KR', info: { Title: manifest.title, Author: manifest.author.name, Subject: `LabHub 증빙 노트 ${noteId} v${version}`, Creator: 'LabHub' } });
  doc.pipe(stream);
  doc.registerFont('NotoSansKR', fontPath);
  doc.registerFont('NotoSansMono', monoFontPath);
  const qr = flattenPng(await QRCode.toBuffer(verifyUrl, { type: 'png', width: 128, margin: 1, color: { dark: '#000000', light: '#ffffff' } }));
  doc.font('NotoSansKR').fontSize(20).fillColor('#111827').text(manifest.title || '연구노트', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#4b5563').text(`일련번호: ${noteId} · 버전 ${version}`);
  doc.moveDown(0.7);
  line(doc, '기관', manifest.organization);
  line(doc, '과제명', manifest.project?.name || '개인 노트');
  line(doc, '작성자', `${manifest.author.name} (${manifest.author.id}) · ${new Date(manifest.createdAt).toLocaleString('ko-KR')}`);
  line(doc, '태그', manifest.tags.join(', '));
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor('#111827').text('본문');
  doc.moveDown(0.25);
  if (manifest.schemaVersion === 2 && manifest.contentFormat === 'doc') {
    await renderDoc(doc, manifest.contentDoc, attachmentFiles);
    if (manifest.protocolRun) {
      doc.moveDown(0.6).font('NotoSansKR').fontSize(13).fillColor('#111827').text('프로토콜 실행');
      doc.fontSize(9).fillColor('#1f2937').text(`${manifest.protocolRun.title} · v${manifest.protocolRun.version}`);
      for (const result of manifest.protocolRun.stepResults || []) {
        const step = (manifest.protocolRun.snapshot?.steps || []).find((item) => item.id === result.stepId);
        doc.fontSize(10).text(`${step?.title || result.stepId}: ${result.checked?.length || 0} checked`);
        for (const [key, value] of Object.entries(result.values || {})) doc.fontSize(9).text(`  ${key}: ${value}`);
        if (result.note) doc.fontSize(9).text(`  ${result.note}`);
      }
    }
  } else {
    const content = renderHtml(manifest.content);
    doc.fontSize(10).fillColor('#1f2937').text(content || '(본문 없음)', { lineGap: 3, paragraphGap: 5 });
  }
  doc.moveDown(0.5).font('NotoSansKR');
  if (manifest.reagentsUsed.length) {
    doc.fontSize(13).text('시약 사용 내역'); doc.moveDown(0.2);
    for (const reagent of manifest.reagentsUsed) {
      doc.fontSize(10).text(`• ${reagent.name}: ${reagent.amount} ${reagent.unit || ''}`);
      for (const allocation of reagent.allocations || []) doc.fontSize(9).text(`  로트 ${allocation.lotNumber}: ${allocation.amount} ${reagent.unit || ''}`);
    }
    doc.moveDown(0.5);
  }
  if ((manifest.entitiesUsed || []).length) {
    doc.fontSize(13).text('사용 장비·시료'); doc.moveDown(0.2);
    for (const entity of manifest.entitiesUsed) doc.fontSize(10).text(`• ${entity.typeName}: ${entity.code} · ${entity.name}`);
    doc.moveDown(0.5);
  }
  for (const run of manifest.aiRuns || []) {
    line(doc, 'AI 보조 사용', `${run.feature} · ${run.model} · ${new Date(run.createdAt).toLocaleString('ko-KR')}`);
  }
  doc.fontSize(13).text('첨부'); doc.moveDown(0.2);
  if (!manifest.attachments.length) doc.fontSize(10).text('없음');
  for (const file of manifest.attachments) doc.fontSize(9).text(`• ${file.name} (${file.size} bytes) · SHA-256 ${file.sha256}`, { lineGap: 2 });
  doc.moveDown(0.5);
  doc.fontSize(13).text('서명'); doc.moveDown(0.2);
  for (const signature of signatures) {
    doc.fontSize(9).text(`${signature.role === 'author' ? '작성자' : '점검자'}: ${signature.name} · ${new Date(signature.signedAt).toLocaleString('ko-KR')} · keyId ${signature.keyId}`);
    if (signature.comment) doc.text(`의견: ${signature.comment}`);
  }
  doc.moveDown(0.5);
  line(doc, 'Manifest SHA-256', manifestSha256);
  doc.image(qr, { fit: [86, 86], align: 'left' }).moveDown(0.2);
  doc.fontSize(8).fillColor('#6b7280').text(`검증 URL: ${verifyUrl}`);
  doc.fontSize(8).text('검증 결과와 시점인증 상태는 서버의 검증 API에서 확인할 수 있습니다.');
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#6b7280').text(`${i + 1} / ${pages.count}`, 52, doc.page.height - 36, { width: doc.page.width - 104, align: 'right' });
  }
  const finished = once(stream, 'finish');
  doc.end();
  await finished;
  return pdfPath;
}
