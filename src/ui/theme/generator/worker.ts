import { accentCandidates } from './generate';
import { samplePixels, stageOf } from './sample';

// The Web Worker side of extract.ts: one image in, its accents out. A failure posts its stage beside its words (6.27q),
// so the launch check can say which call failed; the words stay the engine's own.
self.onmessage = (event: MessageEvent<Blob>) => {
  samplePixels(event.data)
    .then(({ data, width, height }) => {
      self.postMessage({ accents: accentCandidates(data, width, height) });
    })
    .catch((error: unknown) => {
      self.postMessage({ error: error instanceof Error ? error.message : String(error), stage: stageOf(error) });
    });
};
