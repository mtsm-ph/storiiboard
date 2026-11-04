import type { PdfText } from '../../core/script/pdfLayout';

// A PDF's text with where it sits on each page (1.18), read with pdf.js (pdfjs-dist 5.7.284, the last release built
// for Safari 16.4, which macOS 13's webview is). Loaded on first use: it's large, and only script import needs it.
// Nothing is drawn: no fonts are loaded and no code from the file is run.

export async function readPdfText(bytes: ArrayBuffer): Promise<PdfText[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // Text only: no font files and no forms. (pdf.js 5 never evaluates code from a PDF.)
    disableFontFace: true,
    enableXfa: false,
    useSystemFonts: false,
  }).promise;
  try {
    const items: PdfText[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        // The text's matrix: its last two values are where it starts on the page.
        const [, , , , x = 0, y = 0] = item.transform as number[];
        items.push({ page: number, x, y, width: item.width, text: item.str });
      }
      page.cleanup();
    }
    return items;
  } finally {
    await document.destroy();
  }
}
