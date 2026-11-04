// A small screenplay PDF built for the tests (1.18): Courier 12 text placed as a writing app places it, one page per
// list, with a correct cross-reference table so any PDF reader opens it. Text is ASCII.

export interface PdfLine {
  /** The line's row from the top of the text area, 12 points each. */
  row: number;
  /** Where it starts, in points from the page's left edge. */
  x: number;
  text: string;
}

const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

export function screenplayPdf(pages: readonly (readonly PdfLine[])[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';
  pages.forEach((lines, i) => {
    const content = lines.map((l) => `BT /F1 12 Tf 1 0 0 1 ${String(l.x)} ${String(720 - l.row * 12)} Tm (${escape(l.text)}) Tj ET`).join('\n');
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(5 + i * 2)} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${String(Buffer.byteLength(content))} >>\nstream\n${content}\nendstream`;
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body);
    body += `${String(id)} 0 obj\n${objects[id] ?? ''}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
