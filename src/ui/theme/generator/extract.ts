import { accentCandidates } from './generate';
import { samplePixels } from './sample';

// Reading an image's accents (1.14): decoded and shrunk to about 96px, then clustered (generate.ts). It runs in a Web
// Worker so a large key image never holds up the window; when there's no worker, it fails or it takes too long, the
// page does the same work itself.

/** How long the worker may take before the page does the work instead, so a stuck worker never leaves a caller waiting. */
const WORKER_TIMEOUT_MS = 15_000;

/** The worker's accents; null when there's no worker to ask, it failed, or it took too long. */
function askWorker(image: Blob): Promise<string[] | null> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, WORKER_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<{ accents?: string[]; error?: string }>) => {
      done();
      // The worker read the file and couldn't: the page would fail the same way, so that's the answer.
      if (event.data.accents) resolve(event.data.accents);
      else reject(new Error(event.data.error ?? 'The image’s colours couldn’t be read.'));
    };
    worker.onerror = () => {
      done();
      resolve(null);
    };
    worker.onmessageerror = () => {
      done();
      resolve(null);
    };
    worker.postMessage(image);
  });
}

/** The accents an image offers, most saturated first; empty for a grey one. */
export async function extractAccents(image: Blob): Promise<string[]> {
  const fromWorker = typeof Worker === 'undefined' ? null : await askWorker(image);
  if (fromWorker) return fromWorker;
  const { data, width, height } = await samplePixels(image);
  return accentCandidates(data, width, height);
}
