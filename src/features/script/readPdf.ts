import type { PdfText } from '../../core/script/pdfLayout';
import { t } from '../../core/i18n';

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
    // Text only: no font files and no forms. pdf.js can run a PDF's own scripts, and GHSA-hq66-cqwq-w95j is a flaw
    // there that needs scripting switched on and no script policy. This reader isn't affected: it reads text only,
    // builds no annotation layer, loads nothing from pdfjs-dist/web and never turns scripting on, and the app's policy
    // allows no inline script and no eval. So the Advisories job ignores that advisory until a date
    // (osv-scanner.toml), and src/app/pdfjsUse.test.ts fails if any of this stops being true.
    disableFontFace: true,
    enableXfa: false,
    useSystemFonts: false,
    // No WebAssembly: pdf.js 5.7 compiles a PDF's PostScript functions with `new WebAssembly.Module`, which the
    // workers' policy (src-tauri/worker-csp.txt) refuses. pdf.js would fall back to its JS, but the refusal is still a
    // violation, so it's never tried.
    useWasm: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Tells the page's reading to stop at the time limit, so the text stream it holds is let go of.
  const stop = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // A worker stuck in a page never answers a polite stop: it's ended first.
      port.terminate();
      stop.abort();
      reject(new Error(t('script.pdfTimeout', { name })));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(pdfjs, task, stop.signal), timeout]);
  } catch (error) {
    throw readable(error, name);
  } finally {
    clearTimeout(timer);
    // Frees the document and the worker on every path: done, refused, broken or stuck. pdf.js waits for the worker
    // to say it's done, which a stuck one never does, so that wait is cut short.
    await Promise.race([task.destroy().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1000))]);
    pdfWorker.destroy();
    port.terminate();
  }
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>;
/** One chunk of a page's text stream, as pdf.js sends it: its getTextContent gathers these into one. */
type TextChunk = Pick<Awaited<ReturnType<PdfPage['getTextContent']>>, 'items'>;

async function read(pdfjs: PdfJs, task: ReturnType<PdfJs['getDocument']>, signal: AbortSignal): Promise<PdfText[]> {
  const document = await task.promise;
  const items: PdfText[] = [];
  // A call, not the property: the signal changes across an await, which TypeScript's narrowing doesn't see.
  const stopped = (): boolean => signal.aborted;
  for (let number = 1; number <= document.numPages; number += 1) {
    // Past the time limit the import has already failed with its own words: nothing more is read.
    if (stopped()) break;
    const page = await document.getPage(number);
    // The limit can pass while the page is fetched: an abort listener added now would never fire.
    if (stopped()) break;
    // The page as it's shown: a rotated or offset page maps its text through this, so reading order holds.
    const viewport = page.getViewport({ scale: 1 });
    // Read chunk by chunk through a reader, not pdf.js's getTextContent: it gathers the chunks with
    // `for await … of` a ReadableStream, which Safari's engine (macOS's webview) doesn't have (6.27p).
    const reader = (page.streamTextContent() as ReadableStream<TextChunk>).getReader();
    // At the time limit a pending read ends as done, so the lock below is let go of. pdf.js asserts its cancel has an
    // Error for a reason; nobody sees these words.
    const cancel = (): void => void reader.cancel(new Error('PDF reading stopped at the time limit')).catch(() => undefined);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const item of value.items) {
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
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
    page.cleanup();
  }
  return items;
}

/** pdf.js's failures in words that say what to do, naming the file. */
function readable(error: unknown, name: string): Error {
  const kind = error instanceof Error ? error.name : '';
  if (kind === 'PasswordException') return new Error(t('script.pdfPassword', { name }));
  if (kind === 'InvalidPDFException') return new Error(t('script.pdfInvalid', { name }));
  return error instanceof Error ? error : new Error(String(error));
}
