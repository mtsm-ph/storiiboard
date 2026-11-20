import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// The committed proof HEIC (src-tauri/testdata/heic) and a stand-in for the desktop app's decoder: it answers with the
// PNG Rust gave for this very file, as e2e/media.spec.ts's fallback test does, and counts how often it was asked.

const heicFixture = (name: string) => readFileSync(new URL(`../src-tauri/testdata/heic/${name}`, import.meta.url));

/** The proof HEIC as a file to pick. */
export const proofHeic = () => ({ name: 'IMG_0005.HEIC', mimeType: 'image/heic', buffer: heicFixture('heic-proof.heic') });

/**
 * Hands the page's picture import a decoder that answers with Rust's PNG, and says whether this engine reads the HEIC
 * itself (WebKit on a Mac does; Chromium, like WebView2, doesn't), so a test knows whether the decoder will be asked.
 */
export async function useHeicStandIn(page: Page): Promise<{ engineReadsHeic: boolean }> {
  return page.evaluate(
    async ({ heic, png }) => {
      const url = '/src/core/media/heic.ts';
      const { setHeicDecoder } = (await import(/* @vite-ignore */ url)) as typeof import('../src/core/media/heic');
      const counted = window as unknown as { heicAsked: number };
      counted.heicAsked = 0;
      setHeicDecoder(() => {
        counted.heicAsked += 1;
        return Promise.resolve(new Uint8Array(png));
      });
      const engineReadsHeic = await createImageBitmap(new Blob([new Uint8Array(heic)])).then(
        (bitmap) => {
          bitmap.close();
          return true;
        },
        () => false,
      );
      return { engineReadsHeic };
    },
    { heic: [...heicFixture('heic-proof.heic')], png: [...heicFixture('heic-proof.from-rust.png')] },
  );
}

/** How many times the stand-in decoder has been asked. */
export const heicAsked = (page: Page) => page.evaluate(() => (window as unknown as { heicAsked: number }).heicAsked);
