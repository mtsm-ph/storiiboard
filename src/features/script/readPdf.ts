import type { PdfText } from '../../core/script/pdfLayout';

// A PDF's text with where it sits on each page (1.18), read with pdf.js (pdfjs-dist 5.7.284, the last release built
// for Safari 16.4, which macOS 13's webview is). Loaded on first use: it's large, and only script import needs it.
// Nothing is drawn: no fonts are loaded and nothing is fetched. The worker is made here, from the app's own file:
// left to pdf.js, the desktop app's tauri:// origin reads as foreign and pdf.js would fall back to parsing on the
// page itself, freezing the window on a large file.

/** Longer than any real script takes; past it, the worker is stopped and the import says so. */
const TIMEOUT_MS = 60_000;

export async function readPdfText(bytes: ArrayBuffer, name: string): Promise<PdfText[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  const port = new Worker(worker.default, { type: 'module' });
  const pdfWorker = pdfjs.PDFWorker.create({ port });
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    worker: pdfWorker,
    // Text only: no font files and no forms. (pdf.js 5 never evaluates code from a PDF.)
    disableFontFace: true,
    enableXfa: false,
    useSystemFonts: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`“${name}” took too long to read. Export the script as a PDF again from the writing app, and try that.`));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(pdfjs, task), timeout]);
  } catch (error) {
    throw readable(error, name);
  } finally {
    clearTimeout(timer);
    // Frees the document, and with it the worker, on every path: done, refused or broken.
    await task.destroy().catch(() => undefined);
    pdfWorker.destroy();
    port.terminate();
  }
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

async function read(pdfjs: PdfJs, task: ReturnType<PdfJs['getDocument']>): Promise<PdfText[]> {
  const document = await task.promise;
  const items: PdfText[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    // The page as it's shown: a rotated or offset page maps its text through this, so reading order holds.
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      // The text's matrix: its last two values are where it starts on the page.
      const [, , , , e = 0, f = 0] = item.transform as number[];
      // applyTransform changes the point it's given.
      const point = [e, f];
      pdfjs.Util.applyTransform(point, viewport.transform);
      const [x = 0, top = 0] = point;
      // Measured up from the bottom of the page as shown, as the layout reader expects.
      items.push({ page: number, x, y: viewport.height - top, width: item.width, text: item.str });
    }
    page.cleanup();
  }
  return items;
}

/** pdf.js's failures in words that say what to do, naming the file. */
function readable(error: unknown, name: string): Error {
  const kind = error instanceof Error ? error.name : '';
  if (kind === 'PasswordException') return new Error(`“${name}” is protected by a password. Save a copy without one (Preview can) and import that.`);
  if (kind === 'InvalidPDFException') return new Error(`“${name}” isn’t a PDF Storiiboard can read. Export the script as a PDF again from the writing app.`);
  return error instanceof Error ? error : new Error(String(error));
}
