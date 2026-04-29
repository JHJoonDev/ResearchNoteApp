import express from 'express';
import Handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import ElnNote from '../models/ElnNote.js';
import LimsItem from '../models/LimsItem.js';
import { enforceCompliance } from '../middleware/compliance.js'; // optional usage

const router = express.Router();

// Helper to compile template
Handlebars.registerHelper('eq', function (a, b) {
  return a === b;
});

const compileTemplate = async (data) => {
  const templatePath = path.resolve(process.cwd(), 'templates', 'weekly-report.hbs');
  const templateSrc = await fs.promises.readFile(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSrc);
  return template(data);
};

router.get('/weekly', async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    // Fetch data (filter by tenant if needed)
    const notes = await ElnNote.find(tenantId ? { tenantId } : {}).lean();
    const items = await LimsItem.find(tenantId ? { tenantId } : {}).lean();
    const html = await compileTemplate({ notes, items, generatedAt: new Date().toLocaleString() });
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="weekly_report.pdf"',
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (e) {
    console.error('Weekly report generation error:', e);
    res.status(500).json({ error: 'Report generation failed' });
  }
});

export default router;
