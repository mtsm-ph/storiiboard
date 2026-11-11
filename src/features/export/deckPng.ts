import { canvasBlob } from '../../core/media/canvas';
import { t, tn } from '../../core/i18n';
import { printPages } from '../moodboards/deckPrint';
import { picturesReady, preparePage, renderPage } from './deckRender';
import { deckFileName, deckPageFileName, pageDigits } from './deckNames';
import { uniqueNames } from './names';
import { drawWatermark } from './renderFrame';
import type { ExportContext, ExportFormat, ExportResult } from './registry';
import { watermarkFor } from './watermark';

// Each page of a deck as a PNG (5.6a): the canvas's own renderer, read-only, as Present draws it, at 1x (the page's size in the
// canvas's units: a 16:9 page is 1920 x 1080) or 2x, from the pictures the project stores (2560 px is enough for 2x). sRGB: the
// canvas is, and a picture is drawn into it.

export interface PagePngs {
  count: number;
  /** The file's name for page `index`. */
  name: (index: number) => string;
  /** Draws page `index` as PNG bytes; throws when it can't. */
  render: (index: number) => Promise<Uint8Array>;
  target: ExportContext['target'];
  signal: AbortSignal;
  progress: ExportContext['progress'];
}

/**
 * No file has its name until every page is made. Where the target can (the desktop app), each page is staged on disk as it is made,
 * under a temporary name, and the names are given at the end; Stop or a failure on page 7 of 9 then takes away what was staged,
 * and the folder if this run made it, rather than leaving six pages in a folder that looks like the export. Where it can't (the
 * browser build, which downloads), the pages are held and written at the end.
 */
export async function writePagePngs({ count, name, render, target, signal, progress }: PagePngs): Promise<number> {
  const unique = uniqueNames();
  const held: { name: string; bytes: Uint8Array }[] = [];
  const staged = target.stage !== undefined && target.commit !== undefined;
  progress(0, count);
  try {
    for (let index = 0; index < count; index += 1) {
      signal.throwIfAborted();
      const bytes = await render(index);
      signal.throwIfAborted();
      const file = unique(name(index));
      if (staged) await target.stage?.(file, bytes);
      else held.push({ name: file, bytes });
      progress(index + 1, count);
    }
    signal.throwIfAborted();
    if (staged) await target.commit?.();
    else for (const file of held) await target.write(file.name, file.bytes);
  } catch (error) {
    await target.abandon?.().catch(() => undefined);
    throw error;
  }
  return count;
}

export const deckPng: ExportFormat = {
  id: 'deck-png',
  get label() {
    return t('export.deck.png.label');
  },
  get description() {
    return t('export.deck.png.description');
  },
  output: 'folder',
  deck: true,
  watermark: 'png',
  options: { pixelRatio: true },
  name: (title) => deckFileName(title),
  run: async ({ records, projectId, deckId, file, target, title, progress, signal, pixelRatio = 1 }): Promise<ExportResult> => {
    const pages = deckId ? printPages(records, deckId) : [];
    if (pages.length === 0) throw new Error(t('export.deck.noPages'));
    const watermark = watermarkFor(records[projectId]?.props, 'png');
    const digits = pageDigits(pages.length);
    const count = await writePagePngs({
      count: pages.length,
      name: (index) => deckPageFileName(title, index + 1, digits, pages[index]?.name ?? ''),
      render: async (index) => {
        const page = pages[index];
        if (!page) throw new Error(t('export.cantDraw'));
        await preparePage(page, file);
        // A picture the cache let go of while the page was made is asked for again once; one the file doesn't hold stays a placeholder.
        if (!picturesReady(page, file)) await preparePage(page, file);
        const rendered = await renderPage(page);
        try {
          const canvas = rendered.canvas(pixelRatio);
          if (watermark) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              // Konva leaves the context scaled by the pixel ratio: at 2x the watermark would be drawn twice as far out, off the page.
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              drawWatermark(ctx, watermark, canvas.width, canvas.height);
            }
          }
          const blob = await canvasBlob(canvas, 'image/png');
          if (!blob) throw new Error(t('export.deck.cantSave', { number: page.number }));
          return new Uint8Array(await blob.arrayBuffer());
        } finally {
          rendered.dispose();
        }
      },
      target,
      signal,
      progress,
    });
    return { what: tn('count.pages', count) };
  },
};
