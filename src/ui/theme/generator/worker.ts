import { accentCandidates } from './generate';
import { samplePixels } from './sample';

// The Web Worker side of extract.ts: one image in, its accents out.
self.onmessage = (event: MessageEvent<Blob>) => {
  samplePixels(event.data)
    .then(({ data, width, height }) => {
      self.postMessage({ accents: accentCandidates(data, width, height) });
    })
    .catch((error: unknown) => {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    });
};
