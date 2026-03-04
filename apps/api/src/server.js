import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const templatesDir = path.join(root, 'templates');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
};

const mm2pt = (mm) => (mm * 72) / 25.4;
const A4 = { w: 210, h: 297 };

const fieldValue = (e, data) => (e.fieldId ? String(data[e.fieldId] ?? `{{${e.fieldId}}}`) : String(e.text ?? ''));

const toSvg = (template, data) => {
  const width = 2480;
  const height = 3508;
  const sx = width / A4.w;
  const sy = height / A4.h;
  const nodes = template.elements.map((e) => {
    const x = e.x * sx;
    const y = e.y * sy;
    const w = e.w * sx;
    const h = e.h * sy;
    if (e.type === 'rect') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${e.stroke || '#000'}"/>`;
    if (e.type === 'line') return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y}" stroke="${e.stroke || '#000'}"/>`;
    if (e.type === 'checkbox') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000"/>`;
    if (e.type === 'table') {
      const cols = e.cols || 3;
      const lines = Array.from({ length: cols - 1 }).map((_, i) => `<line x1="${x + ((i + 1) * w) / cols}" y1="${y}" x2="${x + ((i + 1) * w) / cols}" y2="${y + h}" stroke="#000"/>`).join('');
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000"/>${lines}`;
    }
    return `<text x="${x}" y="${y + (e.fontSize || 10) * 3}" font-size="${(e.fontSize || 10) * 3}" font-family="Arial">${fieldValue(e, data).replace(/&/g, '&amp;')}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${nodes.join('')}</svg>`;
};

app.get('/templates', async (_req, res) => {
  await fs.mkdir(templatesDir, { recursive: true });
  const files = (await fs.readdir(templatesDir)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  res.json(files);
});

app.get('/templates/:name', async (req, res) => {
  const file = path.join(templatesDir, `${req.params.name}.json`);
  try {
    const content = await fs.readFile(file, 'utf8');
    res.type('application/json').send(content);
  } catch {
    res.status(404).json({ error: 'Template not found' });
  }
});

app.post('/templates/:name', async (req, res) => {
  await fs.mkdir(templatesDir, { recursive: true });
  const file = path.join(templatesDir, `${req.params.name}.json`);
  const ordered = stable(req.body);
  await fs.writeFile(file, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  res.json({ ok: true });
});

app.post('/export/pdf', async (req, res) => {
  const { template, data = {} } = req.body;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([mm2pt(A4.w), mm2pt(A4.h)]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const e of template.elements) {
    const x = mm2pt(e.x);
    const yTop = mm2pt(A4.h - e.y);
    const w = mm2pt(e.w);
    const h = mm2pt(e.h);
    if (e.type === 'rect' || e.type === 'checkbox' || e.type === 'table') {
      page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      if (e.type === 'table') {
        const cols = e.cols || 3;
        for (let i = 1; i < cols; i++) {
          const xx = x + (w / cols) * i;
          page.drawLine({ start: { x: xx, y: yTop }, end: { x: xx, y: yTop - h }, thickness: 1, color: rgb(0, 0, 0) });
        }
      }
    } else if (e.type === 'line') {
      page.drawLine({ start: { x, y: yTop }, end: { x: x + w, y: yTop }, thickness: 1, color: rgb(0, 0, 0) });
    } else {
      const text = fieldValue(e, data);
      page.drawText(e.type === 'barcode' ? `||| ${text} |||` : text, { x, y: yTop - mm2pt(4), size: e.fontSize || 10, font });
      if (e.translationText) page.drawText(e.translationText, { x, y: yTop - mm2pt(8), size: 7, font, color: rgb(0.4, 0.4, 0.4) });
    }
  }

  const out = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from(out));
});

app.post('/export/png', async (req, res) => {
  const { template, data = {} } = req.body;
  const svg = toSvg(template, data);
  const pngData = new Resvg(svg).render().asPng();
  res.setHeader('Content-Type', 'image/png');
  res.send(Buffer.from(pngData));
});

app.listen(3001, () => console.log('Template API on :3001'));
