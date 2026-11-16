import PDFDocument from 'pdfkit';

/** Standard PDF fonts are WinAnsi-encoded; replace characters they cannot render. */
export function pdfText(v: unknown): string {
  return String(v ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[→]/g, '->')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      // Keep tab, LF, CR, printable ASCII and Latin-1 – the range WinAnsi fonts can render.
      return c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff);
    })
    .join('');
}

export const COLORS = { ink: '#111111', muted: '#6B6B76', line: '#E4E4EA', brand: '#4B10F0', soft: '#F4F2FE', green: '#1F8F55', amber: '#B7791F', red: '#C53030' };

export interface Column {
  header: string;
  width: number; // fraction of content width
  align?: 'left' | 'right' | 'center';
}

export class ReportPdf {
  doc: PDFKit.PDFDocument;
  private readonly margin = 48;

  constructor(private readonly footer: string) {
    this.doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 48, right: 48 }, bufferPages: true, info: { Title: 'Axiarix Assessment Report', Producer: 'Axiarix' } });
  }

  get width() {
    return this.doc.page.width - this.margin * 2;
  }

  ensureSpace(h: number) {
    if (this.doc.y + h > this.doc.page.height - 72) this.doc.addPage();
  }

  heading(text: string) {
    // Keep a heading together with at least the first rows of its section.
    this.ensureSpace(110);
    this.doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(COLORS.ink).text(pdfText(text), this.margin);
    const y = this.doc.y + 3;
    this.doc.moveTo(this.margin, y).lineTo(this.margin + 32, y).lineWidth(2).strokeColor(COLORS.brand).stroke();
    this.doc.moveDown(0.6);
  }

  paragraph(text: string, opts: { color?: string; size?: number } = {}) {
    this.doc.font('Helvetica').fontSize(opts.size ?? 9.5).fillColor(opts.color ?? COLORS.ink).text(pdfText(text), this.margin, undefined, { width: this.width, lineGap: 2 });
    this.doc.moveDown(0.4);
  }

  keyValues(rows: [string, string][], cols = 2) {
    const colW = this.width / cols;
    let i = 0;
    while (i < rows.length) {
      this.ensureSpace(34);
      const y = this.doc.y;
      let maxH = 0;
      for (let c = 0; c < cols && i < rows.length; c++, i++) {
        const x = this.margin + c * colW;
        const [k, v] = rows[i];
        this.doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(pdfText(k).toUpperCase(), x, y, { width: colW - 12 });
        this.doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.ink).text(pdfText(v || '-'), x, y + 11, { width: colW - 12 });
        maxH = Math.max(maxH, this.doc.y - y);
      }
      this.doc.y = y + maxH + 8;
    }
  }

  stats(items: { label: string; value: string }[]) {
    this.ensureSpace(60);
    const y = this.doc.y;
    const w = this.width / items.length;
    this.doc.rect(this.margin, y, this.width, 52).fillColor(COLORS.soft).fill();
    items.forEach((it, idx) => {
      const x = this.margin + idx * w + 12;
      this.doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.ink).text(pdfText(it.value), x, y + 9, { width: w - 16 });
      this.doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(pdfText(it.label), x, y + 32, { width: w - 16 });
    });
    this.doc.y = y + 62;
  }

  table(columns: Column[], rows: string[][], opts: { fontSize?: number } = {}) {
    const fs = opts.fontSize ?? 8;
    const widths = columns.map((c) => c.width * this.width);
    const drawHeader = () => {
      const y = this.doc.y;
      this.doc.rect(this.margin, y, this.width, 18).fillColor('#F7F7F9').fill();
      let x = this.margin;
      columns.forEach((c, i) => {
        this.doc.font('Helvetica-Bold').fontSize(fs).fillColor(COLORS.muted).text(pdfText(c.header), x + 4, y + 5, { width: widths[i] - 8, align: c.align ?? 'left' });
        x += widths[i];
      });
      this.doc.y = y + 20;
    };
    this.ensureSpace(40);
    drawHeader();
    if (!rows.length) {
      this.doc.font('Helvetica-Oblique').fontSize(fs).fillColor(COLORS.muted).text('None recorded.', this.margin + 4, this.doc.y + 2);
      this.doc.moveDown(0.8);
      return;
    }
    for (const row of rows) {
      const heights = row.map((cell, i) => this.doc.font('Helvetica').fontSize(fs).heightOfString(pdfText(cell), { width: widths[i] - 8 }));
      const h = Math.max(...heights) + 8;
      if (this.doc.y + h > this.doc.page.height - 72) {
        this.doc.addPage();
        drawHeader();
      }
      const y = this.doc.y;
      let x = this.margin;
      row.forEach((cell, i) => {
        this.doc.font('Helvetica').fontSize(fs).fillColor(COLORS.ink).text(pdfText(cell), x + 4, y + 4, { width: widths[i] - 8, align: columns[i].align ?? 'left' });
        x += widths[i];
      });
      this.doc.moveTo(this.margin, y + h).lineTo(this.margin + this.width, y + h).lineWidth(0.5).strokeColor(COLORS.line).stroke();
      this.doc.y = y + h;
    }
    this.doc.moveDown(0.6);
  }

  /** Adds running header/footer with page numbers to every page. */
  finalise(reportCode: string, version: number, generatedAt: string) {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const bottom = this.doc.page.height - 40;
      // Writing inside the bottom margin would trigger an automatic page break, so lift the margin temporarily.
      const prevBottom = this.doc.page.margins.bottom;
      this.doc.page.margins.bottom = 0;
      this.doc.moveTo(this.margin, bottom - 8).lineTo(this.margin + this.width, bottom - 8).lineWidth(0.5).strokeColor(COLORS.line).stroke();
      this.doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);
      this.doc.text(pdfText(`${reportCode} v${version} | Generated ${generatedAt} UTC`), this.margin, bottom, { width: this.width / 2, lineBreak: false });
      this.doc.text(`Page ${i + 1} of ${range.count}`, this.margin + this.width / 2, bottom, { width: this.width / 2, align: 'right', lineBreak: false });
      this.doc.text(pdfText(this.footer), this.margin, bottom + 10, { width: this.width, lineBreak: false, ellipsis: true });
      this.doc.page.margins.bottom = prevBottom;
    }
  }

  toBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.doc.on('data', (c: Buffer) => chunks.push(c));
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);
      this.doc.end();
    });
  }
}
