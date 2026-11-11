import { invoke } from '@tauri-apps/api/core';
import { BUNDLED, fontsStore, nearestStyle, parseFontPayload } from '../moodboards/fonts';
import type { FontLoader } from './deckPdfWriter';

// Where a deck's PDF gets a font's file (5.6a, decision 7): the app's own static Inter Tight and JetBrains Mono (the storyboard
// PDF's), the other bundled families' files, or a computer's font through Rust (fonts.rs). Whether the file may be embedded is
// decided from its own `fsType` bits by the writer (deckFontRules.ts), not here.
//
// The bundled families other than those two are variable fonts, and a variable font embeds as its default instance only. A
// weight within 100 of that instance prints as it; one further away is printed in Inter Tight at that weight and named in the
// notice (deckPdfWriter.ts), rather than as the wrong face. A slant it has no file for is made.

/**
 * The weight each bundled variable font embeds as: its default instance (fvar's default for wght, read from the files by
 * deckExportMore.test.ts, which fails if a file changes). Archivo's is 600 and Outfit's is 100, not 400.
 */
export const VARIABLE_DEFAULT_WEIGHT: Readonly<Record<string, number>> = { Archivo: 600, 'Bodoni Moda': 400, Jost: 400, Outfit: 100 };

const bytesOf = async (url: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(url)).arrayBuffer());

/** The static files, by family and weight. Each `import()` is named in full so Vite bundles it. */
const STATIC: Readonly<Record<string, readonly { weight: number; load: () => Promise<{ default: string }> }[]>> = {
  'Inter Tight': [
    { weight: 400, load: () => import('./fonts/InterTight-Regular.ttf?url') },
    { weight: 600, load: () => import('./fonts/InterTight-SemiBold.ttf?url') },
    { weight: 700, load: () => import('./fonts/InterTight-Bold.ttf?url') },
  ],
  'JetBrains Mono': [
    { weight: 400, load: () => import('./fonts/JetBrainsMono-Regular.ttf?url') },
    { weight: 700, load: () => import('./fonts/JetBrainsMono-Bold.ttf?url') },
  ],
};

/** The weight a static family has that is nearest the one asked for. */
function nearestWeight<T extends { weight: number }>(files: readonly T[], weight: number): T | null {
  let best: T | null = null;
  for (const file of files) if (best === null || Math.abs(file.weight - weight) < Math.abs(best.weight - weight)) best = file;
  return best;
}

const cache = new Map<string, Promise<Uint8Array>>();
const cached = (key: string, load: () => Promise<Uint8Array>): Promise<Uint8Array> => {
  let made = cache.get(key);
  if (!made) {
    made = load();
    // A failed read is asked for again next time.
    made.catch(() => cache.delete(key));
    cache.set(key, made);
  }
  return made;
};

/** The loader the app's deck export uses. Null for a family neither bundled nor on this computer. */
export const deckFontLoader: FontLoader = async (family, weight, italic) => {
  const files = STATIC[family];
  if (files) {
    const chosen = nearestWeight(files, weight);
    if (!chosen) return null;
    const key = `static|${family}|${String(chosen.weight)}`;
    const bytes = await cached(key, async () => bytesOf((await chosen.load()).default));
    // No italic file ships for these two: the slant is made.
    return { key, bytes, synthBold: false, synthItalic: italic };
  }
  const bundled = BUNDLED.find((font) => font.name === family);
  if (bundled) {
    const slanted = italic && bundled.slanted !== null && bundled.slanted !== '';
    const url = slanted ? bundled.slanted : bundled.upright;
    if (url === null || url === '') return null;
    const key = `bundled|${family}|${slanted ? 'italic' : 'upright'}`;
    const bytes = await cached(key, () => bytesOf(url));
    const defaultWeight = VARIABLE_DEFAULT_WEIGHT[family] ?? 400;
    // Bold is made only where the file's own weight is well short of it; either way the export says the weight was substituted.
    return { key, bytes, synthBold: weight >= 600 && weight - defaultWeight >= 200, synthItalic: italic && !slanted, defaultWeight };
  }
  const entry = fontsStore.getState().system.find((f) => f.name === family);
  if (!entry) return null;
  const style = nearestStyle(entry.styles, weight, italic);
  if (!style) return null;
  const key = `system|${style.postscriptName}`;
  const bytes = await cached(key, async () => {
    const parsed = parseFontPayload(await invoke<ArrayBuffer>('font_bytes', { postscriptName: style.postscriptName }));
    if (!parsed) throw new Error('That font can’t be read.');
    return new Uint8Array(parsed.data);
  });
  return { key, bytes, synthBold: weight >= 600 && (style.realWeight ?? style.weight) < 550, synthItalic: italic && !style.italic };
};
