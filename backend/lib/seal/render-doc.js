import { flattenPng } from './images.js';
import { openFile } from '../storage/index.js';

const children = (node) => Array.isArray(node?.content) ? node.content : [];
const inline = (node) => {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mathInline') return node.attrs?.latex || '';
  if (['mention', 'noteLink', 'reagentRef'].includes(node.type)) return node.attrs?.label || '';
  return children(node).map(inline).join('');
};
const monospaceFont = (value) => /^[\x00-\x7f]*$/.test(String(value)) ? 'NotoSansMono' : 'NotoSansKR';
const plain = (node) => children(node).map((item) => ['image', 'mathBlock'].includes(item.type) ? '' : inline(item)).join(' ').trim();

export async function renderDoc(pdf, contentDoc, attachments = []) {
  const files = new Map(attachments.map((file) => [String(file._id), file]));
  const left = pdf.page.margins.left, right = pdf.page.width - pdf.page.margins.right;
  const bottom = () => pdf.page.height - pdf.page.margins.bottom - 20;
  const width = () => right - left;
  const ensure = (height) => { if (pdf.y + height > bottom()) pdf.addPage(); };
  const textBlock = (value, options = {}) => {
    const opts = { width: width(), lineGap: 3, paragraphGap: 5, ...options };
    const height = pdf.heightOfString(String(value || ' '), opts);
    ensure(height);
    pdf.text(String(value || ''), opts);
    pdf.moveDown(options.moveDown ?? 0.3);
  };
  const inlineRuns = (nodes, options = {}) => {
    if (!nodes.length) { textBlock('', options); return; }
    nodes.forEach((item, index) => {
      const math = item?.type === 'mathInline';
      pdf.font(math ? monospaceFont(inline(item)) : 'NotoSansKR').fontSize(options.fontSize || 10).fillColor(options.color || '#1f2937');
      pdf.text(inline(item), {
        x: options.x ?? left, width: options.width ?? width(), align: options.align || 'left',
        continued: index < nodes.length - 1, lineGap: options.lineGap ?? 3, paragraphGap: options.paragraphGap ?? 5,
      });
    });
    pdf.moveDown(options.moveDown ?? 0.3);
  };
  const render = async (node, indent = 0) => {
    if (!node) return;
    const x = left + indent, available = right - x;
    switch (node.type) {
      case 'doc':
        for (const child of children(node)) await render(child, indent);
        break;
      case 'paragraph':
        inlineRuns(children(node), { x, width: available, align: node.attrs?.align || 'left' });
        break;
      case 'heading': {
        const size = node.attrs?.level === 1 ? 18 : node.attrs?.level === 2 ? 15 : 12;
        inlineRuns(children(node), { x, width: available, align: node.attrs?.align || 'left', paragraphGap: 6, fontSize: size, color: '#111827' });
        break;
      }
      case 'bulletList': case 'orderedList': case 'taskList': {
        let ordinal = Number(node.attrs?.start) || 1;
        for (const item of children(node)) {
          const checked = node.type === 'taskList' && Boolean(item.attrs?.checked);
          const marker = node.type === 'orderedList' ? `${ordinal++}.` : '•';
          const body = children(item).map((child) => ['paragraph', 'heading'].includes(child.type) ? children(child).map(inline).join('') : plain(child)).filter(Boolean).join('\n');
          if (node.type === 'taskList') {
            const textOptions = { x: x + 16, width: available - 16, lineGap: 3, paragraphGap: 2 };
            const height = pdf.heightOfString(body || ' ', textOptions);
            ensure(height);
            const boxY = pdf.y + 3;
            pdf.save().lineWidth(0.8).strokeColor('#4b5563').rect(x + 2, boxY, 8, 8).stroke();
            if (checked) pdf.moveTo(x + 3.5, boxY + 4).lineTo(x + 5.5, boxY + 6.5).lineTo(x + 9, boxY + 2).lineWidth(1.2).strokeColor('#1f2937').stroke();
            pdf.restore();
            textBlock(body, { ...textOptions, paragraphGap: 2 });
          } else {
            pdf.font('NotoSansKR').fontSize(10).fillColor('#1f2937');
            textBlock(`${marker}  ${body}`, { x, width: available, indent: 14, paragraphGap: 2 });
          }
          const nested = children(item).filter((child) => ['bulletList', 'orderedList', 'taskList', 'table'].includes(child.type));
          for (const child of nested) await render(child, indent + 18);
        }
        pdf.moveDown(0.25);
        break;
      }
      case 'blockquote': {
        const startY = pdf.y;
        for (const child of children(node)) await render(child, indent + 12);
        const endY = pdf.y;
        pdf.save().lineWidth(2).strokeColor('#9ca3af').moveTo(x + 3, startY).lineTo(x + 3, endY).stroke().restore();
        break;
      }
      case 'codeBlock': {
        const content = children(node).map((child) => child.text || '').join('');
        pdf.font(monospaceFont(content)).fontSize(9).fillColor('#111827');
        const h = Math.max(20, pdf.heightOfString(content || ' ', { width: available - 16, lineGap: 2 }) + 12);
        ensure(h);
        const y = pdf.y;
        pdf.save().fillColor('#f3f4f6').rect(x, y, available, h).fill().restore();
        pdf.text(content, x + 8, y + 6, { width: available - 16, lineGap: 2 });
        pdf.y = y + h + 8;
        break;
      }
      case 'mathBlock':
        pdf.font(monospaceFont(node.attrs?.latex || '')).fontSize(9).fillColor('#1f2937');
        textBlock(node.attrs?.latex || '', { x, width: available, paragraphGap: 4 });
        break;
      case 'image': {
        const file = files.get(String(node.attrs?.attachmentId || ''));
        if (!file) { textBlock(`[이미지를 찾을 수 없음: ${node.attrs?.alt || '첨부 파일 없음'}]`, { x, width: available }); break; }
        if (file.size > 20 * 1024 * 1024) { textBlock(`[이미지 크기 초과: ${file.originalName || node.attrs?.alt || ''}]`, { x, width: available }); break; }
        const chunks = [];
        for await (const chunk of await openFile(file)) chunks.push(chunk);
        let buffer = Buffer.concat(chunks);
        const type = (file.mimeType || '').toLowerCase();
        if (!['image/png', 'image/jpeg', 'image/jpg'].includes(type)) {
          textBlock(`[지원하지 않는 이미지: ${file.originalName || node.attrs?.alt || type}]`, { x, width: available }); break;
        }
        try {
          if (type === 'image/png') buffer = flattenPng(buffer);
          const image = pdf.openImage(buffer);
          const maxH = bottom() - pdf.y;
          let scale = Math.min(1, available / image.width, maxH / image.height);
          if (scale <= 0.05) { pdf.addPage(); scale = Math.min(1, available / image.width, (bottom() - pdf.y) / image.height); }
          const imageWidth = image.width * scale, imageHeight = image.height * scale;
          if (pdf.y + imageHeight > bottom()) pdf.addPage();
          pdf.image(image, x, pdf.y, { width: imageWidth, height: imageHeight });
          pdf.y += imageHeight + 8;
        } catch {
          textBlock(`[올바르지 않은 이미지: ${file.originalName || node.attrs?.alt || ''}]`, { x, width: available });
        }
        break;
      }
      case 'table': {
        const rows = children(node).map((row) => children(row));
        if (!rows.length) break;
        const occupied = rows.map(() => []), placements = [];
        let colCount = 1;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          let col = 0;
          for (const cell of rows[rowIndex]) {
            while (occupied[rowIndex][col]) col++;
            const colSpan = Math.max(1, Number(cell.attrs?.colspan) || 1);
            const rowSpan = Math.max(1, Math.min(rows.length - rowIndex, Number(cell.attrs?.rowspan) || 1));
            placements.push({ cell, row: rowIndex, col, colSpan, rowSpan });
            for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
              for (let c = col; c < col + colSpan; c++) occupied[r][c] = true;
            }
            col += colSpan;
            colCount = Math.max(colCount, col);
          }
        }
        const colW = available / colCount;
        const rowHeights = rows.map(() => 28);
        pdf.font('NotoSansKR').fontSize(9);
        for (const item of placements) {
          const value = children(item.cell).map(plain).join(' ').trim();
          const needed = pdf.heightOfString(value || ' ', { width: colW * item.colSpan - 10, lineGap: 2 }) + 10;
          const current = rowHeights.slice(item.row, item.row + item.rowSpan).reduce((sum, height) => sum + height, 0);
          if (needed > current) {
            const addition = (needed - current) / item.rowSpan;
            for (let r = item.row; r < item.row + item.rowSpan; r++) rowHeights[r] += addition;
          }
        }
        const startY = pdf.y;
        const rowY = [startY];
        for (const height of rowHeights) rowY.push(rowY.at(-1) + height);
        ensure(rowY.at(-1) - startY);
        const offset = pdf.y - startY;
        for (const item of placements) {
          const cellX = x + colW * item.col, cellY = rowY[item.row] + offset;
          const cellW = colW * item.colSpan, cellH = rowY[item.row + item.rowSpan] - rowY[item.row];
          const value = children(item.cell).map(plain).join(' ').trim();
          pdf.save().lineWidth(0.5).strokeColor('#9ca3af').fillColor(item.cell.type === 'tableHeader' ? '#f3f4f6' : '#ffffff').rect(cellX, cellY, cellW, cellH).fillAndStroke().restore();
          pdf.font('NotoSansKR').fontSize(9).fillColor('#1f2937').text(value, cellX + 5, cellY + 5, { width: cellW - 10, height: cellH - 10 });
        }
        pdf.y = rowY.at(-1) + offset + 8;
        pdf.y += 8;
        break;
      }
      case 'horizontalRule':
        ensure(12); pdf.moveTo(x, pdf.y + 4).lineTo(right, pdf.y + 4).lineWidth(0.5).strokeColor('#9ca3af').stroke(); pdf.y += 12; break;
      default:
        if (children(node).length) for (const child of children(node)) await render(child, indent);
        else if (inline(node)) textBlock(inline(node), { x, width: available });
    }
  };
  await render(contentDoc);
}
