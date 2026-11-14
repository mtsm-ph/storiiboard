import { t, tn } from '../../core/i18n';
import { missingFamilies, unreadableFamilies, fontsStore } from '../moodboards/fonts';
import { printPages } from '../moodboards/deckPrint';
import { pictureLoader } from './deckPictures';
import { deckFontLoader } from './deckFonts';
import { deckFileName } from './deckNames';
import { FALLBACK_FAMILY } from './deckFontRules';
import type { FontNote } from './deckPdfWriter';
import { preparePage, renderPage } from './deckRender';
import { writingStatus } from './pdfStoryboardFormat';
import type { ExportFormat, ExportResult } from './registry';
import { watermarkFor } from './watermark';

// A deck as one PDF (5.6a): a page per page frame, in the deck's order. The pages are the canvas's own drawing, read back as
// vector (deckDisplay.ts, deckPdfWriter.ts); pictures come from their originals where those are found (deckPictures.ts).

/** What the export says it did not do as asked: a font not used and why, then the pictures printed from their stored copy. */
export function deckPdfWarnings(notes: readonly FontNote[], storedCopies: number, unprintable = 0): string[] {
  const reasons = {
    restricted: 'export.deck.fontRestricted',
    bitmap: 'export.deck.fontBitmap',
    missing: 'export.deck.fontMissing',
    unreadable: 'export.deck.fontUnreadable',
    glyphs: 'export.deck.fontGlyphs',
  } as const;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes) {
    const key = `${note.family}\n${note.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t(reasons[note.reason], { name: note.family, fallback: FALLBACK_FAMILY }));
  }
  if (storedCopies > 0) out.push(tn('export.deck.storedCopy', storedCopies));
  if (unprintable > 0) out.push(tn('export.deck.unprintable', unprintable));
  return out;
}

export const deckPdf: ExportFormat = {
  id: 'deck-pdf',
  get label() {
    return t('export.deck.pdf.label');
  },
  get description() {
    return t('export.deck.pdf.description');
  },
  output: 'file',
  deck: true,
  watermark: 'pdf',
  name: (title) => deckFileName(title, 'pdf'),
  run: async ({ records, projectId, deckId, file, target, title, progress, signal }): Promise<ExportResult> => {
    const pages = deckId ? printPages(records, deckId) : [];
    if (pages.length === 0) throw new Error(t('export.deck.noPages'));
    progress(0, pages.length);
    // pdf-lib loads only when a deck is exported, as for the storyboard's PDF.
    const { writeDeckPdf } = await import('./deckPdfWriter');
    const pdf = await writeDeckPdf({
      title,
      pageCount: pages.length,
      page: async (index) => {
        const page = pages[index];
        if (!page) throw new Error(t('export.cantDraw'));
        await preparePage(page, file, 'thumbnail');
        const rendered = await renderPage(page, 'thumbnail');
        try {
          return rendered.print();
        } finally {
          rendered.dispose();
        }
      },
      fonts: deckFontLoader,
      pictures: pictureLoader(file),
      watermark: watermarkFor(records[projectId]?.props, 'pdf'),
      progress: (done, total) => {
        progress(done, total, done === total ? writingStatus() : undefined);
      },
      signal,
    });
    // A Stop pressed while the PDF was put together: nothing goes to disk, so a file chosen to be replaced is left as it was.
    signal.throwIfAborted();
    await target.write(deckFileName(title, 'pdf'), pdf.bytes);
    // Fonts the board names that the computer lacks or couldn't read were drawn in Inter Tight on the page already: said here too.
    const faces = pages.flatMap((page) => page.faces);
    const state = fontsStore.getState();
    const notes: FontNote[] = [
      ...pdf.fontNotes,
      ...missingFamilies(faces.map((face) => face.family), state).map((family): FontNote => ({ family, reason: 'missing' })),
      ...unreadableFamilies(faces.map((face) => ({ fontFamily: face.family, fontWeight: face.weight, fontItalic: face.italic })), state).map((family): FontNote => ({ family, reason: 'unreadable' })),
    ];
    const warnings = deckPdfWarnings(notes, pdf.storedCopies, pdf.unprintable);
    const what = tn('count.pages', pages.length);
    return warnings.length === 0 ? { what } : { what, warning: warnings.join(' ') };
  },
};
